import { useEffect, useState } from 'react';
import type { Period } from './lib/periods';
import { currentPeriod, isCurrentPeriod, shiftPeriod } from './lib/periods';
import { useStore } from './state/store';
import { TabBar } from './components/TabBar';
import type { TabKey } from './components/TabBar';
import { Dashboard } from './pages/Dashboard';
import { Budgets } from './pages/Budgets';
import { Settings } from './pages/Settings';

export default function App() {
  const { data } = useStore();
  const startDay = data.periodStartDay;
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [period, setPeriod] = useState<Period>(() => currentPeriod(startDay));

  // When the period start day changes in Settings, snap back to the current
  // period under the new rule.
  useEffect(() => {
    setPeriod(currentPeriod(startDay));
  }, [startDay]);

  const shift = (delta: number) => setPeriod((p) => shiftPeriod(p, delta));
  const jumpToToday = () => setPeriod(currentPeriod(startDay));

  return (
    <div className="app">
      <main
        className={tab === 'dashboard' || tab === 'budgets' ? 'app-main fixed-main' : 'app-main'}
        key={tab}
      >
        {tab === 'dashboard' && (
          <Dashboard
            period={period}
            onShiftPeriod={shift}
            onToday={jumpToToday}
            isToday={isCurrentPeriod(period, startDay)}
          />
        )}
        {tab === 'budgets' && (
          <Budgets period={period} onShiftPeriod={shift} onToday={jumpToToday} isToday={isCurrentPeriod(period, startDay)} />
        )}
        {tab === 'settings' && <Settings />}
      </main>

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
