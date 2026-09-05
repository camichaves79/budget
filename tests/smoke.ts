import { formatCOP, parseAmountToCents } from '../src/lib/money';
import { isValidISODate } from '../src/lib/dates';
import { periodForDate, shiftPeriod } from '../src/lib/periods';
import { isInPeriod } from '../src/lib/selectors';
import { validateParsedTransaction } from '../src/lib/parseService';
import { checkRateLimit, createRateLimiter, parseGeminiResponse, sanitizeRequest } from '../api/parse.js';
import type { Category } from '../src/lib/types';

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
check('format millions rounds up', formatCOP(123456789), '$\u00A01.234.568');
check('format negative', formatCOP(-123456789), '-$\u00A01.234.568');
check('format whole millions', formatCOP(123456700), '$\u00A01.234.567');
check('format whole small', formatCOP(500), '$\u00A05');
check('format zero', formatCOP(0), '$\u00A00');
check('format thousands whole', formatCOP(123400), '$\u00A01.234');
check('format one centavo rounds down', formatCOP(1), '$\u00A00');
check('format 1.49 rounds down', formatCOP(149), '$\u00A01');
check('format 1.50 rounds up', formatCOP(150), '$\u00A02');
check('format 1.56 rounds up', formatCOP(156), '$\u00A02');
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

// ---- dates: strict ISO calendar validation ----
check('isodate valid', isValidISODate('2026-09-03'), true);
check('isodate bad format', isValidISODate('03/09/2026'), false);
check('isodate bad month', isValidISODate('2026-13-01'), false);
check('isodate bad day', isValidISODate('2026-02-30'), false);
check('isodate leap day ok', isValidISODate('2024-02-29'), true);
check('isodate garbage', isValidISODate('nope'), false);

// ---- AI parsing: pure validation of LLM output (client trust boundary) ----
const parseCats: Category[] = [
  { id: 'c-mercado', name: 'Mercado', kind: 'expense', emoji: '🛒', color: '#000', archived: false },
  { id: 'c-salario', name: 'Salario', kind: 'income', emoji: '💼', color: '#000', archived: false },
  { id: 'c-old', name: 'Old', kind: 'expense', emoji: '🧾', color: '#000', archived: true },
];

check(
  'parse valid expense',
  validateParsedTransaction({ type: 'expense', amount: 35, categoryId: 'c-mercado', notes: 'Lunch', date: '2026-09-03' }, parseCats),
  { type: 'expense', amountCents: 3500, categoryId: 'c-mercado', date: '2026-09-03', note: 'Lunch' },
);
check(
  'parse valid income',
  validateParsedTransaction({ type: 'income', amount: 1200, categoryId: 'c-salario', notes: null, date: '2026-08-31' }, parseCats),
  { type: 'income', amountCents: 120000, categoryId: 'c-salario', date: '2026-08-31' },
);
check(
  'parse string amount accepted',
  validateParsedTransaction({ type: 'expense', amount: '35', categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 3500, categoryId: null, date: null },
);
check(
  'parse rounds to integer centavos',
  validateParsedTransaction({ type: 'expense', amount: 1234.567, categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 123457, categoryId: null, date: null },
);
check(
  'parse keeps fractional pesos',
  validateParsedTransaction({ type: 'expense', amount: 35.5, categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 3550, categoryId: null, date: null },
);
check(
  'parse missing category stays reviewable',
  validateParsedTransaction({ type: 'expense', amount: 50, notes: 'Something for the house', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, note: 'Something for the house' },
);
check(
  'parse unsupported category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-food', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse wrong-kind category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-salario', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse archived category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-old', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse non-string category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 7, date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse bad type rejected',
  validateParsedTransaction({ type: 'transfer', amount: 50, categoryId: 'c-mercado', date: null }, parseCats),
  null,
);
check(
  'parse missing type rejected',
  validateParsedTransaction({ amount: 50, categoryId: 'c-mercado', date: null }, parseCats),
  null,
);
check('parse missing amount rejected', validateParsedTransaction({ type: 'expense', categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse zero amount rejected', validateParsedTransaction({ type: 'expense', amount: 0, categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse negative amount rejected', validateParsedTransaction({ type: 'expense', amount: -5, categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse NaN amount rejected', validateParsedTransaction({ type: 'expense', amount: NaN, categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse non-numeric amount rejected', validateParsedTransaction({ type: 'expense', amount: 'abc', categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse huge amount rejected', validateParsedTransaction({ type: 'expense', amount: 1e15, categoryId: 'c-mercado', date: null }, parseCats), null);
check('parse sub-centavo amount rejected', validateParsedTransaction({ type: 'expense', amount: 0.004, categoryId: 'c-mercado', date: null }, parseCats), null);
check(
  'parse invalid month date nulled',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: '2026-13-01' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse impossible date nulled',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: '2026-02-30' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse valid date kept',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: '2026-09-03' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: '2026-09-03' },
);
check(
  'parse missing date nulled',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse notes trimmed',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, notes: '  Lunch  ' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, note: 'Lunch' },
);
check(
  'parse empty notes dropped',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, notes: '   ' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check(
  'parse extra keys ignored',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, foo: 'bar' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null },
);
check('parse null raw rejected', validateParsedTransaction(null, parseCats), null);
check('parse string raw rejected', validateParsedTransaction('hi', parseCats), null);
check('parse array raw rejected', validateParsedTransaction([1, 2], parseCats), null);
check('parse number raw rejected', validateParsedTransaction(42, parseCats), null);
check('parse malformed JSON-ish object rejected', validateParsedTransaction({ choices: [] }, parseCats), null);

// ---- parse microservice helpers (api/parse.js) ----
const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
check(
  'limiter allows first three',
  [checkRateLimit(rl, '1.1.1.1', 0), checkRateLimit(rl, '1.1.1.1', 100), checkRateLimit(rl, '1.1.1.1', 200)],
  [true, true, true],
);
check('limiter blocks fourth', checkRateLimit(rl, '1.1.1.1', 300), false);
check('limiter resets after window', checkRateLimit(rl, '1.1.1.1', 1001), true);
check('limiter independent keys', checkRateLimit(rl, '2.2.2.2', 1500), true);

const cat = { id: 'c1', name: 'Mercado', kind: 'expense' };
check(
  'sanitize valid request',
  sanitizeRequest({ utterance: '  lunch 35  ', categories: [cat], today: '2026-09-03' }),
  { utterance: 'lunch 35', categories: [cat], today: '2026-09-03' },
);
check('sanitize empty utterance rejected', sanitizeRequest({ utterance: '   ', categories: [cat], today: '2026-09-03' }), null);
check('sanitize missing categories rejected', sanitizeRequest({ utterance: 'x', today: '2026-09-03' }), null);
check('sanitize bad kind rejected', sanitizeRequest({ utterance: 'x', categories: [{ ...cat, kind: 'other' }], today: '2026-09-03' }), null);
check('sanitize empty id rejected', sanitizeRequest({ utterance: 'x', categories: [{ ...cat, id: ' ' }], today: '2026-09-03' }), null);
check('sanitize bad today rejected', sanitizeRequest({ utterance: 'x', categories: [cat], today: 'yesterday' }), null);
check('sanitize long utterance rejected', sanitizeRequest({ utterance: 'a'.repeat(501), categories: [cat], today: '2026-09-03' }), null);
check(
  'sanitize too many categories rejected',
  sanitizeRequest({ utterance: 'x', categories: Array.from({ length: 51 }, (_, i) => ({ ...cat, id: `c${i}` })), today: '2026-09-03' }),
  null,
);
check('sanitize non-object rejected', sanitizeRequest(null), null);

check(
  'gemini response parsed',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '{"type":"expense","amount":35}' }] } }] }),
  { type: 'expense', amount: 35 },
);
check(
  'gemini response fenced json parsed',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '```json\n{"type":"expense","amount":35}\n```' }] } }] }),
  { type: 'expense', amount: 35 },
);
check('gemini response bad json rejected', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), null);
check('gemini response empty candidates rejected', parseGeminiResponse({ candidates: [] }), null);
check('gemini response null rejected', parseGeminiResponse(null), null);
check('gemini response array text part rejected', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '[1,2]' }] } }] }), null);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed ✔');
