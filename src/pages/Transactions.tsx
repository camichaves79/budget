import { useState } from 'react';
import type { Period } from '../lib/periods';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import { categoryById, periodTransactions } from '../lib/selectors';
import { formatCOP } from '../lib/money';
import { formatDateFull } from '../lib/dates';
import { PeriodNav } from '../components/PeriodNav';
import { Sheet } from '../components/Sheet';
import { TransactionForm } from '../components/TransactionForm';
import { EmptyState } from '../components/EmptyState';

export function Transactions({
  period,
  onShiftPeriod,
  onToday,
}: {
  period: Period;
  onShiftPeriod: (delta: number) => void;
  onToday: () => void;
}) {
  const { data, dispatch } = useStore();
  const txs = periodTransactions(data, period);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const groups: Array<[string, Transaction[]]> = [];
  const dayNet = new Map<string, number>();
  for (const t of txs) {
    const delta = t.type === 'income' ? t.amountCents : -t.amountCents;
    dayNet.set(t.date, (dayNet.get(t.date) ?? 0) + delta);
    const last = groups[groups.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else groups.push([t.date, [t]]);
  }

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (t: Transaction) => {
    setEditing(t);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div>
      <PeriodNav period={period} onShift={onShiftPeriod} onToday={onToday} />

      {txs.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No transactions in this period"
          hint="Tap + to record income or an expense."
        />
      ) : (
        <div className="tx-list" aria-label="Transactions">
          {groups.map(([date, group]) => {
            const net = dayNet.get(date) ?? 0;
            return (
              <section key={date}>
                <div className="day-head">
                  <span>{formatDateFull(date)}</span>
                  <span className={net >= 0 ? 'income' : 'expense'}>{formatCOP(net)}</span>
                </div>
                {group.map((t) => {
                  const cat = categoryById(data, t.categoryId);
                  const goal = t.goalId ? data.goals.find((g) => g.id === t.goalId) : undefined;
                  const sign = t.type === 'income' ? '+' : '−';
                  return (
                    <button key={t.id} type="button" className="tx-row" onClick={() => openEdit(t)}>
                      <span
                        className="tx-emoji"
                        style={{ background: `${cat?.color ?? '#94a3b8'}1f` }}
                      >
                        {cat?.emoji ?? '❓'}
                      </span>
                      <span className="tx-main">
                        <span className="tx-name">{cat?.name ?? 'Unknown'}</span>
                        {t.note && <span className="tx-note">{t.note}</span>}
                        {goal && <span className="tx-goal">🎯 {goal.name}</span>}
                      </span>
                      <span className={`tx-amount ${t.type}`}>
                        {sign}
                        {formatCOP(t.amountCents)}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <button type="button" className="fab" onClick={openAdd} aria-label="Add transaction">
        +
      </button>

      <Sheet open={formOpen} onClose={closeForm} title={editing ? 'Edit transaction' : 'New transaction'}>
        <TransactionForm
          key={editing?.id ?? 'new'}
          initial={editing}
          onSave={(tx) => {
            if (editing) dispatch({ type: 'updateTransaction', id: editing.id, patch: tx });
            else dispatch({ type: 'addTransaction', tx });
            closeForm();
          }}
          onDelete={
            editing
              ? () => {
                  dispatch({ type: 'deleteTransaction', id: editing.id });
                  closeForm();
                }
              : undefined
          }
        />
      </Sheet>
    </div>
  );
}
