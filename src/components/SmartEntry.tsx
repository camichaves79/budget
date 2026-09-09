import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { useEntitlement } from '../state/entitlement';
import { parseUtterance, needsReview } from '../lib/parseService';
import type { ParsedDraft } from '../lib/parseService';
import { formatMoney } from '../lib/money';
import { t, useI18n } from '../lib/i18n';
import { formatDateShort, todayISO } from '../lib/dates';
import { TransactionForm } from './TransactionForm';
import { PaywallCard } from './PaywallCard';
import { EmptyState } from './EmptyState';

interface Props {
  onClose: () => void;
  onGoToCategories: () => void;
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

/** Voice auto-send: how long the text must stay quiet before submitting. */
export const AUTO_SEND_PAUSE_MS = 2500;

/** Minimum trimmed utterance length before a send is allowed — blocks
 *  accidental one-tap / stray-character entries (2026-09). */
export const MIN_SEND_LENGTH = 3;

/**
 * AI-assisted transaction entry, rendered inside the "Tell me what the
 * transaction is:" sheet.
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
export function SmartEntry({ onClose, onGoToCategories, onToast }: Props) {
  const { data, dispatch } = useStore();
  const { dropLicense, licensedActive, licenseToken, recordParseUse, remaining } = useEntitlement();
  const { intl } = useI18n();
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
  // Voice auto-send countdown: armed when the text has been quiet; two
  // ticks (2s → 1s) then submit. Any edit resets it; the hint row lets
  // the user cancel before it fires.
  const autoTickRef = useRef<number | null>(null);
  const autoFireRef = useRef<number | null>(null);
  const lastAutoTextRef = useRef('');
  const [autoSendLeft, setAutoSendLeft] = useState(0);
  // The timer's submit entry point, kept fresh every render (the timer
  // fires long after the render that armed it).
  const runSubmitRef = useRef<(utterance: string) => void>(() => {});

  // Focus the dictation field whenever the text view is showing so the native
  // keyboard opens. The user activates its microphone button themselves.
  useEffect(() => {
    if (mode !== 'smart' || draft || recorded || queue) return;
    const timer = setTimeout(() => textRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [mode, draft, recorded, queue]);

  const clearAutoTimers = useCallback(() => {
    if (autoTickRef.current !== null) {
      clearTimeout(autoTickRef.current);
      autoTickRef.current = null;
    }
    if (autoFireRef.current !== null) {
      clearTimeout(autoFireRef.current);
      autoFireRef.current = null;
    }
  }, []);

  /** Cancel a pending auto-send and hide the countdown (handlers only). */
  const clearAutoSend = useCallback(() => {
    clearAutoTimers();
    setAutoSendLeft(0);
  }, [clearAutoTimers]);

  // Voice auto-send arming (2026-09): runs from the textarea's onChange,
  // so every input event restarts the quiet-pause timer. A pause of
  // AUTO_SEND_PAUSE_MS arms the visible countdown ("Sending in 2s…" +
  // cancel), then submits — long enough not to cut natural dictation
  // pauses, short enough not to leave the user staring at the screen.
  const armAutoSend = (value: string) => {
    const trimmed = value.trim();
    const canArm = mode === 'smart' && !draft && !recorded && !queue && !parsing;
    clearAutoSend(); // restart any pending countdown
    if (!canArm || trimmed.length < MIN_SEND_LENGTH || value === lastAutoTextRef.current) return;
    setAutoSendLeft(2);
    autoTickRef.current = window.setTimeout(() => setAutoSendLeft(1), 1000);
    autoFireRef.current = window.setTimeout(() => {
      autoFireRef.current = null;
      setAutoSendLeft(0);
      runSubmitRef.current(trimmed);
    }, AUTO_SEND_PAUSE_MS);
  };

  // Unmount only: cancel any pending auto-send timers. View transitions
  // cancel through the handlers that cause them (no setState in effects).
  useEffect(() => clearAutoTimers, [clearAutoTimers]);

  const itemFromTx = (tx: Omit<Transaction, 'id'>): RecordedItem => {
    const cat = data.categories.find((c) => c.id === tx.categoryId);
    return {
      type: tx.type,
      amountCents: tx.amountCents,
      categoryId: tx.categoryId,
      date: tx.date,
      note: tx.note,
      name: cat?.name ?? t('tx.transaction'),
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
    const spent = items.filter((i) => i.type === 'expense').reduce((s, i) => s + i.amountCents, 0);
    const received = items.filter((i) => i.type === 'income').reduce((s, i) => s + i.amountCents, 0);
    if (spent > 0 && received === 0) return t('smart.addedBatch', { n, amount: formatMoney(spent) });
    if (received > 0 && spent === 0) return t('smart.addedBatch', { n, amount: formatMoney(received) });
    return t('smart.addedBatchNoAmount', { n });
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

  const runSubmit = async (utterance: string) => {
    if (parsing) return;
    if (utterance.length < MIN_SEND_LENGTH) return;
    clearAutoSend();
    // The auto-send timer must not re-fire for the same text (e.g. after a
    // failed parse that keeps the text for a manual retry).
    lastAutoTextRef.current = utterance;
    setParsing(true);
    setRetrying(false);
    // One allowance unit per submission (the automatic retry doesn't count
    // again); licensed users still tick the counter harmlessly.
    recordParseUse();
    // Transient "busy" errors get one automatic retry inside parseUtterance;
    // the callback flips the label to "Retrying…" while it waits.
    const result = await parseUtterance(utterance, data.categories, {
      onRetry: () => setRetrying(true),
      license: licenseToken,
    });
    setParsing(false);

    if (!result.ok) {
      // The server rejected the stored license: drop it so the free
      // allowance (and the paywall) takes over cleanly.
      if (result.error.kind === 'license') dropLicense();
      onToast('error', result.error.message);
      // The field is disabled during the flight; bring the keyboard back so
      // the kept text can be edited/dictated again right away. The timeout
      // lets React re-enable the textarea before focus is requested.
      setTimeout(() => textRef.current?.focus(), 0);
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
        onToast('success', t('smart.addedOne', { name: cat?.name ?? t('tx.transaction'), amount: formatMoney(d.amountCents) }));
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

  /** Manual submit: the form's onSubmit entry point. */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    runSubmitRef.current(text.trim());
  };

  // Keep the timer's entry point fresh without re-arming the timer itself
  // (no deps = refresh every render; the timer fires long after the render
  // that armed it). Declared after runSubmit so the closure always sees it.
  useEffect(() => {
    runSubmitRef.current = (utterance) => {
      void runSubmit(utterance);
    };
  });

  const save = (tx: Omit<Transaction, 'id'>) => {
    dispatch({ type: 'addTransaction', tx });
    onToast('success', t('smart.addedSimple', { amount: formatMoney(tx.amountCents) }));
    onClose();
  };

  const saveQueued = (tx: Omit<Transaction, 'id'>) => {
    if (!queue || queue.length === 0) return;
    clearAutoSend();
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
    clearAutoSend();
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
    clearAutoSend();
    setQueue(null);
    setQueueSaved([]);
  };

  const recordMore = () => {
    clearAutoSend();
    setRecorded(null);
    setQueue(null);
    setQueueSaved([]);
    setText('');
  };

  const reviewHint = (d: ParsedDraft, position: number, total: number): string => {
    const pct = Math.round(d.confidence * 100);
    if (d.categoryId !== null) {
      return total === 1
        ? t('smart.unsureOne', { pct })
        : t('smart.unsureMany', { pct, pos: position, total });
    }
    return total === 1
      ? t('smart.almostOne')
      : t('smart.almostMany', { pos: position, total });
  };

  // Friendly guard (2026-09): with no active categories, neither smart entry
  // nor the manual form can record anything — the button IS the add-category
  // action (closes the sheet, switches to Categories, opens the add form).
  if (data.categories.every((c) => c.archived) || data.categories.length === 0) {
    return (
      <>
        <EmptyState emoji="🏷️" title={t('cats.emptyTitle')} hint={t('cats.emptyHint')} />
        <button type="button" className="btn btn-primary btn-block" onClick={onGoToCategories}>
          {t('cats.addCategory')}
        </button>
      </>
    );
  }

  // ---- Single-entry review: ambiguous or doubtful, nothing saved yet ----
  if (draft) {
    const pct = Math.round(draft.confidence * 100);
    const doubtful = draft.categoryId !== null;
    return (
      <>
        <p className="field-hint">
          {doubtful ? t('smart.unsureOne', { pct }) : t('smart.almostOne')}
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
          submitLabel={t('tx.addTx')}
          onSave={save}
        />
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setDraft(null)}>
            {t('smart.backToText')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('smart.cancel')}
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
        <p className="field-hint">{t('smart.recorded')}</p>
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
                  {formatDateShort(item.date, intl)}
                  {item.note ? ` · ${item.note}` : ''}
                </span>
              </span>
              <span className={`tx-amount ${item.type}`}>{formatMoney(item.amountCents)}</span>
            </div>
          ))}
        </div>
        <div className="batch-total">
          {spent > 0 && received > 0 ? (
            <>
              <span>{t('smart.spentReceived')}</span>
              <span className="batch-total-amounts">
                <span className="tx-amount expense">{formatMoney(spent)}</span>
                <span className="tx-amount income">{formatMoney(received)}</span>
              </span>
            </>
          ) : (
            <>
              <span>{t('smart.total')}</span>
              <span className={`tx-amount ${spent > 0 ? 'expense' : 'income'}`}>
                {formatMoney(spent > 0 ? spent : received)}
              </span>
            </>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
          {t('smart.done')}
        </button>
        <button type="button" className="btn btn-block" onClick={recordMore}>
          {t('smart.recordMore')}
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
          submitLabel={isLast ? t('tx.addTx') : t('smart.saveNext')}
          onSave={saveQueued}
        />
        <div className="btn-row">
          <button type="button" className="btn" onClick={skipQueued}>
            {t('smart.skip')}
          </button>
          <button type="button" className="btn" onClick={backToText}>
            {t('smart.backToText')}
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
        <button type="button" className="btn btn-block" onClick={() => { clearAutoSend(); setMode('smart'); }}>
          {t('smart.smartInstead')}
        </button>
      </>
    );
  }

  // ---- Allowance exhausted, no license: the paywall card ----
  if (!licensedActive && remaining <= 0) {
    return <PaywallCard onClose={onClose} onManual={() => setMode('manual')} />;
  }

  // ---- Natural-language input ----
  return (
    <form onSubmit={submit}>
      <div className="field">
        <textarea
          id="smart-text"
          ref={textRef}
          className="input smart-textarea"
          rows={3}
          placeholder={t('smart.placeholder')}
          aria-label={t('smart.describe')}
          value={text}
          autoFocus
          disabled={parsing}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            armAutoSend(value);
          }}
        />
      </div>

      {autoSendLeft > 0 && (
        <div className="autosend-hint">
          <span aria-live="polite">{t('smart.autoSendIn', { sec: autoSendLeft })}</span>
          <button type="button" className="autosend-cancel" onClick={clearAutoSend}>
            {t('smart.cancel')}
          </button>
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={parsing || text.trim().length < MIN_SEND_LENGTH}>
        {parsing ? (retrying ? t('smart.retrying') : t('smart.submitting')) : t('smart.submit')}
      </button>

      <button
        type="button"
        className="btn btn-block"
        disabled={parsing}
        onClick={() => { clearAutoSend(); setMode('manual'); }}
      >
        {t('smart.manualInstead')}
      </button>
    </form>
  );
}
