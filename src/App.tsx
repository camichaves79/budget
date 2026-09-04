import { useState } from 'react';
import type { Period } from './lib/periods';
import { currentPeriod, shiftPeriod } from './lib/periods';
import { TabBar } from './components/TabBar';
import type { TabKey } from './components/TabBar';
import { Dashboard } from './pages/Dashboard';
import { Budgets } from './pages/Budgets';
import { Goals } from './pages/Goals';
import { Settings } from './pages/Settings';

export default function App() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [period, setPeriod] = useState<Period>(() => currentPeriod());

  const shift = (delta: number) => setPeriod((p) => shiftPeriod(p, delta));
  const jumpToToday = () => setPeriod(currentPeriod());

  return (
    <div className="app">
      <main className={tab === 'dashboard' ? 'app-main dashboard-main' : 'app-main'} key={tab}>
        {tab === 'dashboard' && (
          <Dashboard period={period} onShiftPeriod={shift} onToday={jumpToToday} goTo={setTab} />
        )}
        {tab === 'budgets' && <Budgets period={period} onShiftPeriod={shift} onToday={jumpToToday} />}
        {tab === 'goals' && <Goals />}
        {tab === 'settings' && <Settings />}
      </main>

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
