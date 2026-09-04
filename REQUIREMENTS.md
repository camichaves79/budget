# Budget App — Requirements v1

**Product:** Mobile-first web app for personal budgeting (single user).
**Storage:** TBD (localStorage vs. SQLite — see §10). No accounts, no backend, data never leaves the device.
**Currency:** Colombian Peso (COP), formatted `$ 1.234,56` (space after $, dots for thousands, comma for decimals, whole values without decimals).

---

## 1. Objectives

1. Track income and expenses quickly and painlessly.
2. See, at a glance, how much of each category's monthly budget has been spent.
3. Work fully offline and keep data private on the device.

## 2. In scope (v1)

### 2.1 Transactions (income & expense tracking)
- Add a transaction: **type** (income | expense), **amount**, **category**, **date**, optional **note**.
- Edit and delete any transaction.
- List transactions for a month, with running totals (income, expense, net).
- Data survives page reloads and browser restarts.

### 2.2 Category budgets
- Every expense category can have a **monthly limit**.
- **Budget period:** runs from the **25th of one month to the 24th of the next** (e.g., "November" = Oct 25 – Nov 24). The period is labeled by the month it ends in.
- Budget screen shows, per category: spent / limit with a progress bar and over-budget highlighting.
- Progress bars are tonal, not traffic-light: thin slate track with mint fill 0–75%, engraving green 76–99%, copper bar at 100%+ with a soft copper row tint.
- Budgets repeat automatically every period; limits can be changed at any time.

### 2.3 Dashboard (home)
- Current month summary: income, expenses, balance.
- Budget progress for the current month (top categories).

## 3. Categories

Default categories (editable — user can add, rename, hide, delete):

| Kind     | Defaults |
|----------|----------|
| Expense  | Vivienda, Servicios, Mercado, Transporte, Salud, Educación, Entretenimiento, Restaurantes, Ropa, Otros |
| Income   | Salario, Freelance, Otros ingresos |

## 4. Currency rules

- Format: `$ 1.234,56` — "$" followed by a space, dots for thousands, comma for decimals (2 digits). Whole values show no decimals: `$ 12.345`.
- Negative values: `-$ 1.234,56`.
- Amounts stored as integer **centavos** internally to avoid floating-point errors.
- Input parser accepts flexible formats (`$ 1.234,56`, `1.234.567,89`, `1,234.56`, `1234`, `1'234`).

## 5. Pages / navigation

Bottom tab bar (mobile-first):

1. **Cash Flow** — period summary (income / expenses / balance), transaction list with add / edit / delete, and budget progress. *(Home and Transactions merged into one view.)*
2. **Budgets** — set and review monthly limits per category.
3. **Settings** — manage categories; export / import data (JSON backup); reset all data.

## 6. Out of scope (v1)

- Bank sync / automatic import, CSV import
- Multiple users / accounts / cloud sync
- Charts & graphs (progress bars and numbers only)
- Recurring transactions
- Multiple currencies

## 7. Non-functional

- Mobile-first responsive UI (usable on phone and desktop).
- Fast: local-only reads/writes, no network calls.
- Private: nothing is sent to any server.
- Error-safe: invalid input is blocked with clear messages; data export is available as a backup.

## 8. Recommended tech stack (proposal)

- **Vite + React + TypeScript** — fast dev experience, static build.
- **localStorage** persistence with a versioned JSON schema.
- **CSS** (plain, with CSS variables) — no UI framework needed for v1.
- Static deployment possible later (e.g., GitHub Pages / Netlify).

## 9. Confirmed decisions

1. **UI language:** English.
2. **Budget period:** starts on the 25th of each month (25th → 24th of next month).
3. **Storage:** TBD — see §10.

## 10. Storage (decided)

**localStorage for v1**, behind a small storage-module interface so we can swap in SQLite (browser WASM) later without touching UI code.

- Persists across reloads and browser restarts; lost only if site data is cleared.
- Every change auto-saves immediately.
- JSON export/import in Settings acts as the backup / device-migration path.
