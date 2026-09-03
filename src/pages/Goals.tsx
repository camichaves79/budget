import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Goal } from '../lib/types';
import { useStore } from '../state/store';
import { goalSavedCents } from '../lib/selectors';
import { formatCOP, parseAmountToCents } from '../lib/money';
import { todayISO, daysUntil, formatDateShort } from '../lib/dates';
import { Sheet } from '../components/Sheet';
import { ProgressBar } from '../components/ProgressBar';
import { AmountInput, amountHint } from '../components/AmountInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';

export function Goals() {
  const { data, dispatch } = useStore();

  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Goal | null>(null);
  const [funding, setFunding] = useState<{ goal: Goal; mode: 'add' | 'withdraw' } | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const rows = data.goals.map((g) => ({ goal: g, saved: goalSavedCents(data, g.id) }));

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState
          emoji="🐷"
          title="No savings goals yet"
          hint="Create a goal like a vacation or an emergency fund, then put money toward it."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Create a goal
            </button>
          }
        />
      ) : (
        <div className="goal-list">
          {rows.map(({ goal, saved }) => {
            const pct = Math.round((saved / goal.targetCents) * 100);
            const days = goal.deadline ? daysUntil(goal.deadline) : null;
            return (
              <button key={goal.id} type="button" className="card goal-card" onClick={() => setDetail(goal)}>
                <div className="goal-card-head">
                  <span className="goal-emoji">🎯</span>
                  <span className="goal-card-main">
                    <span className="goal-name">{goal.name}</span>
                    {goal.deadline && (
                      <span className="goal-deadline">
                        {days !== null &&
                          (days < 0
                            ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
                            : `Due in ${days} day${days === 1 ? '' : 's'} · ${formatDateShort(goal.deadline)}`)}
                      </span>
                    )}
                  </span>
                  <span className="goal-pct">{pct}%</span>
                </div>
                <ProgressBar value={saved} max={goal.targetCents} />
                <div className="goal-amounts">
                  <span>{formatCOP(saved)}</span>
                  <span className="muted">of {formatCOP(goal.targetCents)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <button type="button" className="fab" onClick={() => setCreating(true)} aria-label="Create goal">
        +
      </button>

      <Sheet open={creating} onClose={() => setCreating(false)} title="New goal">
        <GoalForm
          onClose={() => setCreating(false)}
          onSave={(goal) => {
            dispatch({ type: 'addGoal', goal });
            setCreating(false);
          }}
        />
      </Sheet>

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail ? `🎯 ${detail.name}` : ''}>
        {detail && (
          <GoalDetail
            key={detail.id}
            goalId={detail.id}
            onFund={(mode) => {
              setFunding({ goal: detail, mode });
            }}
            onEdit={() => {
              setEditingGoal(detail);
            }}
            onDelete={() => {
              setDeleting(detail);
            }}
          />
        )}
      </Sheet>

      <Sheet open={funding !== null} onClose={() => setFunding(null)} title={funding?.mode === 'withdraw' ? 'Withdraw money' : 'Add money'}>
        {funding && (
          <FundForm
            key={`${funding.goal.id}-${funding.mode}`}
            goal={funding.goal}
            mode={funding.mode}
            onClose={() => setFunding(null)}
            onSave={(alloc) => {
              dispatch({ type: 'addAllocation', goalId: funding.goal.id, allocation: alloc });
              setFunding(null);
            }}
          />
        )}
      </Sheet>

      <Sheet open={editingGoal !== null} onClose={() => setEditingGoal(null)} title="Edit goal">
        {editingGoal && (
          <GoalForm
            initial={editingGoal}
            onClose={() => setEditingGoal(null)}
            onSave={(patch) => {
              dispatch({ type: 'updateGoal', id: editingGoal.id, patch });
              setEditingGoal(null);
              setDetail(null);
            }}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete goal?"
        message="The goal and its allocations will be removed. Transactions that contributed to it are kept — they just no longer count toward the goal."
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) dispatch({ type: 'deleteGoal', id: deleting.id });
          setDeleting(null);
          setDetail(null);
        }}
      />
    </div>
  );
}

function GoalForm({
  initial,
  onClose,
  onSave,
}: {
  initial?: Goal | null;
  onClose: () => void;
  onSave: (goal: { name: string; targetCents: number; deadline?: string | null; note?: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial ? String(initial.targetCents / 100) : '');
  const [deadline, setDeadline] = useState(initial?.deadline ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const hint = amountHint(target);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the goal a name.');
      return;
    }
    const cents = parseAmountToCents(target);
    if (cents === null || cents <= 0) {
      setError('Enter a valid target amount greater than zero.');
      return;
    }
    onSave({
      name: name.trim(),
      targetCents: cents,
      deadline: deadline || null,
      note: note.trim() || undefined,
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="goal-name">Name</label>
        <input
          id="goal-name"
          type="text"
          className="input"
          placeholder="e.g. Emergency fund"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="goal-target">Target amount</label>
        <AmountInput value={target} onChange={setTarget} />
        {hint && <p className={hint.error ? 'field-hint error' : 'field-hint'}>{hint.text}</p>}
      </div>
      <div className="field">
        <label htmlFor="goal-deadline">Deadline (optional)</label>
        <input
          id="goal-deadline"
          type="date"
          className="input"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="goal-note">Note (optional)</label>
        <input
          id="goal-note"
          type="text"
          className="input"
          placeholder="Why am I saving?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block">
        {initial ? 'Save changes' : 'Create goal'}
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

function FundForm({
  goal,
  mode,
  onClose,
  onSave,
}: {
  goal: Goal;
  mode: 'add' | 'withdraw';
  onClose: () => void;
  onSave: (alloc: { amountCents: number; date: string; note?: string }) => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const hint = amountHint(amount);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (!date) {
      setError('Pick a date.');
      return;
    }
    onSave({
      amountCents: mode === 'add' ? cents : -cents,
      date,
      note: note.trim() || undefined,
    });
  };

  return (
    <form onSubmit={submit}>
      <p className="field-hint">
        {mode === 'add' ? 'Add money to' : 'Withdraw money from'} “{goal.name}”.
      </p>
      <div className="field">
        <label htmlFor="fund-amount">Amount</label>
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        {hint && <p className={hint.error ? 'field-hint error' : 'field-hint'}>{hint.text}</p>}
      </div>
      <div className="field">
        <label htmlFor="fund-date">Date</label>
        <input id="fund-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="fund-note">Note (optional)</label>
        <input
          id="fund-note"
          type="text"
          className="input"
          placeholder="e.g. Monthly deposit"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className={`btn btn-block ${mode === 'add' ? 'btn-primary' : 'btn-soft-danger'}`}>
        {mode === 'add' ? 'Add money' : 'Withdraw'}
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

function GoalDetail({
  goalId,
  onFund,
  onEdit,
  onDelete,
}: {
  goalId: string;
  onFund: (mode: 'add' | 'withdraw') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data, dispatch } = useStore();
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) return null;

  const saved = goalSavedCents(data, goal.id);
  const fromTx = data.transactions
    .filter((t) => t.goalId === goal.id && t.type === 'expense')
    .reduce((s, t) => s + t.amountCents, 0);
  const fromAlloc = goal.allocations.reduce((s, a) => s + a.amountCents, 0);
  const pct = Math.round((saved / goal.targetCents) * 100);
  const allocs = [...goal.allocations].sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : a.date < b.date ? 1 : -1));

  return (
    <div>
      <div className="goal-detail-summary">
        <div className="goal-amounts">
          <span className="goal-big">{formatCOP(saved)}</span>
          <span className="muted">of {formatCOP(goal.targetCents)} · {pct}%</span>
        </div>
        <ProgressBar value={saved} max={goal.targetCents} />
        {(fromAlloc !== 0 || fromTx > 0) && (
          <p className="field-hint">
            Manual: {formatCOP(fromAlloc)} · From transactions: {formatCOP(fromTx)}
          </p>
        )}
        {goal.deadline && (
          <p className="field-hint">
            Deadline: {formatDateShort(goal.deadline)} ·{' '}
            {daysUntil(goal.deadline) < 0
              ? `overdue by ${Math.abs(daysUntil(goal.deadline))} days`
              : `${daysUntil(goal.deadline)} days left`}
          </p>
        )}
        {goal.note && <p className="field-hint">{goal.note}</p>}
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => onFund('add')}>
          Add money
        </button>
        <button type="button" className="btn" onClick={() => onFund('withdraw')}>
          Withdraw
        </button>
      </div>

      <h3 className="section-title">History</h3>
      {allocs.length === 0 && fromTx === 0 ? (
        <p className="field-hint">No activity yet. Add money or mark a transaction as contributing to this goal.</p>
      ) : (
        <>
          {fromTx > 0 && (
            <div className="alloc-row">
              <span className="alloc-main">
                <span className="tx-name">From transactions</span>
                <span className="tx-note">Expenses marked as contributing</span>
              </span>
              <span className="tx-amount income">+{formatCOP(fromTx)}</span>
            </div>
          )}
          {allocs.map((a) => (
            <div key={a.id} className="alloc-row">
              <span className="alloc-main">
                <span className="tx-name">
                  {a.note || (a.amountCents >= 0 ? 'Deposit' : 'Withdrawal')}
                </span>
                <span className="tx-note">{formatDateShort(a.date)}</span>
              </span>
              <span className={`tx-amount ${a.amountCents >= 0 ? 'income' : 'expense'}`}>
                {a.amountCents >= 0 ? '+' : '−'}
                {formatCOP(Math.abs(a.amountCents))}
              </span>
              <button
                type="button"
                className="mini-delete"
                aria-label="Delete entry"
                onClick={() => dispatch({ type: 'deleteAllocation', goalId: goal.id, allocationId: a.id })}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}

      <button type="button" className="btn btn-block" onClick={onEdit}>
        Edit goal
      </button>
      <button type="button" className="btn btn-soft-danger btn-block" onClick={onDelete}>
        Delete goal
      </button>
    </div>
  );
}
