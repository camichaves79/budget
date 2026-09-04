import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { parseAmountToCents } from '../lib/money';
import { todayISO } from '../lib/dates';
import { activeCategories } from '../lib/selectors';
import { AmountInput, amountHint } from './AmountInput';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  initial?: Transaction | null;
  onSave: (tx: Omit<Transaction, 'id'>) => void;
  onDelete?: () => void;
}

export function TransactionForm({ initial, onSave, onDelete }: Props) {
  const { data } = useStore();
  const [type, setType] = useState<TxType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amountCents / 100) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const cats = activeCategories(data, type);
  const hint = amountHint(amount);

  const switchType = (t: TxType) => {
    if (t === type) return;
    setType(t);
    const valid = data.categories.some((c) => c.id === categoryId && c.kind === t && !c.archived);
    if (!valid) setCategoryId('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (!categoryId) {
      setError('Pick a category.');
      return;
    }
    if (!date) {
      setError('Pick a date.');
      return;
    }
    onSave({
      type,
      amountCents: cents,
      categoryId,
      date,
      note: note.trim() || undefined,
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Transaction type">
        <button
          type="button"
          className={type === 'expense' ? 'active expense' : ''}
          onClick={() => switchType('expense')}
        >
          Expense
        </button>
        <button
          type="button"
          className={type === 'income' ? 'active income' : ''}
          onClick={() => switchType('income')}
        >
          Income
        </button>
      </div>

      <div className="field">
        <label htmlFor="tx-amount">Amount</label>
        <AmountInput value={amount} onChange={setAmount} autoFocus={!initial} />
        {hint && (
          <p className={hint.error ? 'field-hint error' : 'field-hint'}>{hint.text}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="tx-category">Category</label>
        <select
          id="tx-category"
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">— Pick a category —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="tx-date">Date</label>
        <input
          id="tx-date"
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="tx-note">Note (optional)</label>
        <input
          id="tx-note"
          type="text"
          className="input"
          placeholder="e.g. Supermarket run"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <button type="submit" className="btn btn-primary btn-block">
        {initial ? 'Save changes' : 'Add transaction'}
      </button>

      {onDelete && (
        <button
          type="button"
          className="btn btn-soft-danger btn-block"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete transaction
        </button>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete transaction?"
        message="This removes the transaction permanently."
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete?.();
        }}
      />
    </form>
  );
}
