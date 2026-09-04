import { useState } from 'react';
import type { Period } from '../lib/periods';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import {
  categoryById,
  goalSavedCents,
  periodTransactions,
  spentByCategory,
  totalsFor,
} from '../lib/selectors';
import { formatCOP } from '../lib/money';
import { formatDateFull } from '../lib/dates';
import { PeriodNav } from '../components/PeriodNav';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import { TransactionForm } from '../components/TransactionForm';
import type { TabKey } from '../components/TabBar';

/** Merged Home + Transactions: period summary, transaction list, budgets, goals. */
export function Dashboard({
  period,
  onShiftPeriod,
  onToday,
  goTo,
}: {
  period: Period;
  onShiftPeriod: (delta: number) => void;
  onToday: () => void;
  goTo: (tab: TabKey) => void;
}) {
  const { data, dispatch } = useStore();
  const txs = periodTransactions(data, period);
  const totals = totalsFor(data, period);
  const spent = spentByCategory(data, period);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  // Group transactions by date (newest first); track the net per day.
  const groups: Array<[string, Transaction[]]> = [];
  const dayNet = new Map<string, number>();
  for (const t of txs) {
    const delta = t.type === 'income' ? t.amountCents : -t.amountCents;
    dayNet.set(t.date, (dayNet.get(t.date) ?? 0) + delta);
    const last = groups[groups.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else groups.push([t.date, [t]]);
  }

  const budgetRows = data.budgets
    .map((b) => {
      const cat = categoryById(data, b.categoryId);
      return cat && !cat.archived
        ? { cat, limit: b.amountCents, spent: spent.get(b.categoryId) ?? 0 }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
    .slice(0, 4);

  const goalRows = data.goals.map((g) => ({ goal: g, saved: goalSavedCents(data, g.id) }));

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

      <h2 className="section-title summary-heading">Cash flow</h2>
      <section className="summary-grid" aria-label="Period summary">
        <div className="summary-card">
          <span className="summary-label">Income</span>
          <span className="summary-value income">{formatCOP(totals.income)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Expenses</span>
          <span className="summary-value expense">{formatCOP(totals.expense)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Balance</span>
          <span className={totals.net >= 0 ? 'summary-value income' : 'summary-value expense'}>
            {formatCOP(totals.net)}
          </span>
        </div>
      </section>

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

      {budgetRows.length > 0 && (
        <section className="card" aria-label="Budget progress">
          <div className="card-head">
            <h3>Budgets</h3>
            <button type="button" className="link-btn" onClick={() => goTo('budgets')}>
              See all
            </button>
          </div>
          {budgetRows.map(({ cat, limit, spent: s }) => (
            <div key={cat.id} className="budget-row">
              <div className="budget-row-head">
                <span className="budget-name">
                  <span className="row-emoji" style={{ background: `${cat.color}1f` }}>
                    {cat.emoji}
                  </span>
                  {cat.name}
                </span>
                <span className={s > limit ? 'amounts over' : 'amounts'}>
                  {formatCOP(s)} <span className="muted">/ {formatCOP(limit)}</span>
                </span>
              </div>
              <ProgressBar value={s} max={limit} color={cat.color} />
            </div>
          ))}
        </section>
      )}

      {goalRows.length > 0 && (
        <section className="card" aria-label="Savings goals">
          <div className="card-head">
            <h3>Goals</h3>
            <button type="button" className="link-btn" onClick={() => goTo('goals')}>
              See all
            </button>
          </div>
          {goalRows.map(({ goal, saved }) => (
            <div key={goal.id} className="budget-row">
              <div className="budget-row-head">
                <span className="budget-name">
                  <span className="row-emoji" style={{ background: 'var(--accent-soft)' }}>
                    🎯
                  </span>
                  {goal.name}
                </span>
                <span className="amounts">
                  {formatCOP(saved)} <span className="muted">/ {formatCOP(goal.targetCents)}</span>
                </span>
              </div>
              <ProgressBar value={saved} max={goal.targetCents} />
            </div>
          ))}
        </section>
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
