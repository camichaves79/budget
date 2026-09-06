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

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  {
    key: 'dashboard',
    label: 'Cash Flow',
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
    label: 'Budgets',
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
    label: 'Categories',
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
    label: 'Settings',
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

export function TabBar({
  active,
  onChange,
  onAdd,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={active === t.key ? 'tab active' : 'tab'}
          onClick={() => onChange(t.key)}
          aria-current={active === t.key ? 'page' : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
      {/* Global add button (2026-09): plain +, centered on the bar, its
          horizontal diameter aligned with the bar's upper side. */}
      <button type="button" className="tab-bar-add" onClick={onAdd} aria-label="Add transaction">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>
    </nav>
  );
}
