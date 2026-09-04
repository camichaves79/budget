export type TabKey = 'dashboard' | 'budgets' | 'settings';

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
    label: 'Dashboard',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    key: 'budgets',
    label: 'Budgets',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="0.5" fill="currentColor" />
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

export function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
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
    </nav>
  );
}
