import { useState } from 'react';
import type { Period } from './lib/periods';
import { currentPeriod, shiftPeriod } from './lib/periods';
import { TabBar } from './components/TabBar';
import type { TabKey } from './components/TabBar';
import { Home } from './pages/Home';
import { Transactions } from './pages/Transactions';
import { Budgets } from './pages/Budgets';
import { Goals } from './pages/Goals';
import { Settings } from './pages/Settings';

const TITLES: Record<TabKey, string> = {
  home: 'Home',
  transactions: 'Transactions',
  budgets: 'Budgets',
  goals: 'Goals',
  settings: 'Settings',
};

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [period, setPeriod] = useState<Period>(() => currentPeriod());

  const shift = (delta: number) => setPeriod((p) => shiftPeriod(p, delta));
  const jumpToToday = () => setPeriod(currentPeriod());

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo" aria-hidden="true">
          💰
        </span>
        <h1>{TITLES[tab]}</h1>
      </header>

      <main className="app-main" key={tab}>
        {tab === 'home' && <Home period={period} onShiftPeriod={shift} onToday={jumpToToday} goTo={setTab} />}
        {tab === 'transactions' && (
          <Transactions period={period} onShiftPeriod={shift} onToday={jumpToToday} />
        )}
        {tab === 'budgets' && <Budgets period={period} onShiftPeriod={shift} onToday={jumpToToday} />}
        {tab === 'goals' && <Goals />}
        {tab === 'settings' && <Settings />}
      </main>

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
