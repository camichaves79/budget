import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import { parseUtterance } from '../lib/parseService';
import type { ParseError, ParsedDraft } from '../lib/parseService';
import { todayISO } from '../lib/dates';
import { TransactionForm } from './TransactionForm';

/**
 * AI-assisted transaction entry, rendered inside the "New transaction" sheet.
 * Flow: natural-language text → parse microservice → review/edit
 * (TransactionForm) → user confirms → existing addTransaction persistence.
 * Nothing is saved without explicit confirmation, and the manual form stays
 * one tap away.
 */
export function SmartEntry({ onClose }: { onClose: () => void }) {
  const { data, dispatch } = useStore();
  const [mode, setMode] = useState<'smart' | 'manual'>('smart');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<ParseError | null>(null);
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
      setError({ kind: 'invalid-response', message: 'Tell me what you spent first.' });
      return;
    }
    setParsing(true);
    setError(null);
    const result = await parseUtterance(utterance, data.categories);
    setParsing(false);
    if (result.ok) {
      setDraft(result.draft);
      setDraftCount((n) => n + 1);
    } else {
      setError(result.error);
    }
  };

  const save = (tx: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', tx });
    onClose();
  };

  // ---- Review/edit: parsed draft, user confirms before anything is saved ----
  if (draft) {
    return (
      <>
        <p className="field-hint">Check the parsed transaction and fix anything that's off. Nothing is saved yet.</p>
        <p className="smart-quote">{text.trim()}</p>
        <TransactionForm
          key={draftCount}
          initial={{
            type: draft.type,
            amountCents: draft.amountCents,
            categoryId: draft.categoryId ?? '',
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

      {error && <p className="error-text">{error.message}</p>}

      <button type="submit" className="btn btn-primary btn-block" disabled={parsing || text.trim() === ''}>
        {parsing ? 'Parsing…' : 'Parse'}
      </button>

      <button type="button" className="btn btn-block" onClick={() => setMode('manual')}>
        Enter manually instead
      </button>

      <p className="field-hint smart-disclosure">Your text is sent to the app's parsing service. Budget data stays on this device.</p>
    </form>
  );
}
