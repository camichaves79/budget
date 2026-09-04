import { formatCOP, parseAmountToCents } from '../src/lib/money';
import { periodForDate, shiftPeriod } from '../src/lib/periods';
import { isInPeriod } from '../src/lib/selectors';

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
check('format millions rounds up', formatCOP(123456789), '$ 1.234.568');
check('format negative', formatCOP(-123456789), '-$ 1.234.568');
check('format whole millions', formatCOP(123456700), '$ 1.234.567');
check('format whole small', formatCOP(500), '$ 5');
check('format zero', formatCOP(0), '$ 0');
check('format thousands whole', formatCOP(123400), '$ 1.234');
check('format one centavo rounds down', formatCOP(1), '$ 0');
check('format 1.49 rounds down', formatCOP(149), '$ 1');
check('format 1.50 rounds up', formatCOP(150), '$ 2');
check('format 1.56 rounds up', formatCOP(156), '$ 2');
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

// ---- periods (labeled by the month they end in) ----
const oct25 = new Date(2025, 9, 25); // Oct 25, 2025 → ends Nov 24
const oct24 = new Date(2025, 9, 24); // → ends Oct 24
const jan5 = new Date(2026, 0, 5); // Jan 5, 2026 → ends Jan 24
const aug25 = new Date(2026, 7, 25); // Aug 25, 2026 → ends Sep 24
const p1 = periodForDate(oct25);
check('period oct25 key', p1.key, '2025-11');
check('period oct25 label', p1.label, 'November 2025');
check('period oct25 start', p1.startISO, '2025-10-25');
check('period oct25 end', p1.endISO, '2025-11-24');
const p2 = periodForDate(oct24);
check('period oct24 key', p2.key, '2025-10');
check('period oct24 start', p2.startISO, '2025-09-25');
check('period oct24 end', p2.endISO, '2025-10-24');
const p3 = periodForDate(jan5);
check('period jan5 key', p3.key, '2026-01');
check('period jan5 end', p3.endISO, '2026-01-24');
check('user example aug25', periodForDate(aug25).label, 'September 2026');
check('user example aug25 key', periodForDate(aug25).key, '2026-09');
check('shift +1 from jan', shiftPeriod(p3, 1).key, '2026-02');
check('shift -1 from jan', shiftPeriod(p3, -1).key, '2025-12');
check('in period inclusive start', isInPeriod('2025-10-25', p1), true);
check('in period inclusive end', isInPeriod('2025-11-24', p1), true);
check('in period excludes next', isInPeriod('2025-11-25', p1), false);
check('in period excludes prev', isInPeriod('2025-10-24', p1), false);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed ✔');
