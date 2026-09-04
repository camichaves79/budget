import { formatCOP, parseAmountToCents } from '../src/lib/money';
import { periodForDate, shiftPeriod } from '../src/lib/periods';
import { goalSavedCents, isInPeriod } from '../src/lib/selectors';
import type { AppData } from '../src/lib/types';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// ---- money ----
check('format millions with cents', formatCOP(123456789), '$ 1.234.567,89');
check('format negative', formatCOP(-123456789), '-$ 1.234.567,89');
check('format whole millions', formatCOP(123456700), '$ 1.234.567');
check('format whole small', formatCOP(500), '$ 5');
check('format zero', formatCOP(0), '$ 0');
check('format thousands whole', formatCOP(123400), '$ 1.234');
check('format single cent', formatCOP(1), '$ 0,01');
check('format peso with cents', formatCOP(156), '$ 1,56');
check('parse new format', parseAmountToCents('$ 1.234,56'), 123456);
check('parse whole with dots', parseAmountToCents('$12.345'), 1234500);
check('parse whole with dots and space', parseAmountToCents('$ 12.345'), 1234500);
check('parse apostrophe (legacy)', parseAmountToCents("$1'234,567.89"), 123456789);
check('parse dot-thousands comma-decimal', parseAmountToCents('1.234.567,89'), 123456789);
check('parse plain decimal', parseAmountToCents('1234.56'), 123456);
check('parse comma-thousands', parseAmountToCents('1,234'), 123400);
check('parse comma-decimal short', parseAmountToCents('1,2'), 120);
check('parse integer', parseAmountToCents('1234'), 123400);
check('parse invalid', parseAmountToCents('abc'), null);
check('parse empty', parseAmountToCents('  '), null);
check('parse negative', parseAmountToCents('-50'), -5000);

// ---- periods ----
const oct25 = new Date(2025, 9, 25); // Oct 25, 2025
const oct24 = new Date(2025, 9, 24);
const jan5 = new Date(2026, 0, 5); // Jan 5, 2026
const p1 = periodForDate(oct25);
check('period oct25 key', p1.key, '2025-10');
check('period oct25 start', p1.startISO, '2025-10-25');
check('period oct25 end', p1.endISO, '2025-11-24');
const p2 = periodForDate(oct24);
check('period oct24 key', p2.key, '2025-09');
check('period oct24 start', p2.startISO, '2025-09-25');
check('period oct24 end', p2.endISO, '2025-10-24');
const p3 = periodForDate(jan5);
check('period jan5 key', p3.key, '2025-12');
check('period jan5 end', p3.endISO, '2026-01-24');
check('shift +1 from dec', shiftPeriod(p3, 1).key, '2026-01');
check('shift -1 from dec', shiftPeriod(p3, -1).key, '2025-11');
check('in period inclusive start', isInPeriod('2025-10-25', p1), true);
check('in period inclusive end', isInPeriod('2025-11-24', p1), true);
check('in period excludes next', isInPeriod('2025-11-25', p1), false);
check('in period excludes prev', isInPeriod('2025-10-24', p1), false);

// ---- goal saved ----
const data: AppData = {
  transactions: [
    { id: 't1', type: 'expense', amountCents: 100000, categoryId: 'c1', date: '2025-10-26', goalId: 'g1' },
    { id: 't2', type: 'expense', amountCents: 50000, categoryId: 'c1', date: '2025-10-27' },
    { id: 't3', type: 'income', amountCents: 99900, categoryId: 'c2', date: '2025-10-27', goalId: 'g1' }, // income never counts
  ],
  categories: [],
  budgets: [],
  goals: [
    {
      id: 'g1',
      name: 'Vacation',
      targetCents: 500000,
      allocations: [
        { id: 'a1', amountCents: 200000, date: '2025-10-20' },
        { id: 'a2', amountCents: -50000, date: '2025-10-21' },
      ],
    },
  ],
};
check('goal saved = allocs + contributing expenses', goalSavedCents(data, 'g1'), 250000);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed ✔');
