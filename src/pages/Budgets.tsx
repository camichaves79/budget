import { useState } from 'react';
import { t } from '../lib/i18n';
import type { FormEvent } from 'react';
import type { Period } from '../lib/periods';
import type { Category } from '../lib/types';
import { useStore } from '../state/store';
import { activeCategories, spentByCategory } from '../lib/selectors';
import { formatMoney, parseAmountToCents } from '../lib/money';
import { PeriodNav } from '../components/PeriodNav';
import { Sheet } from '../components/Sheet';
import { ProgressBar } from '../components/ProgressBar';
import { AmountInput, amountHint } from '../components/AmountInput';
import { EmptyState } from '../components/EmptyState';

export function Budgets({
  period,
  onShiftPeriod,
  onToday,
  isToday,
  onGoToCategories,
}: {
  period: Period;
  onShiftPeriod: (delta: number) => void;
  onToday: () => void;
  isToday?: boolean;
  onGoToCategories: () => void;
}) {
  const { data, dispatch } = useStore();
  const spent = spentByCategory(data, period);
  const cats = activeCategories(data, 'expense');

  const rows = cats
    .map((cat) => {
      const limit = data.budgets.find((b) => b.categoryId === cat.id)?.amountCents ?? 0;
      return { cat, limit, spent: spent.get(cat.id) ?? 0 };
    })
    .sort((a, b) => b.spent / (b.limit || 1) - a.spent / (a.limit || 1));

  const withBudget = rows.filter((r) => r.limit > 0);
  const withoutBudget = rows.filter((r) => r.limit === 0);
  const totalLimit = withBudget.reduce((s, r) => s + r.limit, 0);
  const totalSpent = withBudget.reduce((s, r) => s + r.spent, 0);

  const [editing, setEditing] = useState<Category | null>(null);

  return (
    <div className="pinned-page">
      <div className="pinned-head">
        <PeriodNav period={period} onShift={onShiftPeriod} onToday={onToday} isToday={isToday} />

        {withBudget.length > 0 && (
          <section className="card">
            <div className="budget-summary">
              <span>
                <strong>{formatMoney(totalSpent)}</strong>{' '}
                <strong>{formatMoney(totalSpent)}</strong> {t('budgets.spentOf')}{' '}
                {formatMoney(totalLimit)} {t('budgets.budgeted')}
              </span>
              <span className={totalSpent > totalLimit ? 'over' : 'muted'}>
                {t('budgets.left', { amount: formatMoney(totalLimit - totalSpent) })}
              </span>
            </div>
          </section>
        )}
      </div>

      <div className="pinned-scroll">
        {cats.length === 0 ? (
          <>
            <EmptyState emoji="🎯" title={t('budgets.noExpCats')} hint={t('budgets.noExpCatsHint')} />
            <button type="button" className="btn btn-primary btn-block" onClick={onGoToCategories}>
              {t('cats.goToCategories')}
            </button>
          </>
        ) : (
          <>

          {withBudget.length > 0 && (
            <section className="card" aria-label={t('budgets.withBudgetsAria')}>
              {withBudget.map(({ cat, limit, spent: s }) => (
                <button
                  key={cat.id}
                  type="button"
                  className={s > limit ? 'budget-row budget-row-btn over-budget-row' : 'budget-row budget-row-btn'}
                  onClick={() => setEditing(cat)}
                >
                  <div className="budget-row-head">
                    <span className="budget-name">
                      <span className="row-emoji" style={{ background: 'var(--neutral-tint)' }}>
                        {cat.emoji}
                      </span>
                      {cat.name}
                    </span>
                    <span className={s > limit ? 'amounts over' : 'amounts'}>
                      {formatMoney(s)} <span className="muted">/ {formatMoney(limit)}</span>
                    </span>
                  </div>
                  <ProgressBar value={s} max={limit} />
                  {s > limit && <span className="over-chip">{t('budgets.overBy', { amount: formatMoney(s - limit) })}</span>}
                </button>
              ))}
            </section>
          )}

          {withoutBudget.length > 0 && (
            <section className="card" aria-label={t('budgets.withoutBudgetsAria')}>
              <h3 className="section-title">{t('budgets.noLimitYet')}</h3>
              {withoutBudget.map(({ cat, spent: s }) => (
                <button
                  key={cat.id}
                  type="button"
                  className="budget-row budget-row-btn"
                  onClick={() => setEditing(cat)}
                >
                  <div className="budget-row-head">
                    <span className="budget-name">
                      <span className="row-emoji" style={{ background: 'var(--neutral-tint)' }}>
                        {cat.emoji}
                      </span>
                      {cat.name}
                    </span>
                    <span className="amounts muted">
                      {s > 0 ? t('budgets.spentLabel', { amount: formatMoney(s) }) : t('budgets.setLimit')}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          )}
        </>
        )}
      </div>

      <Sheet className="sheet-tight" open={editing !== null} onClose={() => setEditing(null)} title={editing ? `${editing.emoji} ${editing.name}` : ''}>
        {editing && (
          <BudgetEditor
            key={editing.id}
            currentLimit={data.budgets.find((b) => b.categoryId === editing.id)?.amountCents ?? 0}
            spent={spent.get(editing.id) ?? 0}
            onClose={() => setEditing(null)}
            onSave={(cents) => {
              dispatch({ type: 'setBudget', categoryId: editing.id, amountCents: cents });
              setEditing(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function BudgetEditor({
  currentLimit,
  spent,
  onClose,
  onSave,
}: {
  currentLimit: number;
  spent: number;
  onClose: () => void;
  onSave: (cents: number | null) => void;
}) {
  const [value, setValue] = useState(currentLimit > 0 ? String(currentLimit / 100) : '');
  const [error, setError] = useState('');
  const hint = amountHint(value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() === '') {
      onSave(null); // clearing the field removes the limit
      return;
    }
    const cents = parseAmountToCents(value);
    if (cents === null || cents <= 0) {
      setError(t('tx.errAmount'));
      return;
    }
    onSave(cents);
  };

  return (
    <form onSubmit={submit}>
      <p className="field-hint">
        {spent > 0
          ? t('budgets.spentThisPeriod', { amount: formatMoney(spent) })
          : t('budgets.noneThisPeriod')}
      </p>
      <div className="field">
        <AmountInput label={t('budgets.monthlyLimit')} value={value} onChange={setValue} autoFocus />
        {hint && <p className={hint.error ? 'field-hint error' : 'field-hint'}>{hint.text}</p>}
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block">
        {value.trim() === '' ? t('budgets.removeLimit') : t('budgets.saveLimit')}
      </button>
      {currentLimit > 0 && (
        <button
          type="button"
          className="btn btn-block"
          onClick={() => {
            setValue('');
            onSave(null);
          }}
        >
          {t('budgets.removeLimit')}
        </button>
      )}
      <button type="button" className="btn btn-block" onClick={onClose}>
        {t('smart.cancel')}
      </button>
    </form>
  );
}
