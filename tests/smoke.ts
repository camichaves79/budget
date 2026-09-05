import { formatCOP, parseAmountToCents } from '../src/lib/money';
import { isValidISODate } from '../src/lib/dates';
import { periodForDate, shiftPeriod } from '../src/lib/periods';
import { isInPeriod } from '../src/lib/selectors';
import {
  isRetryableParseError, needsReview, validateParsedTransaction, validateParsedTransactions,
  REVIEW_CONFIDENCE_THRESHOLD, dailyLimitMessage,
} from '../src/lib/parseService';
import { validateAppData } from '../src/lib/importExport';
import {
  cacheGet, cacheKeyFor, cacheSet, checkDailyLimit, checkRateLimit, createDailyLimiter,
  createRateLimiter, createResponseCache, isTransientGeminiStatus, nextPTMidnight,
  nextRetryDelayMs, parseGeminiResponse, parseRetryDelaySeconds, sanitizeRequest,
} from '../api/parse.js';
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

// ---- periods (labeled by the month with the majority of days) ----
const oct25 = new Date(2025, 9, 25); // Oct 25, 2025 → ends Nov 24
const oct24 = new Date(2025, 9, 24); // → ends Oct 24
const jan5 = new Date(2026, 0, 5); // Jan 5, 2026 → ends Jan 24
const aug25 = new Date(2026, 7, 25); // Aug 25, 2026 → ends Sep 24
const p1 = periodForDate(oct25);
check('period oct25 key', p1.key, '2025-10-25');
check('period oct25 label', p1.label, 'November 2025');
check('period oct25 start', p1.startISO, '2025-10-25');
check('period oct25 end', p1.endISO, '2025-11-24');
const p2 = periodForDate(oct24);
check('period oct24 key', p2.key, '2025-09-25');
check('period oct24 start', p2.startISO, '2025-09-25');
check('period oct24 end', p2.endISO, '2025-10-24');
const p3 = periodForDate(jan5);
check('period jan5 key', p3.key, '2025-12-25');
check('period jan5 end', p3.endISO, '2026-01-24');
check('user example aug25', periodForDate(aug25).label, 'September 2026');
check('user example aug25 key', periodForDate(aug25).key, '2026-08-25');
check('shift +1 from jan', shiftPeriod(p3, 1).key, '2026-01-25');
check('shift -1 from jan', shiftPeriod(p3, -1).key, '2025-11-25');
check('in period inclusive start', isInPeriod('2025-10-25', p1), true);
check('in period inclusive end', isInPeriod('2025-11-24', p1), true);
check('in period excludes next', isInPeriod('2025-11-25', p1), false);
check('in period excludes prev', isInPeriod('2025-10-24', p1), false);

// ---- periods: custom start day ----
const p1st = periodForDate(new Date(2026, 8, 20), 1); // Sep 20, 2026, day 1
check('day1 bounds', [p1st.startISO, p1st.endISO], ['2026-09-01', '2026-09-30']);
check('day1 label', p1st.label, 'September 2026');
const p15 = periodForDate(new Date(2026, 8, 20), 15);
check('day15 bounds', [p15.startISO, p15.endISO], ['2026-09-15', '2026-10-14']);
check('day15 majority label', p15.label, 'September 2026');
const p16 = periodForDate(new Date(2026, 8, 20), 16);
check('day16 bounds', [p16.startISO, p16.endISO], ['2026-09-16', '2026-10-15']);
check('day16 tie goes to start month', p16.label, 'September 2026');
const p28feb = periodForDate(new Date(2026, 1, 10), 28); // Feb 10, 2026, day 28
check('day28 feb bounds', [p28feb.startISO, p28feb.endISO], ['2026-01-28', '2026-02-27']);
check('day28 feb majority label', p28feb.label, 'February 2026');
check('day above 28 clamps to 28', periodForDate(new Date(2026, 8, 20), 31).startISO, '2026-08-28');
const p1dec = periodForDate(new Date(2025, 11, 5), 1); // Dec 5, 2025, day 1
check('day1 dec label', p1dec.label, 'December 2025');
check('day1 year rollover', shiftPeriod(p1dec, 1).key, '2026-01-01');
check('day1 shift back across year', shiftPeriod(p1dec, -1).key, '2025-11-01');

// ---- backup validation: period start day migration ----
const baseBackup = { transactions: [], categories: [], budgets: [] };
check(
  'import defaults period start day to 25',
  validateAppData(baseBackup),
  { transactions: [], categories: [], budgets: [], periodStartDay: 25 },
);
check(
  'import keeps custom start day',
  validateAppData({ ...baseBackup, periodStartDay: 5 }),
  { transactions: [], categories: [], budgets: [], periodStartDay: 5 },
);
check('import rejects start day 0', validateAppData({ ...baseBackup, periodStartDay: 0 }), null);
check('import rejects start day 40', validateAppData({ ...baseBackup, periodStartDay: 40 }), null);
check('import rejects fractional start day', validateAppData({ ...baseBackup, periodStartDay: 3.5 }), null);

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
  { type: 'expense', amountCents: 3500, categoryId: 'c-mercado', date: '2026-09-03', confidence: 1, note: 'Lunch' },
);
check(
  'parse valid income',
  validateParsedTransaction({ type: 'income', amount: 1200, categoryId: 'c-salario', notes: null, date: '2026-08-31' }, parseCats),
  { type: 'income', amountCents: 120000, categoryId: 'c-salario', date: '2026-08-31', confidence: 1 },
);
check(
  'parse string amount accepted',
  validateParsedTransaction({ type: 'expense', amount: '35', categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 3500, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse rounds to integer centavos',
  validateParsedTransaction({ type: 'expense', amount: 1234.567, categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 123457, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse keeps fractional pesos',
  validateParsedTransaction({ type: 'expense', amount: 35.5, categoryId: null, date: null }, parseCats),
  { type: 'expense', amountCents: 3550, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse missing category stays reviewable',
  validateParsedTransaction({ type: 'expense', amount: 50, notes: 'Something for the house', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1, note: 'Something for the house' },
);
check(
  'parse unsupported category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-food', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse wrong-kind category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-salario', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse archived category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 'c-old', date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse non-string category dropped to null',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: 7, date: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
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
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse impossible date nulled',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: '2026-02-30' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse valid date kept',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: '2026-09-03' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: '2026-09-03', confidence: 1 },
);
check(
  'parse missing date nulled',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse notes trimmed',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, notes: '  Lunch  ' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1, note: 'Lunch' },
);
check(
  'parse empty notes dropped',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, notes: '   ' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse extra keys ignored',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, foo: 'bar' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check('parse null raw rejected', validateParsedTransaction(null, parseCats), null);
check('parse string raw rejected', validateParsedTransaction('hi', parseCats), null);
check('parse array raw rejected', validateParsedTransaction([1, 2], parseCats), null);
check('parse number raw rejected', validateParsedTransaction(42, parseCats), null);
check('parse malformed JSON-ish object rejected', validateParsedTransaction({ choices: [] }, parseCats), null);
check(
  'parse confidence kept',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, confidence: 0.4 }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 0.4 },
);
check(
  'parse null confidence defaults to 1',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, confidence: null }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 1 },
);
check(
  'parse out-of-range confidence zeroed',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, confidence: 1.7 }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 0 },
);
check(
  'parse non-number confidence zeroed',
  validateParsedTransaction({ type: 'expense', amount: 50, categoryId: null, date: null, confidence: 'high' }, parseCats),
  { type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 0 },
);

// ---- multi-transaction validation ----
const multiOk = [
  { type: 'expense', amount: 35, categoryId: 'c-mercado', date: '2026-09-03', confidence: 0.95 },
  { type: 'income', amount: 1200, categoryId: 'c-salario', date: null, confidence: 0.9 },
];
check(
  'multi valid array parsed',
  validateParsedTransactions(multiOk, parseCats),
  [
    { type: 'expense', amountCents: 3500, categoryId: 'c-mercado', date: '2026-09-03', confidence: 0.95 },
    { type: 'income', amountCents: 120000, categoryId: 'c-salario', date: null, confidence: 0.9 },
  ],
);
check(
  'multi single element parsed',
  validateParsedTransactions([multiOk[0]], parseCats),
  [{ type: 'expense', amountCents: 3500, categoryId: 'c-mercado', date: '2026-09-03', confidence: 0.95 }],
);
check('multi empty array rejected', validateParsedTransactions([], parseCats), null);
check('multi non-array rejected', validateParsedTransactions(multiOk[0], parseCats), null);
check('multi null rejected', validateParsedTransactions(null, parseCats), null);
check(
  'multi invalid element rejects all',
  validateParsedTransactions([multiOk[0], { type: 'transfer', amount: 5, categoryId: null, date: null }], parseCats),
  null,
);
check(
  'multi too many elements rejected',
  validateParsedTransactions(Array.from({ length: 21 }, () => multiOk[0]), parseCats),
  null,
);

// ---- certainty gate (review threshold) ----
check(
  'review needed for low confidence',
  needsReview({ type: 'expense', amountCents: 5000, categoryId: 'c-mercado', date: null, confidence: 0.79 }),
  true,
);
check(
  'review not needed at threshold',
  needsReview({ type: 'expense', amountCents: 5000, categoryId: 'c-mercado', date: null, confidence: REVIEW_CONFIDENCE_THRESHOLD }),
  false,
);
check(
  'review not needed above threshold',
  needsReview({ type: 'expense', amountCents: 5000, categoryId: 'c-mercado', date: null, confidence: 0.95 }),
  false,
);
check(
  'review needed for missing category even when confident',
  needsReview({ type: 'expense', amountCents: 5000, categoryId: null, date: null, confidence: 0.99 }),
  true,
);

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
  'gemini response array parsed',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '[{"type":"expense","amount":35}]' }] } }] }),
  [{ type: 'expense', amount: 35 }],
);
check(
  'gemini response fenced array parsed',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '```json\n[{"type":"expense","amount":35}]\n```' }] } }] }),
  [{ type: 'expense', amount: 35 }],
);
check(
  'gemini response multiple elements parsed',
  parseGeminiResponse({
    candidates: [{ content: { parts: [{ text: '[{"type":"expense","amount":35},{"type":"income","amount":1200}]' }] } }],
  }),
  [
    { type: 'expense', amount: 35 },
    { type: 'income', amount: 1200 },
  ],
);
check(
  'gemini response single object rejected',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '{"type":"expense","amount":35}' }] } }] }),
  null,
);
check(
  'gemini response empty array rejected',
  parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }),
  null,
);
check('gemini response bad json rejected', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), null);
check('gemini response empty candidates rejected', parseGeminiResponse({ candidates: [] }), null);
check('gemini response null rejected', parseGeminiResponse(null), null);
check('gemini response number elements rejected', parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '[1,2]' }] } }] }), null);
check(
  'gemini response too many elements rejected',
  parseGeminiResponse({
    candidates: [
      { content: { parts: [{ text: JSON.stringify(Array.from({ length: 21 }, () => ({ type: 'expense', amount: 35 }))) }] } },
    ],
  }),
  null,
);

// ---- retry policy (Gemini free-tier resilience) ----
check(
  'retryDelay parsed from RetryInfo',
  parseRetryDelaySeconds({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '16s' }] } }),
  16,
);
check(
  'retryDelay fractional seconds parsed',
  parseRetryDelaySeconds({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2.5s' }] } }),
  2.5,
);
check('retryDelay absent is null', parseRetryDelaySeconds({ error: { message: 'boom' } }), null);
check(
  'retryDelay non-seconds format is null',
  parseRetryDelaySeconds({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12h' }] } }),
  null,
);
check('retryDelay non-object body is null', parseRetryDelaySeconds(null), null);
check('transient statuses are retryable', [0, 429, 500, 502, 503, 529].every(isTransientGeminiStatus), true);
check('non-transient statuses are not retryable', [400, 401, 403, 404].some(isTransientGeminiStatus), false);
check('retry honors short provider delay', nextRetryDelayMs({ attempt: 0, status: 429, retryDelaySeconds: 3 }), 3000);
check('retry caps provider delay at 3s', nextRetryDelayMs({ attempt: 0, status: 429, retryDelaySeconds: 4 }), 3000);
check('retry skips long provider delay (daily quota)', nextRetryDelayMs({ attempt: 0, status: 429, retryDelaySeconds: 43200 }), 0);
check('retry backoff without provider delay', nextRetryDelayMs({ attempt: 0, status: 503, retryDelaySeconds: null }), 800);
check('retry backoff second attempt', nextRetryDelayMs({ attempt: 1, status: 503, retryDelaySeconds: null }), 1600);
check('retry stops after attempts', nextRetryDelayMs({ attempt: 2, status: 429, retryDelaySeconds: 1 }), 0);
check('no retry on non-transient status', nextRetryDelayMs({ attempt: 0, status: 400, retryDelaySeconds: null }), 0);

// ---- response cache (warm-instance parse cache) ----
const cacheCat = { id: 'c1', name: 'Mercado', kind: 'expense' as const };
const cacheInput = { utterance: 'lunch 35', categories: [cacheCat], today: '2026-09-03' };
const parsedCache = [{ type: 'expense', amount: 35 }];
const cacheA = createResponseCache({ ttlMs: 1000, maxEntries: 2 });
const keyA = cacheKeyFor(cacheInput);
check('cache miss when empty', cacheGet(cacheA, keyA, 0), null);
cacheSet(cacheA, keyA, parsedCache, 0);
check('cache hit after set', cacheGet(cacheA, keyA, 500), parsedCache);
check('cache expired after ttl', cacheGet(cacheA, keyA, 1001), null);
cacheSet(cacheA, keyA, parsedCache, 0);
check(
  'cache key changes with utterance',
  cacheKeyFor({ ...cacheInput, utterance: 'lunch 40' }) === keyA,
  false,
);
check(
  'cache key changes with categories',
  cacheKeyFor({ ...cacheInput, categories: [{ ...cacheCat, name: 'Comida' }] }) === keyA,
  false,
);
check(
  'cache key changes with today',
  cacheKeyFor({ ...cacheInput, today: '2026-09-04' }) === keyA,
  false,
);
const cacheB = createResponseCache({ ttlMs: 1000, maxEntries: 2 });
cacheSet(cacheB, 'k1', parsedCache, 10);
cacheSet(cacheB, 'k2', parsedCache, 20);
cacheSet(cacheB, 'k3', parsedCache, 30);
check('cache evicts oldest at cap', cacheGet(cacheB, 'k1', 40), null);
check('cache keeps newest at cap', cacheGet(cacheB, 'k3', 40), parsedCache);

// ---- client retry classification ----
check('rate-limit error is retryable', isRetryableParseError({ kind: 'rate-limit', message: 'x' }), true);
check('provider error is retryable', isRetryableParseError({ kind: 'provider', message: 'x' }), true);
check('network error is not auto-retried', isRetryableParseError({ kind: 'network', message: 'x' }), false);
check('invalid-response is not auto-retried', isRetryableParseError({ kind: 'invalid-response', message: 'x' }), false);
check('daily-limit error is not auto-retried', isRetryableParseError({ kind: 'daily-limit', message: 'x' }), false);

// ---- fair-use daily cap (Option 3, 50-user plan) ----
const july10 = Date.UTC(2026, 6, 10, 20, 0, 0); // PDT (UTC-7)
check('next PT midnight in summer (PDT)', nextPTMidnight(july10), Date.UTC(2026, 6, 11, 7, 0, 0));
const jan10 = Date.UTC(2026, 0, 10, 20, 0, 0); // PST (UTC-8)
check('next PT midnight in winter (PST)', nextPTMidnight(jan10), Date.UTC(2026, 0, 11, 8, 0, 0));
check('next PT midnight is in the future', nextPTMidnight(Date.now()) > Date.now(), true);
const dl = createDailyLimiter({ limit: 3 });
const t0 = Date.UTC(2026, 6, 10, 20, 0, 0);
const t1 = Date.UTC(2026, 6, 10, 20, 30, 0);
check(
  'daily limiter allows first three',
  [checkDailyLimit(dl, 'ip1', t0).allowed, checkDailyLimit(dl, 'ip1', t1).allowed, checkDailyLimit(dl, 'ip1', t1 + 1).allowed],
  [true, true, true],
);
check('daily limiter blocks fourth', checkDailyLimit(dl, 'ip1', t1 + 2).allowed, false);
check('daily limiter retryAt is next PT midnight', checkDailyLimit(dl, 'ip1', t1 + 3).retryAt, Date.UTC(2026, 6, 11, 7, 0, 0));
check('daily limiter resets after midnight', checkDailyLimit(dl, 'ip1', Date.UTC(2026, 6, 11, 7, 0, 1)).allowed, true);
check('daily limiter independent keys', checkDailyLimit(dl, 'ip2', t1).allowed, true);
check('daily limit message names reset time', dailyLimitMessage(Date.UTC(2026, 6, 11, 7, 0, 0)).includes('resets at'), true);
check('daily limit message fallback copy', dailyLimitMessage(null).includes('tomorrow'), true);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed ✔');
