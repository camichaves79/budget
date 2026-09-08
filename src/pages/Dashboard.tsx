import { useEffect, useRef, useState } from 'react';
import type { Period } from '../lib/periods';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import { useEntitlement } from '../state/entitlement';
import { categoryById, periodTransactions, totalsFor } from '../lib/selectors';
import { formatMoney } from '../lib/money';
import { formatDateFull } from '../lib/dates';
import { t, useI18n } from '../lib/i18n';
import { PeriodNav } from '../components/PeriodNav';
import { EmptyState } from '../components/EmptyState';
import { Sheet } from '../components/Sheet';
import { TransactionForm } from '../components/TransactionForm';
import { SmartEntry } from '../components/SmartEntry';
import { Toast } from '../components/Toast';
import type { ToastData } from '../components/Toast';

/** Merged Home + Transactions: pinned cash flow, scrolling transaction list. */
export function Dashboard({
  period,
  onShiftPeriod,
  onToday,
  isToday,
  smartOpen,
  onCloseSmart,
}: {
  period: Period;
  onShiftPeriod: (delta: number) => void;
  onToday: () => void;
  isToday?: boolean;
  smartOpen: boolean;
  onCloseSmart: () => void;
}) {
  const { data, dispatch } = useStore();
  const { lastEvent } = useEntitlement();
  const { intl } = useI18n();
  const txs = periodTransactions(data, period);
  const totals = totalsFor(data, period);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  // One-shot entitlement events (purchase completed, license lost) surface as
  // the dashboard's fading toast — e.g. right after the checkout redirect.
  // Deferred a microtask so the state update lands after the render cycle.
  const shownEventRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lastEvent || shownEventRef.current === lastEvent.at) return;
    shownEventRef.current = lastEvent.at;
    const { kind, at } = lastEvent;
    queueMicrotask(() => {
      setToast({
        id: at,
        kind: kind === 'licensed' ? 'success' : 'error',
        message:
          kind === 'licensed'
            ? t('license.activeNote')
            : t('license.lostNote'),
      });
    });
  }, [lastEvent]);

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

  const openEdit = (t: Transaction) => {
    setEditing(t);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="pinned-page">
      <div className="pinned-head">
        <PeriodNav period={period} onShift={onShiftPeriod} onToday={onToday} isToday={isToday} />

        <h2 className="section-title page-label">{t('dashboard.cashFlow')}</h2>
        <section className="summary-grid" aria-label={t('dashboard.periodSummary')}>
          <div className="summary-card">
            <span className="summary-label">{t('dashboard.income')}</span>
            <span className="summary-value income">{formatMoney(totals.income)}</span>
          </div>
          <div className="summary-card">
            <span className="summary-label">{t('dashboard.expenses')}</span>
            <span className="summary-value expense">{formatMoney(totals.expense)}</span>
          </div>
          <div className="summary-card balance">
            <span className="summary-label">{t('dashboard.balance')}</span>
            <span className={totals.net >= 0 ? 'summary-value income' : 'summary-value negative'}>
              {formatMoney(totals.net)}
            </span>
          </div>
        </section>

        <h2 className="section-title page-label divider">{t('dashboard.transactions')}</h2>
      </div>

      <div className="pinned-scroll">
        {txs.length === 0 ? (
          <EmptyState
            emoji="🧾"
            title={t('dashboard.noTxTitle')}
            hint={
              <>
                {t('dashboard.noTxHintBefore')}
                <span className="empty-hint-dollar">$</span>
                {t('dashboard.noTxHintAfter')}
              </>
            }
          />
        ) : (
          <div className="tx-list" aria-label={t('dashboard.txList')}>
            {groups.map(([date, group]) => {
              const net = dayNet.get(date) ?? 0;
              return (
                <section key={date}>
                  <div className="day-head">
                    <span>{formatDateFull(date, intl)}</span>
                    <span className={`day-total ${net >= 0 ? 'income' : 'expense'}`}>
                      {formatMoney(net)}
                    </span>
                  </div>
                  {group.map((t) => {
                    const cat = categoryById(data, t.categoryId);
                    const sign = t.type === 'income' ? '+' : '−';
                    return (
                      <button key={t.id} type="button" className="tx-row" onClick={() => openEdit(t)}>
                        <span
                          className="tx-emoji"
                          style={{
                            background: t.type === 'income' ? 'var(--income-soft)' : 'var(--neutral-tint)',
                          }}
                        >
                          {cat?.emoji ?? '❓'}
                        </span>
                        <span className="tx-main">
                          <span className="tx-name">{cat?.name ?? 'Unknown'}</span>
                          {t.note && <span className="tx-note">{t.note}</span>}
                        </span>
                        <span className={`tx-amount ${t.type}`}>
                          {sign}
                          {formatMoney(t.amountCents)}
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Sheet className="sheet-tight" open={smartOpen} onClose={onCloseSmart} title={t('dashboard.tellMe')}>
        <SmartEntry
          onClose={onCloseSmart}
          onToast={(kind, message) => setToast({ id: Date.now(), kind, message })}
        />
      </Sheet>

      {toast && <Toast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}

      <Sheet className="sheet-tight" open={formOpen} onClose={closeForm} title={editing ? t('dashboard.editTx') : t('dashboard.tellMe')}>
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
