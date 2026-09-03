import type { Period } from '../lib/periods';
import { useStore } from '../state/store';
import { categoryById, goalSavedCents, spentByCategory, totalsFor } from '../lib/selectors';
import { formatCOP } from '../lib/money';
import { PeriodNav } from '../components/PeriodNav';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';
import type { TabKey } from '../components/TabBar';

export function Home({
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
  const { data } = useStore();
  const totals = totalsFor(data, period);
  const spent = spentByCategory(data, period);

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
  const hasAnything = data.transactions.length > 0 || data.budgets.length > 0 || data.goals.length > 0;

  return (
    <div>
      <PeriodNav period={period} onShift={onShiftPeriod} onToday={onToday} />
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
          <span className="summary-label">Net</span>
          <span className={totals.net >= 0 ? 'summary-value income' : 'summary-value expense'}>
            {formatCOP(totals.net)}
          </span>
        </div>
      </section>

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

      {!hasAnything && (
        <EmptyState
          emoji="💰"
          title="Welcome to your budget"
          hint="Add your first transaction, set a category budget, or create a savings goal."
          action={
            <button type="button" className="btn btn-primary" onClick={() => goTo('transactions')}>
              Add a transaction
            </button>
          }
        />
      )}
    </div>
  );
}
