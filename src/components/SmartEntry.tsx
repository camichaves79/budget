import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import { parseUtterance } from '../lib/parseService';
import type { ParsedDraft } from '../lib/parseService';
import { formatCOP } from '../lib/money';
import { todayISO } from '../lib/dates';
import { TransactionForm } from './TransactionForm';

interface Props {
  onClose: () => void;
  onToast: (kind: 'success' | 'error', message: string) => void;
}

/**
 * AI-assisted transaction entry, rendered inside the "New transaction" sheet.
 *
 * Flow: natural-language text → Submit → parse microservice. When the parse
 * is complete (amount + a category the user actually has), the transaction is
 * saved immediately through the existing persistence, the sheet closes, and a
 * brief fading confirmation appears. Ambiguous parses (no mappable category)
 * fall back to the review form so nothing incomplete is ever saved silently.
 * Errors surface as friendly fading messages and the text is kept for retry.
 */
export function SmartEntry({ onClose, onToast }: Props) {
  const { data, dispatch } = useStore();
  const [mode, setMode] = useState<'smart' | 'manual'>('smart');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Focus the dictation field whenever the text view is showing so the native
  // keyboard opens. The user activates its microphone button themselves.
  useEffect(() => {
    if (mode !== 'smart' || draft) return;
    const timer = setTimeout(() => textRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [mode, draft]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsing) return;
    const utterance = text.trim();
    if (!utterance) {
      onToast('error', 'Tell me what you spent first.');
      return;
    }
    setParsing(true);
    const result = await parseUtterance(utterance, data.categories);
    setParsing(false);

    if (!result.ok) {
      onToast('error', result.error.message);
      return;
    }

    const d = result.draft;
    if (d.categoryId) {
      // Complete parse: save right away and confirm with a fading message.
      const cat = data.categories.find((c) => c.id === d.categoryId);
      dispatch({
        type: 'addTransaction',
        tx: {
          type: d.type,
          amountCents: d.amountCents,
          categoryId: d.categoryId,
          date: d.date ?? todayISO(),
          note: d.note,
        },
      });
      onToast('success', `Added ${cat?.name ?? 'transaction'} · ${formatCOP(d.amountCents)}`);
      onClose();
      return;
    }

    // Ambiguous parse: review form so the user completes the missing bits.
    setDraft(d);
    setDraftCount((n) => n + 1);
  };

  const save = (tx: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', tx });
    onToast('success', `Added · ${formatCOP(tx.amountCents)}`);
    onClose();
  };

  // ---- Review/edit: only for ambiguous parses, before anything is saved ----
  if (draft) {
    return (
      <>
        <p className="field-hint">Almost there — pick the missing details. Nothing is saved yet.</p>
        <p className="smart-quote">{text.trim()}</p>
        <TransactionForm
          key={draftCount}
          initial={{
            type: draft.type,
            amountCents: draft.amountCents,
            categoryId: '',
            date: draft.date ?? todayISO(),
            note: draft.note,
          }}
          submitLabel="Add transaction"
          onSave={save}
        />
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setDraft(null)}>
            Back to text
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  // ---- Manual entry: the existing form, unchanged ----
  if (mode === 'manual') {
    return (
      <>
        <TransactionForm key="manual" initial={null} onSave={save} />
        <button type="button" className="btn btn-block" onClick={() => setMode('smart')}>
          ⚡ Use smart entry instead
        </button>
      </>
    );
  }

  // ---- Natural-language input ----
  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="smart-text">What happened?</label>
        <textarea
          id="smart-text"
          ref={textRef}
          className="input smart-textarea"
          rows={3}
          placeholder="Tell me what you spent…"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <p className="field-hint">Type, or use your keyboard's microphone to dictate. Amounts are pesos.</p>
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={parsing || text.trim() === ''}>
        {parsing ? 'Submitting…' : 'Submit'}
      </button>

      <button type="button" className="btn btn-block" onClick={() => setMode('manual')}>
        Enter manually instead
      </button>

      <p className="field-hint smart-disclosure">Your text is sent to the app's parsing service. Budget data stays on this device.</p>
    </form>
  );
}
