import { useEffect, useState } from 'react';
import { applyDocumentLanguage, useI18n } from './lib/i18n';
import { useInstallSignal } from './lib/installPrompt';
import type { Period } from './lib/periods';
import { currentPeriod, isCurrentPeriod, shiftPeriod } from './lib/periods';
import { useStore } from './state/store';
import { TabBar } from './components/TabBar';
import { InstallBanner } from './components/InstallBanner';
import { WelcomeModal } from './components/WelcomeModal';
import type { TabKey } from './components/TabBar';
import { Dashboard } from './pages/Dashboard';
import { Budgets } from './pages/Budgets';
import { Categories } from './pages/Categories';
import { Settings } from './pages/Settings';

export default function App() {
  const { data } = useStore();
  const { intl } = useI18n();
  const startDay = data.periodStartDay;
  // First run with no categories lands on the Categories tab
  // (2026-09 user direction); otherwise Cash Flow as always.
  const [tab, setTab] = useState<TabKey>(data.categories.length === 0 ? 'categories' : 'dashboard');
  const [period, setPeriod] = useState<Period>(() => currentPeriod(startDay, intl));
  // Smart-entry sheet, now owned here: the global tab-bar + opens it from
  // any section (the tab switches to Cash Flow first, where the sheet +
  // toast live).
  const [smartOpen, setSmartOpen] = useState(false);
  // The Categories add-category sheet is owned here (controlled) so the
  // smart-entry "no categories" guard can open it right after switching tabs.
  const [catsAdding, setCatsAdding] = useState(false);
  // One-time PWA install nudge (install-app-signal).
  const install = useInstallSignal();

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
  // The "no categories" guards (smart entry + Budgets) send the user here:
  // close the smart sheet, land on the Categories tab, and open the
  // add-category form immediately (2026-09: the guard buttons ARE the
  // add-category action).
  const goToAddCategory = () => {
    setSmartOpen(false);
    setTab('categories');
    setCatsAdding(true);
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
            onGoToCategories={goToAddCategory}
          />
        )}
        {tab === 'budgets' && (
          <Budgets
            period={period}
            onShiftPeriod={shift}
            onToday={jumpToToday}
            isToday={isCurrentPeriod(period, startDay)}
            onGoToCategories={goToAddCategory}
          />
        )}
        {tab === 'categories' && <Categories adding={catsAdding} onAddingChange={setCatsAdding} />}
        {tab === 'settings' && <Settings />}
      </main>

      {/* One-time first-open welcome (first-open-welcome): shown once, before
          any nudge — it's the "what is this + where to start" moment. */}
      <WelcomeModal />
      <InstallBanner
        signal={install.signal}
        onDismiss={install.dismiss}
        onInstall={() => void install.promptInstall()}
      />
      <TabBar active={tab} onChange={setTab} onAdd={openAdd} />
    </div>
  );
}
