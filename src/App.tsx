import { useEffect, useState } from 'react';
import { applyDocumentLanguage, useI18n } from './lib/i18n';
import type { Period } from './lib/periods';
import { currentPeriod, isCurrentPeriod, shiftPeriod } from './lib/periods';
import { useStore } from './state/store';
import { TabBar } from './components/TabBar';
import type { TabKey } from './components/TabBar';
import { Dashboard } from './pages/Dashboard';
import { Budgets } from './pages/Budgets';
import { Categories } from './pages/Categories';
import { Settings } from './pages/Settings';

export default function App() {
  const { data } = useStore();
  const { intl } = useI18n();
  const startDay = data.periodStartDay;
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [period, setPeriod] = useState<Period>(() => currentPeriod(startDay, intl));
  // Smart-entry sheet, now owned here: the global tab-bar + opens it from
  // any section (the tab switches to Cash Flow first, where the sheet +
  // toast live).
  const [smartOpen, setSmartOpen] = useState(false);

  // Keep <html lang/dir> in sync with the chosen language (RTL for ar/ur).
  useEffect(() => {
    applyDocumentLanguage();
  }, [intl]);

  // When the period start day or the language changes, snap back to the
  // current period (labels are locale-rendered).
  useEffect(() => {
    setPeriod(currentPeriod(startDay, intl));
  }, [startDay, intl]);

  const shift = (delta: number) => setPeriod((p) => shiftPeriod(p, delta, intl));
  const jumpToToday = () => setPeriod(currentPeriod(startDay, intl));
  const openAdd = () => {
    setTab('dashboard');
    setSmartOpen(true);
  };

  return (
    <div className="app">
      <main
        className={tab === 'dashboard' || tab === 'budgets' || tab === 'categories' ? 'app-main fixed-main' : 'app-main'}
        key={tab}
      >
        {tab === 'dashboard' && (
          <Dashboard
            period={period}
            onShiftPeriod={shift}
            onToday={jumpToToday}
            isToday={isCurrentPeriod(period, startDay)}
            smartOpen={smartOpen}
            onCloseSmart={() => setSmartOpen(false)}
          />
        )}
        {tab === 'budgets' && (
          <Budgets period={period} onShiftPeriod={shift} onToday={jumpToToday} isToday={isCurrentPeriod(period, startDay)} />
        )}
        {tab === 'categories' && <Categories />}
        {tab === 'settings' && <Settings />}
      </main>

      <TabBar active={tab} onChange={setTab} onAdd={openAdd} />
    </div>
  );
}
