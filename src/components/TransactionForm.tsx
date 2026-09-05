import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Transaction, TxType } from '../lib/types';
import { useStore } from '../state/store';
import { parseAmountToCents } from '../lib/money';
import { todayISO } from '../lib/dates';
import { activeCategories } from '../lib/selectors';
import { AmountInput, amountHint } from './AmountInput';
import { FloatField } from './FloatField';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  initial?: Omit<Transaction, 'id'> | null;
  onSave: (tx: Omit<Transaction, 'id'>) => void;
  onDelete?: () => void;
  submitLabel?: string;
}

export function TransactionForm({ initial, onSave, onDelete, submitLabel }: Props) {
  const { data } = useStore();
  const [type, setType] = useState<TxType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amountCents / 100) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Which field currently has focus (drives the floating labels).
  const [active, setActive] = useState<string | null>(null);

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
        <AmountInput label="Amount" value={amount} onChange={setAmount} autoFocus={!initial} />
        {hint && (
          <p className={hint.error ? 'field-hint error' : 'field-hint'}>{hint.text}</p>
        )}
      </div>

      <div className="field">
        <FloatField id="tx-category" label="Category" floated={active === 'category' || categoryId !== ''}>
          <select
            id="tx-category"
            className={categoryId === '' && active !== 'category' ? 'float-select text-hidden' : 'float-select'}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            onFocus={() => setActive('category')}
            onBlur={() => setActive(null)}
          >
            <option value="">— Pick a category —</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </FloatField>
      </div>

      <div className="field">
        <FloatField id="tx-date" label="Date" floated={active === 'date' || date !== ''}>
          <input
            id="tx-date"
            type="date"
            className={date === '' && active !== 'date' ? 'text-hidden' : undefined}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onFocus={() => setActive('date')}
            onBlur={() => setActive(null)}
          />
        </FloatField>
      </div>

      <div className="field">
        <FloatField id="tx-note" label="Note (optional)" floated={active === 'note' || note !== ''}>
          <input
            id="tx-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onFocus={() => setActive('note')}
            onBlur={() => setActive(null)}
          />
        </FloatField>
      </div>

      {error && <p className="error-text">{error}</p>}

      <button type="submit" className="btn btn-primary btn-block">
        {submitLabel ?? (initial ? 'Save changes' : 'Add transaction')}
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
