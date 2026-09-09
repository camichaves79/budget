import { formatCOP, formatMoney, parseAmountToCents } from '../src/lib/money';
import { LANGS, availableLanguages, catalogKeys, catalogs, setLanguage, t, to } from '../src/lib/i18n';
import {
  INSTALL_TIP_DELAY_MS, INSTALL_TIP_STORAGE_KEY, decideInstallSignal, isStandalone, uaLooksIos,
} from '../src/lib/installPrompt';
import { AUTO_SEND_PAUSE_MS, MIN_SEND_LENGTH } from '../src/components/SmartEntry';
import { firstGrapheme } from '../src/lib/emoji';
import { isValidISODate } from '../src/lib/dates';
import { periodForDate, shiftPeriod } from '../src/lib/periods';
import { isInPeriod } from '../src/lib/selectors';
import {
  isRetryableParseError, needsReview, validateParsedTransaction, validateParsedTransactions,
  REVIEW_CONFIDENCE_THRESHOLD,
} from '../src/lib/parseService';
import { validateAppData } from '../src/lib/importExport';
import {
  cacheGet, cacheKeyFor, cacheSet, checkRateLimit, createRateLimiter, createResponseCache,
  isGeminiConfigError, isTransientGeminiStatus, nextRetryDelayMs, parseGeminiResponse,
  parseLicensedWithFallback, parseRetryDelaySeconds, sanitizeRequest,
} from '../api/parse.js';
import {
  DEFAULT_LICENSE_DAILY_CAP, LICENSE_TERM_SECONDS, createLicenseMeter, emailsMatch, estimateLsFeeCents,
  estimateNetCents, ledgerToCsv, makeLicensePayload, orderToLedger, signLicense,
  verifyLicenseToken, verifyWebhookSignature, webhookToLedger,
} from '../api/_license.js';
import { checkIpRateLimit, createIpRateLimiter, isAllowedOrigin } from '../api/_http.js';
import { ensureLicenseForOrder, saleRowForMerge } from '../api/_licenseops.js';
import redeemHandler from '../api/license/redeem.js';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { FREE_DAILY_PARSES, nextQuota, remainingFreeToday } from '../src/lib/quota';
import { initialData } from '../src/state/store';
import { licenseIsActive, parseLicenseToken } from '../src/lib/license';
import { decodeJwtParts, fromFields, setDocMerge, signJwt, toFields, verifyJwtSignature } from '../api/_firebase.js';
import worker, { createNodeRes, hydrateEnv, toNodeReq } from '../worker.js';
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
  { utterance: 'lunch 35', categories: [cat], today: '2026-09-03', language: 'en' },
);
check(
  'sanitize language whitelisted',
  sanitizeRequest({ utterance: 'x', categories: [cat], today: '2026-09-03', language: 'es' })?.language,
  'es',
);
check(
  'sanitize unknown language falls back to en',
  sanitizeRequest({ utterance: 'x', categories: [cat], today: '2026-09-03', language: 'xx' })?.language,
  'en',
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
check('license error is not auto-retried', isRetryableParseError({ kind: 'license', message: 'x' }), false);

// ---- paywall: free daily allowance ----
check('quota fresh day is full', remainingFreeToday('2026-09-04', 3, '2026-09-05'), FREE_DAILY_PARSES);
check('quota same day counts down', remainingFreeToday('2026-09-05', 3, '2026-09-05'), 7);
check('quota floors at zero', remainingFreeToday('2026-09-05', 12, '2026-09-05'), 0);
check('quota next increments', nextQuota('2026-09-05', 3, '2026-09-05'), { date: '2026-09-05', used: 4 });
check('quota next rolls day', nextQuota('2026-09-04', 9, '2026-09-05'), { date: '2026-09-05', used: 1 });

// ---- paywall: license tokens (client parse + server sign/verify) ----
const licenseBase = makeLicensePayload({ lic: 'lic-123', uid: null, iatSeconds: 1780000000, expSeconds: 2000000000 });
const signedToken = signLicense(licenseBase, 'test-secret');
check('license token parses client-side', parseLicenseToken(signedToken)?.lic, 'lic-123');
check('license client parse rejects garbage', parseLicenseToken('not-a-token'), null);
check('license client parse rejects wrong kid', parseLicenseToken(signLicense({ ...licenseBase, kid: 'other' }, 'test-secret')), null);
check('license client active inside window', licenseIsActive(parseLicenseToken(signedToken), Date.now()), true);
check('license client inactive past exp', licenseIsActive({ ...licenseBase, exp: 1 }, Date.now()), false);
check('license server verify ok', verifyLicenseToken(signedToken, 'test-secret').ok, true);
check('license server verify wrong secret', verifyLicenseToken(signedToken, 'other-secret').ok, false);
check('license server verify tampered payload', verifyLicenseToken(`x${signedToken}`, 'test-secret').ok, false);
check(
  'license server verify tampered signature',
  verifyLicenseToken(`${signedToken.slice(0, -2)}AA`, 'test-secret').ok,
  false,
);
check(
  'license server verify expired',
  verifyLicenseToken(signLicense({ ...licenseBase, exp: 1 }, 'test-secret'), 'test-secret').ok,
  false,
);
check('license server verify malformed', verifyLicenseToken('a.b.c', 'test-secret').ok, false);
check('license term is one year', LICENSE_TERM_SECONDS, 365 * 24 * 60 * 60);

// ---- paywall: per-license daily meter ----
const meter = createLicenseMeter({ limitPerDay: 2 });
check('license meter allows 1st', meter.allow('lic-a', new Date('2026-09-05T10:00:00Z')), true);
check('license meter allows 2nd', meter.allow('lic-a', new Date('2026-09-05T11:00:00Z')), true);
check('license meter blocks 3rd', meter.allow('lic-a', new Date('2026-09-05T12:00:00Z')), false);
check('license meter resets next UTC day', meter.allow('lic-a', new Date('2026-09-06T00:00:00Z')), true);
check('license meter is per license', meter.allow('lic-b', new Date('2026-09-05T13:00:00Z')), true);
check('license default daily cap', DEFAULT_LICENSE_DAILY_CAP, 100);

// ---- paywall: Lemon Squeezy fee math (estimates) ----
check('ls fee estimate on $5', estimateLsFeeCents(500), 75);
check('ls net estimate on $5', estimateNetCents(500), 425);
check('ls fee estimate on $36', estimateLsFeeCents(3600), 230);
check('ls fee estimate guards bad input', estimateLsFeeCents(NaN), 0);

// ---- paywall: order → sales-ledger mapping ----
const orderAttrs = {
  identifier: 'uuid-1',
  order_number: 42,
  created_at: '2026-09-05T10:00:00Z',
  status: 'paid',
  subtotal: 500,
  tax: 0,
  total: 500,
  currency: 'USD',
  user_email: 'buyer@example.com',
  urls: { receipt: 'https://receipt' },
  test_mode: false,
  refunded: false,
};
const ledgerRow = orderToLedger(orderAttrs);
check('ledger maps order id', ledgerRow.order_id, 'uuid-1');
check('ledger maps gross', ledgerRow.gross, 500);
check('ledger maps fee estimate', ledgerRow.fees, 75);
check('ledger maps net estimate', ledgerRow.net, 425);
check('ledger maps buyer email', ledgerRow.buyer_email, 'buyer@example.com');
check('ledger maps receipt url', ledgerRow.receipt_url, 'https://receipt');
check('webhook maps order_created', webhookToLedger('order_created', orderAttrs) !== null, true);
check('webhook maps order_refunded', webhookToLedger('order_refunded', orderAttrs) !== null, true);
check('webhook ignores subscription events', webhookToLedger('subscription_created', orderAttrs), null);

// ---- paywall: LS webhook signature ----
const whBody = '{"meta":{"event_name":"order_created"}}';
const whSecret = 'wh-secret-123';
const goodSig = createHmac('sha256', whSecret).update(whBody).digest('hex');
check('webhook signature accepts valid', verifyWebhookSignature(whBody, goodSig, whSecret), true);
check('webhook signature rejects tampered body', verifyWebhookSignature(`${whBody} `, goodSig, whSecret), false);
check(
  'webhook signature rejects wrong secret',
  verifyWebhookSignature(whBody, createHmac('sha256', 'other').update(whBody).digest('hex'), whSecret),
  false,
);
check('webhook signature rejects missing header', verifyWebhookSignature(whBody, '', whSecret), false);

// ---- paywall: ledger CSV export ----
const csv = ledgerToCsv([
  ledgerRow,
  { ...ledgerRow, buyer_email: 'a,"b",c', refunded: true, refunded_amount: 500, license_id: 'lic-1' },
]);
check('csv starts with BOM + header', csv.startsWith('\uFEFFdate,order_number'), true);
check('csv escapes quotes', csv.includes('"a,""b"",c"'), true);
check('csv has header + two rows', csv.split('\r\n').length, 3);

// ---- firebase REST helpers (service-account JWT + field codecs) ----
const fieldsRound = { s: 'hola', n: 42, b: true, z: null };
const asFields = toFields(fieldsRound);
check('toFields string', asFields.s, { stringValue: 'hola' });
check('toFields integer', asFields.n, { integerValue: '42' });
check('toFields boolean', asFields.b, { booleanValue: true });
check('toFields null', asFields.z, { nullValue: null });
check('fromFields round trip', fromFields(asFields), fieldsRound);
check('fromFields guards garbage', fromFields(null), {});

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pubPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const jwt = await signJwt({ iss: 'x@y', aud: 'https://oauth2.googleapis.com/token', iat: 1, exp: 2 }, privPem);
const jwtParts = jwt.split('.');
const jwtDecoded = decodeJwtParts(jwt);
check('jwt has three parts', jwtParts.length, 3);
check('jwt header alg', jwtDecoded?.header.alg, 'RS256');
check('jwt payload iss', jwtDecoded?.payload.iss, 'x@y');
check('jwt signature verifies', verifyJwtSignature(`${jwtParts[0]}.${jwtParts[1]}`, jwtParts[2], pubPem), true);
check('jwt signature rejects tamper', verifyJwtSignature(`${jwtParts[0]}.${jwtParts[1]}x`, jwtParts[2], pubPem), false);
check('jwt decode rejects garbage', decodeJwtParts('a.b'), null);

// ---- paid-key fallback (licensed parses: broken paid key → free key) ----
check('config statuses trigger the free-key fallback', [400, 401, 403, 404].every(isGeminiConfigError), true);
check('non-config statuses do not trigger the fallback', [0, 429, 500, 502, 503, 529].some(isGeminiConfigError), false);

await (async () => {
  const fallbackInput = { utterance: 'lunch 35', categories: [cacheCat], today: '2026-09-03' };
  const fallbackOrder = { primary: 'lite', fallback: null };
  const okBody = { candidates: [{ content: { parts: [{ text: '[{"type":"expense","amount":35}]' }] } }] };
  const quotaBody = {
    error: { code: 429, message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '43200s' }] },
  };

  function stubGemini(failuresByKey: Record<string, number>) {
    const keys: string[] = [];
    const fn = async (url: string, opts: { headers?: Record<string, string> } = {}) => {
      const key = typeof opts.headers?.['x-goog-api-key'] === 'string' ? opts.headers['x-goog-api-key'] : '';
      keys.push(key);
      const failStatus = failuresByKey[key];
      if (failStatus !== undefined) {
        const body = failStatus === 429 ? quotaBody : { error: { code: failStatus, message: 'stub' } };
        return new Response(JSON.stringify(body), { status: failStatus, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(okBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { fn, keys };
  }

  const originalFetch = globalThis.fetch;

  {
    const { fn, keys } = stubGemini({});
    globalThis.fetch = fn as typeof fetch;
    const r = await parseLicensedWithFallback(fallbackInput, 'paid-1', 'free-1', fallbackOrder);
    check('paid key ok uses only the paid key', [r.ok, keys], [true, ['paid-1']]);
  }
  {
    const { fn, keys } = stubGemini({ 'paid-1': 403 });
    globalThis.fetch = fn as typeof fetch;
    const r = await parseLicensedWithFallback(fallbackInput, 'paid-1', 'free-1', fallbackOrder);
    check('paid key 403 falls back to the free key', [r.ok, keys], [true, ['paid-1', 'free-1']]);
  }
  {
    const { fn, keys } = stubGemini({ 'paid-1': 429 });
    globalThis.fetch = fn as typeof fetch;
    const r = await parseLicensedWithFallback(fallbackInput, 'paid-1', 'free-1', fallbackOrder);
    check(
      'paid key quota does NOT spill to the free key (training opt-out)',
      [r.ok, keys.includes('free-1') ? 'spilled' : 'kept', r.ok === false ? r.failure.status : 0],
      [false, 'kept', 429],
    );
  }
  {
    const { fn, keys } = stubGemini({ same: 400 });
    globalThis.fetch = fn as typeof fetch;
    const r = await parseLicensedWithFallback(fallbackInput, 'same', 'same', fallbackOrder);
    check('identical paid/free key skips the duplicate retry', [r.ok, keys], [false, ['same']]);
  }
  {
    const { fn, keys } = stubGemini({ 'paid-1': 400, 'free-1': 400 });
    globalThis.fetch = fn as typeof fetch;
    const r = await parseLicensedWithFallback(fallbackInput, 'paid-1', 'free-1', fallbackOrder);
    check(
      'both keys rejected reports the free-key failure',
      [r.ok, keys, r.ok === false ? r.failure.status : 0],
      [false, ['paid-1', 'free-1'], 400],
    );
  }

  globalThis.fetch = originalFetch;
})();

// ---- firebase commit REST shape (regression: updateMask must be a SIBLING
//      of update, not nested inside it — the prod 2026-09 write bug) ----
await (async () => {
  const saJson = JSON.stringify({ client_email: 'svc@test-project.iam.gserviceaccount.com', project_id: 'test-project', private_key: privPem });
  const prevSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.FIREBASE_SERVICE_ACCOUNT = saJson;

  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, opts: { body?: string } = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('documents:commit')) {
      bodies.push(JSON.parse(opts.body ?? '{}'));
      return new Response(JSON.stringify({ writeResults: [{}] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  await setDocMerge('sales/order-x', { order_id: 'order-x', gross: 500 });

  globalThis.fetch = originalFetch;
  if (prevSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = prevSa;

  const write = bodies[0]?.writes;
  const w0 = Array.isArray(write) ? (write[0] as Record<string, unknown>) : {};
  const update = (w0.update ?? {}) as Record<string, unknown>;
  const updateMask = (w0.updateMask ?? {}) as Record<string, unknown>;
  check('commit write uses document name', update.name, 'projects/test-project/databases/(default)/documents/sales/order-x');
  check('commit update carries string field', (update.fields as Record<string, unknown> | undefined)?.order_id, { stringValue: 'order-x' });
  check('commit update carries integer field', (update.fields as Record<string, unknown> | undefined)?.gross, { integerValue: '500' });
  check('updateMask is a sibling of update', updateMask.fieldPaths, ['order_id', 'gross']);
  check('updateMask is NOT nested inside update', 'updateMask' in update, false);
  check('exactly one write per merge-set', bodies.length, 1);
})();

// ---- ledger row by construction: ensureLicenseForOrder leaves a COMPLETE
//      sales row on every path (mint + self-heal backfill), refund-guarded ----
check('saleRowForMerge keeps a recorded refund', (() => {
  const row = saleRowForMerge(ledgerRow, { refunded: true, refunded_amount: 500, refunded_at: '2026-09-07T00:00:00Z', status: 'refunded' });
  return [row.refunded, row.refunded_amount, row.refunded_at, row.status];
})(), [true, 500, '2026-09-07T00:00:00Z', 'refunded']);
check('saleRowForMerge passes a clean row through unchanged', saleRowForMerge(ledgerRow, {}), ledgerRow);
check('saleRowForMerge without a recorded refund uses the fresh fields', saleRowForMerge(ledgerRow, { refunded: false }).refunded, false);
check('saleRowForMerge refund guard falls back to fresh amount/at when absent', (() => {
  const row = saleRowForMerge(ledgerRow, { refunded: true, status: 'refunded' });
  return [row.refunded, row.refunded_amount, row.refunded_at];
})(), [true, 0, null]);
check('saleRowForMerge preserves the generated invoice url', saleRowForMerge(ledgerRow, { invoice_url: 'https://invoice.test' }).invoice_url, 'https://invoice.test');
check('saleRowForMerge preserves an existing receipt url', saleRowForMerge(ledgerRow, { receipt_url: 'https://receipt.test' }).receipt_url, 'https://receipt.test');

await (async () => {
  const saJson = JSON.stringify({ client_email: 'svc@test-project.iam.gserviceaccount.com', project_id: 'test-project', private_key: privPem });
  const prevSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.FIREBASE_SERVICE_ACCOUNT = saJson;
  const prevLicenseSecret = process.env.BUDGET_LICENSE_SECRET;
  process.env.BUDGET_LICENSE_SECRET = 'testlicense';

  const sv = (v: string) => ({ stringValue: v });
  const nv = (v: number) => ({ integerValue: String(v) });
  const bv = (v: boolean) => ({ booleanValue: v });
  const iat = Math.floor(Date.now() / 1000) - 100;
  const exp = iat + LICENSE_TERM_SECONDS;
  const store: Record<string, { fields: Record<string, unknown> }> = {
    'sales/order-partial': {
      fields: { license_id: sv('lic-existing'), redeemed_at: sv('2026-09-06T00:00:00.000Z'), invoice_url: sv('https://invoice.test') },
    },
    'licenses/lic-existing': {
      fields: { lic: sv('lic-existing'), uid: sv('uid-1'), plan: sv('yearly'), iat: nv(iat), exp: nv(exp), status: sv('active') },
    },
    'sales/order-refunded': {
      fields: {
        license_id: sv('lic-refunded'),
        status: sv('refunded'),
        refunded: bv(true),
        refunded_amount: nv(500),
        refunded_at: sv('2026-09-07T00:00:00.000Z'),
      },
    },
    'licenses/lic-refunded': {
      fields: { lic: sv('lic-refunded'), uid: { nullValue: null }, plan: sv('yearly'), iat: nv(iat), exp: nv(exp), status: sv('refunded') },
    },
  };
  const commits: Array<{ name: string; fields: Record<string, unknown>; fieldPaths: string[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, opts: { method?: string; body?: string } = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('documents:commit')) {
      const body = JSON.parse(opts.body ?? '{}') as { writes?: Array<Record<string, unknown>> };
      const write = (body.writes ?? [])[0] ?? {};
      const update = (write.update ?? {}) as { name?: string; fields?: Record<string, unknown> };
      const mask = (write.updateMask ?? {}) as { fieldPaths?: string[] };
      commits.push({ name: String(update.name ?? ''), fields: update.fields ?? {}, fieldPaths: mask.fieldPaths ?? [] });
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const get = /\/documents\/(sales|licenses)\/([^/?]+)$/.exec(u);
    if (get) {
      const found = store[`${get[1]}/${get[2]}`];
      if (!found) {
        return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const attrs = (identifier: string): Record<string, unknown> => ({
    identifier,
    order_number: 42,
    created_at: '2026-09-05T10:00:00Z',
    status: 'paid',
    subtotal: 500,
    tax: 0,
    total: 500,
    currency: 'USD',
    user_email: 'buyer@example.com',
    urls: { receipt: 'https://receipt.test' },
    test_mode: true,
    refunded: false,
    refunded_amount: 0,
    refunded_at: null,
  });

  // Mint path: a fresh order lands a COMPLETE sales row + license + entitlement.
  {
    commits.length = 0;
    const r = await ensureLicenseForOrder(attrs('order-fresh'), 'uid-1');
    if (!r.ok) throw new Error('mint failed');
    const sales = commits.find((c) => c.name.endsWith('/sales/order-fresh'));
    check('mint writes three docs (sales + license + entitlement)', commits.length, 3);
    check('mint returns a fresh license bound to the uid', [r.payload.lic.length > 10, r.payload.uid], [true, 'uid-1']);
    check('mint sales row carries gross', sales?.fields.gross, nv(500));
    check('mint sales row carries the buyer email', sales?.fields.buyer_email, sv('buyer@example.com'));
    check('mint sales mask covers the money columns', sales?.fieldPaths.includes('gross') && sales?.fieldPaths.includes('buyer_email'), true);
    check('mint sales mask covers the license binding', sales?.fieldPaths.includes('license_id') && sales?.fieldPaths.includes('redeemed_at'), true);
    check('mint writes the entitlement', commits.some((c) => c.name.endsWith('/entitlements/uid-1')), true);
    check('mint writes the license doc', commits.some((c) => c.name.includes('/licenses/')), true);
  }

  // Self-heal backfill: an existing 2-column row gets its money columns back
  // and the SAME license is re-signed (no new mint).
  {
    commits.length = 0;
    const r = await ensureLicenseForOrder(attrs('order-partial'), 'uid-1');
    if (!r.ok) throw new Error('backfill failed');
    const sales = commits.find((c) => c.name.endsWith('/sales/order-partial'));
    check('backfill re-signs the existing license (idempotent)', r.payload.lic, 'lic-existing');
    check('backfill writes only the sales doc', commits.length, 1);
    check('backfill restores the money columns', [sales?.fields.gross, sales?.fields.currency], [nv(500), sv('USD')]);
    check('backfill does not touch the license binding', 'license_id' in (sales?.fields ?? {}), false);
    check('backfill mask covers gross', sales?.fieldPaths.includes('gross'), true);
    check('backfill keeps the generated invoice url', sales?.fields.invoice_url, sv('https://invoice.test'));
  }

  // Refund guard: a recorded refund survives a merge carrying staler attributes.
  {
    commits.length = 0;
    const r = await ensureLicenseForOrder(attrs('order-refunded'), 'uid-1');
    if (!r.ok) throw new Error('refund guard failed');
    const sales = commits.find((c) => c.name.endsWith('/sales/order-refunded'));
    check('refund guard re-signs the refunded license', r.payload.lic, 'lic-refunded');
    check(
      'refund guard keeps the recorded refund',
      [sales?.fields.refunded, sales?.fields.refunded_amount, sales?.fields.refunded_at, sales?.fields.status],
      [bv(true), nv(500), sv('2026-09-07T00:00:00.000Z'), sv('refunded')],
    );
  }

  globalThis.fetch = originalFetch;
  if (prevSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = prevSa;
  if (prevLicenseSecret === undefined) delete process.env.BUDGET_LICENSE_SECRET;
  else process.env.BUDGET_LICENSE_SECRET = prevLicenseSecret;
})();

// ---- redemption ownership (2026-09): email match + license-endpoint limiter ----
check('emailsMatch same email different case', emailsMatch('Buyer@Example.COM', '  buyer@example.com '), true);
check('emailsMatch trims the account email', emailsMatch(' buyer@example.com ', 'buyer@example.com'), true);
check('emailsMatch rejects a different email', emailsMatch('attacker@example.com', 'buyer@example.com'), false);
check('emailsMatch rejects empty buyer email', emailsMatch('buyer@example.com', ''), false);
check('emailsMatch rejects empty account email', emailsMatch(null, 'buyer@example.com'), false);

const ipLimiter = createIpRateLimiter({ limit: 3, windowMs: 1000 });
const fakeIpReq = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
check('ip limiter allows first three', [checkIpRateLimit(ipLimiter, fakeIpReq('9.9.9.9'), 0), checkIpRateLimit(ipLimiter, fakeIpReq('9.9.9.9'), 100), checkIpRateLimit(ipLimiter, fakeIpReq('9.9.9.9'), 200)], [true, true, true]);
check('ip limiter blocks fourth', checkIpRateLimit(ipLimiter, fakeIpReq('9.9.9.9'), 300), false);
check('ip limiter resets after window', checkIpRateLimit(ipLimiter, fakeIpReq('9.9.9.9'), 1001), true);
check('ip limiter independent ips', checkIpRateLimit(ipLimiter, fakeIpReq('8.8.8.8'), 1500), true);

// ---- origin allow-list (hosting migration A15: Cloudflare Pages) ----
check('origin allow-list keeps the github pages origin', isAllowedOrigin('https://camichaves79.github.io'), true);
check('origin allow-list accepts a pages.dev production origin', isAllowedOrigin('https://budget.pages.dev'), true);
check('origin allow-list accepts pages.dev preview hashes', isAllowedOrigin('https://a1b2c3d4.budget.pages.dev'), true);
check('origin allow-list accepts localhost dev', isAllowedOrigin('http://localhost:5173'), true);
check('origin allow-list rejects a lookalike suffix', isAllowedOrigin('https://budget.pages.dev.evil.com'), false);
check('origin allow-list accepts the production domain', isAllowedOrigin('https://5budget.app'), true);
check('origin allow-list rejects a lookalike of the domain', isAllowedOrigin('https://5budget.app.evil.com'), false);
check('origin allow-list rejects unknown origins', isAllowedOrigin('https://example.com'), false);

// ---- Cloudflare Worker entry (A15 Phase 2): Node-style handlers behind a
//      Web Request adapter — the handlers themselves stay unmodified ----
{
  // Deployed Workers expose env bindings as NON-enumerable getters — the
  // prod env shape that broke Object.assign(process.env, env). The explicit-
  // key hydration must read them anyway.
  const prodShapedEnv: Record<string, string> = {};
  Object.defineProperty(prodShapedEnv, 'BUDGET_PARSE_SECRET', { get: () => 'via-getter', enumerable: false });
  Object.defineProperty(prodShapedEnv, 'LICENSE_DAILY_CAP', { get: () => '42', enumerable: false });
  hydrateEnv(prodShapedEnv);
  check(
    'worker hydration reads non-enumerable bindings (prod env shape)',
    [process.env.BUDGET_PARSE_SECRET, process.env.LICENSE_DAILY_CAP],
    ['via-getter', '42'],
  );
  delete process.env.BUDGET_PARSE_SECRET;
  delete process.env.LICENSE_DAILY_CAP;
}

await (async () => {
  const testEnv: Record<string, string> = {
    BUDGET_PARSE_SECRET: 'testparse',
    BUDGET_ADMIN_SECRET: 'testadmin',
    BUDGET_LICENSE_SECRET: 'testlicense',
  };
  const envBackup: Record<string, string | undefined> = {};
  for (const k of Object.keys(testEnv)) envBackup[k] = process.env[k];

  {
    const req = toNodeReq(
      new Request('https://budget-api.test.workers.dev/api/parse', {
        method: 'POST',
        headers: { Origin: 'https://budget-7ad.pages.dev', 'x-budget-secret': 'testparse', 'X-Forwarded-For': '10.0.0.1', 'cf-connecting-ip': '9.9.9.9' },
        body: '{}',
      }),
    );
    check('worker req lowercases header names', typeof req.headers['origin'] === 'string', true);
    check('worker req keeps the secret header', req.headers['x-budget-secret'], 'testparse');
    check('worker req prefers an explicit x-forwarded-for', req.headers['x-forwarded-for'], '10.0.0.1');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    check('worker req streams the body', Buffer.concat(chunks).toString('utf8'), '{}');
  }
  {
    const req = toNodeReq(new Request('https://budget-api.test.workers.dev/api/ledger/export?format=csv'));
    check('worker req keeps the query string', req.url, '/api/ledger/export?format=csv');
    check('worker req maps cf-connecting-ip when no forwarded header', req.headers['x-forwarded-for'], undefined);
  }
  {
    const res = createNodeRes();
    res.setHeader('Content-Type', 'text/csv');
    res.statusCode = 200;
    res.end('a,b');
    const response = res.toResponse();
    check('worker res captures status and body', [response.status, await response.text()], [200, 'a,b']);
    check('worker res captures headers', response.headers.get('content-type'), 'text/csv');
  }
  {
    const res = createNodeRes();
    res.statusCode = 204;
    res.end();
    check('worker 204 carries no body', await res.toResponse().text(), '');
  }
  {
    const res = await worker.fetch(
      new Request('https://budget-api.test.workers.dev/api/license/check', {
        method: 'POST',
        headers: { Origin: 'https://budget-7ad.pages.dev', 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'not-a-license' }),
      }),
      testEnv,
    );
    check('worker routes check and guards the shared secret', [res.status, await res.json()], [401, { ok: false, code: 'unauthorized' }]);
  }
  {
    const res = await worker.fetch(
      new Request('https://budget-api.test.workers.dev/api/license/check', {
        method: 'POST',
        headers: { Origin: 'https://budget-7ad.pages.dev', 'Content-Type': 'application/json', 'x-budget-secret': 'testparse' },
        body: JSON.stringify({ key: 'not-a-license' }),
      }),
      testEnv,
    );
    check('worker check passes the secret then demands sign-in', [res.status, await res.json()], [401, { ok: false, code: 'sign-in-required' }]);
  }
  {
    const res = await worker.fetch(
      new Request('https://budget-api.test.workers.dev/api/parse', {
        method: 'POST',
        headers: { Origin: 'https://budget-7ad.pages.dev', 'Content-Type': 'application/json', 'x-budget-secret': 'testparse' },
        body: '{}',
      }),
      testEnv,
    );
    check('worker parse passes origin+secret then rejects the empty input', [res.status, await res.json()], [400, { ok: false, code: 'bad-request' }]);
  }
  {
    const res = await worker.fetch(new Request('https://budget-api.test.workers.dev/api/ledger/export?format=csv'), testEnv);
    check('worker guards the ledger export', [res.status, await res.json()], [401, { ok: false, code: 'unauthorized' }]);
  }
  {
    const res = await worker.fetch(new Request('https://budget-api.test.workers.dev/nope'), testEnv);
    check('worker answers 404 for unknown paths', res.status, 404);
  }

  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
})();

await (async () => {
  // Self-signed idToken + JWKS stub (same technique as the fallback tests).
  const jwkPub = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'local-kid' };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const makeIdToken = (email: string) => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: 'local-kid', typ: 'JWT' };
    const payload = {
      aud: 'test-project',
      iss: 'https://securetoken.google.com/test-project',
      iat: now,
      exp: now + 3600,
      sub: 'uid-1',
      email,
    };
    const input = `${b64(header)}.${b64(payload)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return `${input}.${signer.sign(privPem).toString('base64url')}`;
  };

  const orderAttrs = {
    identifier: 'order-424242',
    order_number: 424242,
    status: 'paid',
    subtotal: 500,
    tax: 0,
    total: 500,
    currency: 'USD',
    user_email: 'buyer@example.com',
    created_at: '2026-09-06T00:00:00Z',
    urls: { receipt: 'https://receipt.test' },
    test_mode: true,
    refunded: false,
    refunded_amount: 0,
    refunded_at: null,
  };

  const prevSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'svc@test-project.iam.gserviceaccount.com',
    project_id: 'test-project',
    private_key: privPem,
  });
  const prevLsKey = process.env.LEMONSQUEEZY_API_KEY;
  process.env.LEMONSQUEEZY_API_KEY = 'test-ls';
  const prevSecret = process.env.BUDGET_PARSE_SECRET;
  process.env.BUDGET_PARSE_SECRET = 'testparse';
  const prevLicenseSecret = process.env.BUDGET_LICENSE_SECRET;
  process.env.BUDGET_LICENSE_SECRET = 'testlicense';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('service_accounts/v1/jwk')) {
      return new Response(JSON.stringify({ keys: [jwkPub] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.includes('api.lemonsqueezy.com/v1/orders/424242/generate-invoice')) {
      return new Response(JSON.stringify({ meta: { urls: { download_invoice: 'https://invoice.test' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (/api\.lemonsqueezy\.com\/v1\/orders\/424242$/.test(u)) {
      return new Response(JSON.stringify({ data: { attributes: orderAttrs } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('firestore.googleapis.com') && u.includes(':commit')) {
      return new Response(JSON.stringify({ writeResults: [{}] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.includes('firestore.googleapis.com')) {
      return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const runRedeem = async (email: string) => {
    const body = JSON.stringify({ orderId: '424242', key: null, idToken: makeIdToken(email) });
    const req = {
      method: 'POST',
      headers: { origin: 'https://camichaves79.github.io', 'x-budget-secret': 'testparse' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body);
      },
    } as unknown as import('node:http').IncomingMessage;
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(k: string, v: string) {
        res.headers[k] = v;
      },
      end(text: string) {
        res.body = text ?? '';
      },
    } as unknown as import('node:http').ServerResponse;
    await redeemHandler(req, res);
    return { statusCode: res.statusCode, body: res.body };
  };

  {
    const r = await runRedeem('attacker@example.com');
    check('redeem rejects a non-buyer account email', [r.statusCode, JSON.parse(r.body).code], [409, 'email-mismatch']);
  }
  {
    const r = await runRedeem('buyer@example.com');
    const parsed = JSON.parse(r.body) as { ok?: boolean; license?: string };
    check('redeem succeeds for the buyer email', [r.statusCode, parsed.ok === true, typeof parsed.license === 'string' && parsed.license.length > 20], [200, true, true]);
  }

  globalThis.fetch = originalFetch;
  if (prevSa === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = prevSa;
  if (prevLsKey === undefined) delete process.env.LEMONSQUEEZY_API_KEY;
  else process.env.LEMONSQUEEZY_API_KEY = prevLsKey;
  if (prevSecret === undefined) delete process.env.BUDGET_PARSE_SECRET;
  else process.env.BUDGET_PARSE_SECRET = prevSecret;
  if (prevLicenseSecret === undefined) delete process.env.BUDGET_LICENSE_SECRET;
  else process.env.BUDGET_LICENSE_SECRET = prevLicenseSecret;
})();

// ---- i18n (2026-09): catalogs, plurals, ordinals, amounts, seeds ----
{
  check('i18n available languages (all ten)', availableLanguages(), ['ar', 'bn', 'en', 'es', 'fr', 'hi', 'pt', 'ru', 'ur', 'zh']);
  check('i18n rtl flags', [LANGS.ar.dir, LANGS.ur.dir], ['rtl', 'rtl']);
  for (const lang of availableLanguages()) {
    const missing = catalogKeys().filter((k) => catalogs[lang]?.[k] === undefined);
    check(`i18n catalog complete for ${lang}`, missing, []);
  }
  {
    // Placeholder consistency: every shipped language must use exactly the
    // same {params} as its English counterpart (catches branch-2 typos).
    const paramsOf = (v: unknown): string => {
      const grab = (s: string) => new Set(Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]));
      const out = new Set<string>();
      if (typeof v === 'string') grab(v).forEach((p) => out.add(p));
      else if (v && typeof v === 'object')
        for (const k of Object.keys(v)) grab(String((v as Record<string, string>)[k])).forEach((p) => out.add(p));
      return [...out].sort().join(',');
    };
    for (const lang of availableLanguages()) {
      for (const key of catalogKeys()) {
        const enV = (catalogs.en as Record<string, unknown>)[key];
        const trV = catalogs[lang]?.[key] as unknown;
        const a = paramsOf(enV);
        const b = paramsOf(trV);
        if (a !== b) check(`i18n ${lang} placeholders match en for ${key}`, b, a);
      }
    }
    check('i18n placeholder consistency across all shipped languages', failures, 0);
  }
  check('i18n en plural one', t('smart.addedBatch', { n: 1, amount: '$ 5' }), 'Added 1 transaction · $ 5');
  check('i18n en plural many', t('smart.addedBatch', { n: 3, amount: '$ 5' }), 'Added 3 transactions · $ 5');
  setLanguage('es');
  check('i18n es plural one', t('smart.addedBatch', { n: 1, amount: '$ 5' }), 'Agregada 1 transacción · $ 5');
  check('i18n es tab', t('tabs.cashFlow'), 'Flujo de caja');
  setLanguage('fr');
  check('i18n fr plural many', t('smart.addedBatch', { n: 3, amount: '5 $' }), '3 transactions ajoutées · 5 $');
  setLanguage('en');
  check('i18n en ordinal', [to(1), to(2), to(3), to(4)], ['1st', '2nd', '3rd', '4th']);
  setLanguage('es');
  check('i18n es ordinal', to(3), '3');
  setLanguage('fr');
  check('i18n fr ordinal', [to(1), to(2)], ['1er', '2e']);
  setLanguage('en');
  check('money en locale format', formatMoney(123456), '$\u00A01,235');
  setLanguage('es');
  check('money es locale format (grouping from 10k)', formatMoney(12345600), '$\u00A0123.456');
  check('money fr suffix no grouping', formatMoney(50000, 'fr'), '500\u00A0$');
  setLanguage('fr');
  check('seed french removed — new installs start empty', initialData().categories.length, 0);
  setLanguage('en');
  setLanguage('zh');
  check('i18n zh plural always other', t('smart.addedBatch', { n: 3, amount: '$ 5' }), '已添加 3 笔交易 · $ 5');
  check('money zh no-space prefix', formatMoney(123500), '$1,235');
  setLanguage('ru');
  check('i18n ru plural one', t('smart.addedBatch', { n: 1, amount: '5 $' }), 'Добавлена 1 транзакция · 5 $');
  check('i18n ru plural few', t('smart.addedBatch', { n: 3, amount: '5 $' }), 'Добавлены 3 транзакции · 5 $');
  check('money ru suffix', formatMoney(123500), '1\u00A0235\u00A0$');
  setLanguage('ar');
  check('i18n ar plural two', t('smart.addedBatch', { n: 2, amount: '5 $' }), 'أُضيفت معاملتان (2) · 5 $');
  check('money ar suffix', formatMoney(123500), '1,235\u00A0$');
  setLanguage('hi');
  check('money hi indian grouping', formatMoney(12345600), '$1,23,456');
  setLanguage('bn');
  check('money bn bengali digits', formatMoney(12345600), '$১,২৩,৪৫৬');
  setLanguage('en');

  // ---- install nudge (install-app-signal) ----
  check('install: never inside the installed app', decideInstallSignal({ standalone: true, dismissed: false, ios: true, canInstall: true }), null);
  check('install: never after dismissal', decideInstallSignal({ standalone: false, dismissed: true, ios: true, canInstall: true }), null);
  check('install: ios gets the share tip', decideInstallSignal({ standalone: false, dismissed: false, ios: true, canInstall: false }), { kind: 'ios-tip' });
  check('install: ios tip wins over a captured prompt', decideInstallSignal({ standalone: false, dismissed: false, ios: true, canInstall: true }), { kind: 'ios-tip' });
  check('install: chromium gets the install button', decideInstallSignal({ standalone: false, dismissed: false, ios: false, canInstall: true }), { kind: 'install-button' });
  check('install: no nudge without a prompt off ios', decideInstallSignal({ standalone: false, dismissed: false, ios: false, canInstall: false }), null);
  check('install: ua iphone', uaLooksIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', undefined), true);
  check('install: ua ipad', uaLooksIos('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15', undefined), true);
  check('install: ua ipad masquerading as mac', uaLooksIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5), true);
  check('install: ua mac without touch is not ios', uaLooksIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', undefined), false);
  check('install: ua android is not ios', uaLooksIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 5), false);
  check('install: standalone detection in node', isStandalone(), false);
  check('install: dismissal storage key', INSTALL_TIP_STORAGE_KEY, 'budget.installTipDismissed');
  check('install: tip delay positive', INSTALL_TIP_DELAY_MS > 0, true);
  check('i18n en install tip', t('install.iosTip'), 'Tap Share, then “Add to Home Screen”.');

  // ---- voice auto-send guardrails (ui-miscelaneous-0012) ----
  check('smart: min send length blocks stray entries', MIN_SEND_LENGTH, 3);
  check('smart: auto-send pause between 1 and 5 seconds', AUTO_SEND_PAUSE_MS >= 1000 && AUTO_SEND_PAUSE_MS <= 5000, true);
  check('i18n en auto-send countdown', t('smart.autoSendIn', { sec: 2 }), 'Sending in 2s…');

  // ---- category emoji field (category-emoji-field) ----
  check('emoji: single emoji stays', firstGrapheme('🏠'), '🏠');
  check('emoji: several emojis trim to one', firstGrapheme('🏠🔥💧'), '🏠');
  check('emoji: zwj family counts as one cluster', firstGrapheme('👨‍👩‍👧👍'), '👨‍👩‍👧');
  check('emoji: plain text keeps first char', firstGrapheme('abc'), 'a');
  check('emoji: empty stays empty', firstGrapheme(''), '');
  check('emoji: leading whitespace is trimmed at the call site', firstGrapheme('  🏠'.trim()), '🏠');
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll checks passed ✔');
