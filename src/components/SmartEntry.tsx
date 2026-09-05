import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { parseUtterance, needsReview } from '../lib/parseService';
import type { ParsedDraft } from '../lib/parseService';
import { formatCOP } from '../lib/money';
import { formatDateShort, todayISO } from '../lib/dates';
import { TransactionForm } from './TransactionForm';

interface Props {
  onClose: () => void;
  onToast: (kind: 'success' | 'error', message: string) => void;
}

/** A transaction that was actually saved, with display fields resolved. */
interface RecordedItem {
  type: TxType;
  amountCents: number;
  categoryId: string;
  date: string;
  note?: string;
  name: string;
  emoji: string;
}

/**
 * AI-assisted transaction entry, rendered inside the "New transaction" sheet.
 *
 * Flow: natural-language text → Submit → parse microservice. One utterance
 * may describe SEVERAL transactions ("300 in bread, 2000 bus home, …").
 *
 * - Confident, complete entries (category found + certainty grade at/above
 *   the threshold) are saved immediately through the existing persistence.
 * - Doubtful entries (low certainty grade) or ambiguous ones (no mappable
 *   category) NEVER save silently: they queue through the review form —
 *   pre-filled with the model's guess when there is one — until the user
 *   confirms, fixes, or skips each.
 * - After a batch saves, the sheet shows exactly what was recorded before
 *   closing, with a pointer that any entry can be edited from the list.
 *
 * Errors surface as friendly fading messages and the text is kept for retry.
 */
export function SmartEntry({ onClose, onToast }: Props) {
  const { data, dispatch } = useStore();
  const [mode, setMode] = useState<'smart' | 'manual'>('smart');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Single-entry review (ambiguous or doubtful): the existing one-form flow.
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  // Batch flow: items already saved + items still queued for review.
  const [recorded, setRecorded] = useState<RecordedItem[] | null>(null);
  const [queue, setQueue] = useState<ParsedDraft[] | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueSaved, setQueueSaved] = useState<RecordedItem[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Focus the dictation field whenever the text view is showing so the native
  // keyboard opens. The user activates its microphone button themselves.
  useEffect(() => {
    if (mode !== 'smart' || draft || recorded || queue) return;
    const timer = setTimeout(() => textRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [mode, draft, recorded, queue]);

  const itemFromTx = (tx: Omit<Transaction, 'id'>): RecordedItem => {
    const cat = data.categories.find((c) => c.id === tx.categoryId);
    return {
      type: tx.type,
      amountCents: tx.amountCents,
      categoryId: tx.categoryId,
      date: tx.date,
      note: tx.note,
      name: cat?.name ?? 'Transaction',
      emoji: cat?.emoji ?? '🧾',
    };
  };

  /** Save one confident draft right away and remember it for the summary. */
  const saveBatchItem = (d: ParsedDraft, categoryId: string): RecordedItem => {
    const tx: Omit<Transaction, 'id'> = {
      type: d.type,
      amountCents: d.amountCents,
      categoryId,
      date: d.date ?? todayISO(),
      note: d.note,
    };
    dispatch({ type: 'addTransaction', tx });
    return itemFromTx(tx);
  };

  /** `Added N transactions · $ X` — total only when the items share a type. */
  const batchToast = (items: RecordedItem[]): string => {
    const n = items.length;
    const label = n === 1 ? 'transaction' : 'transactions';
    const spent = items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amountCents, 0);
    const received = items.filter((i) => i.type === 'income').reduce((s, i) => s + i.amountCents, 0);
    if (spent > 0 && received === 0) return `Added ${n} ${label} · ${formatCOP(spent)}`;
    if (received > 0 && spent === 0) return `Added ${n} ${label} · ${formatCOP(received)}`;
    return `Added ${n} ${label}`;
  };

  const startBatch = (drafts: ParsedDraft[]) => {
    const savedNow: RecordedItem[] = [];
    const pending: ParsedDraft[] = [];
    for (const d of drafts) {
      if (needsReview(d) || d.categoryId === null) {
        pending.push(d);
        continue;
      }
      savedNow.push(saveBatchItem(d, d.categoryId));
    }
    if (pending.length === 0) {
      // The summary IS the feedback — no toast needed on top of it.
      setRecorded(savedNow);
      return;
    }
    if (savedNow.length > 0) {
      // Some saved instantly; the toast tells the user before they dive
      // into the remaining items.
      onToast('success', batchToast(savedNow));
    }
    setQueue(pending);
    setQueueTotal(pending.length);
    setQueueSaved(savedNow);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsing) return;
    const utterance = text.trim();
    if (!utterance) {
      onToast('error', 'Tell me what you spent first.');
      return;
    }
    setParsing(true);
    setRetrying(false);
    // Transient "busy" errors get one automatic retry inside parseUtterance;
    // the callback flips the label to "Retrying…" while it waits.
    const result = await parseUtterance(utterance, data.categories, {
      onRetry: () => setRetrying(true),
    });
    setParsing(false);

    if (!result.ok) {
      onToast('error', result.error.message);
      return;
    }

    const drafts = result.drafts;
    if (drafts.length === 1) {
      const d = drafts[0];
      if (d.categoryId !== null && !needsReview(d)) {
        // Confident, complete parse: save right away and confirm with a
        // fading message — the single-entry flow stays exactly as before.
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
      // Doubtful or ambiguous: review form so the user checks the details.
      setDraft(d);
      setDraftCount((n) => n + 1);
      return;
    }

    startBatch(drafts);
  };

  const save = (tx: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', tx });
    onToast('success', `Added · ${formatCOP(tx.amountCents)}`);
    onClose();
  };

  const saveQueued = (tx: Omit<Transaction, 'id'>) => {
    if (!queue || queue.length === 0) return;
    dispatch({ type: 'addTransaction', tx });
    const updated = [...queueSaved, itemFromTx(tx)];
    setQueueSaved(updated);
    setQueueCount((n) => n + 1);
    const rest = queue.slice(1);
    if (rest.length === 0) {
      setQueue(null);
      setRecorded(updated);
    } else {
      setQueue(rest);
    }
  };

  const skipQueued = () => {
    if (!queue) return;
    const rest = queue.slice(1);
    setQueueCount((n) => n + 1);
    if (rest.length === 0) {
      setQueue(null);
      // Nothing left and nothing saved through review: back to the text
      // input rather than an empty summary.
      if (queueSaved.length > 0) setRecorded(queueSaved);
    } else {
      setQueue(rest);
    }
  };

  const backToText = () => {
    setQueue(null);
    setQueueSaved([]);
  };

  const recordMore = () => {
    setRecorded(null);
    setQueue(null);
    setQueueSaved([]);
    setText('');
  };

  const reviewHint = (d: ParsedDraft, position: number, total: number): string => {
    const pct = Math.round(d.confidence * 100);
    if (d.categoryId !== null) {
      return total === 1
        ? `I'm only ${pct}% sure about this one — check the details. Nothing is saved yet.`
        : `I'm only ${pct}% sure about this one (${position} of ${total}) — check the details. Nothing is saved for these yet.`;
    }
    return total === 1
      ? 'Almost there — pick the missing details. Nothing is saved yet.'
      : `Almost there — ${position} of ${total} need details. Nothing is saved for these yet.`;
  };

  // ---- Single-entry review: ambiguous or doubtful, nothing saved yet ----
  if (draft) {
    const pct = Math.round(draft.confidence * 100);
    const doubtful = draft.categoryId !== null;
    return (
      <>
        <p className="field-hint">
          {doubtful
            ? `I'm only ${pct}% sure about this one — check the details. Nothing is saved yet.`
            : 'Almost there — pick the missing details. Nothing is saved yet.'}
        </p>
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

  // ---- Recorded summary: what a batch actually saved ----
  if (recorded) {
    const spent = recorded.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amountCents, 0);
    const received = recorded.filter((i) => i.type === 'income').reduce((s, i) => s + i.amountCents, 0);
    return (
      <>
        <p className="field-hint">
          Recorded ✓ — need a change? Open the list and tap any transaction to edit it.
        </p>
        <div className="recorded-list">
          {recorded.map((item, i) => (
            <div key={i} className="tx-row">
              <span
                className="tx-emoji"
                style={{ background: item.type === 'income' ? 'var(--income-soft)' : 'var(--neutral-tint)' }}
              >
                {item.emoji}
              </span>
              <span className="tx-main">
                <span className="tx-name">{item.name}</span>
                <span className="tx-note">
                  {formatDateShort(item.date)}
                  {item.note ? ` · ${item.note}` : ''}
                </span>
              </span>
              <span className={`tx-amount ${item.type}`}>{formatCOP(item.amountCents)}</span>
            </div>
          ))}
        </div>
        <div className="batch-total">
          {spent > 0 && received > 0 ? (
            <>
              <span>Spent / Received</span>
              <span className="batch-total-amounts">
                <span className="tx-amount expense">{formatCOP(spent)}</span>
                <span className="tx-amount income">{formatCOP(received)}</span>
              </span>
            </>
          ) : (
            <>
              <span>Total</span>
              <span className={`tx-amount ${spent > 0 ? 'expense' : 'income'}`}>
                {formatCOP(spent > 0 ? spent : received)}
              </span>
            </>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
          Done
        </button>
        <button type="button" className="btn btn-block" onClick={recordMore}>
          Record more
        </button>
      </>
    );
  }

  // ---- Batch review: doubtful/ambiguous items, one form at a time ----
  if (queue && queue.length > 0) {
    const current = queue[0];
    const position = queueTotal - queue.length + 1;
    const isLast = queue.length === 1;
    return (
      <>
        <p className="field-hint">{reviewHint(current, position, queueTotal)}</p>
        <p className="smart-quote">{text.trim()}</p>
        <TransactionForm
          key={`queue-${queueCount}`}
          initial={{
            type: current.type,
            amountCents: current.amountCents,
            categoryId: current.categoryId ?? '',
            date: current.date ?? todayISO(),
            note: current.note,
          }}
          submitLabel={isLast ? 'Add transaction' : 'Save & next'}
          onSave={saveQueued}
        />
        <div className="btn-row">
          <button type="button" className="btn" onClick={skipQueued}>
            Skip this one
          </button>
          <button type="button" className="btn" onClick={backToText}>
            Back to text
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
        <p className="field-hint">
          Type, or use your keyboard's microphone to dictate. Amounts are pesos. You can
          list several transactions at once.
        </p>
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={parsing || text.trim() === ''}>
        {parsing ? (retrying ? 'Retrying…' : 'Submitting…') : 'Submit'}
      </button>

      <button type="button" className="btn btn-block" onClick={() => setMode('manual')}>
        Enter manually instead
      </button>

      <p className="field-hint smart-disclosure">
        Your text is sent to the app's parsing service. Budget data stays on this device.
      </p>
    </form>
  );
}
