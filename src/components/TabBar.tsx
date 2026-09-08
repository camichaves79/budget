import { t } from '../lib/i18n';

export type TabKey = 'dashboard' | 'budgets' | 'categories' | 'settings';

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function TabBar({
  active,
  onChange,
  onAdd,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  onAdd: () => void;
}) {
  const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    {
      key: 'dashboard',
      label: t('tabs.cashFlow'),
      icon: (
        <svg {...ICON_PROPS}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M6 12h.01" />
          <path d="M18 12h.01" />
        </svg>
      ),
    },
    {
      key: 'budgets',
      label: t('tabs.budgets'),
      icon: (
        <svg {...ICON_PROPS}>
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
      ),
    },
    {
      key: 'categories',
      label: t('tabs.categories'),
      icon: (
        <svg {...ICON_PROPS}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <circle cx="3.8" cy="6" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="3.8" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="3.8" cy="18" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      key: 'settings',
      label: t('tabs.settings'),
      icon: (
        <svg {...ICON_PROPS}>
          <path d="M4 7h16" />
          <circle cx="9" cy="7" r="2.2" />
          <path d="M4 17h16" />
          <circle cx="15" cy="17" r="2.2" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="tab-bar" aria-label={t('tabs.mainNav')}>
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={active === tab.key ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.key)}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
      {/* Global add button (2026-09): bold $, centered on the bar, its
          horizontal diameter aligned with the bar's upper side. */}
      <button type="button" className="tab-bar-add" onClick={onAdd} aria-label={t('tabs.addTransaction')}>
        <span className="tab-bar-add-glyph" aria-hidden="true">
          $
        </span>
      </button>
    </nav>
  );
}
