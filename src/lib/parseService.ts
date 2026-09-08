import type { Category, TxType } from './types';
import { isValidISODate, todayISO } from './dates';
import { getLanguage, t } from './i18n';

/**
 * AI transaction parsing through the app's parse microservice
 * (api/parse.js on Vercel — see README "Smart entry (AI parsing)").
 *
 * This module is the ONLY place in the app that knows about the service:
 * endpoint and shared secret come from build-time Vite env vars, and the LLM
 * API key itself lives server-side and never reaches the client. Swap the
 * provider/service here without touching any UI.
 *
 * Privacy: only the user's utterance and the current category list are sent.
 * Transaction history never leaves the device.
 */

const ENDPOINT = (import.meta.env.VITE_PARSE_ENDPOINT ?? '').trim();
const SECRET = (import.meta.env.VITE_PARSE_SECRET ?? '').trim();

/** Structured result of a successful parse, ready for the review step. */
export interface ParsedDraft {
  type: TxType;
  /** Integer centavos, converted from the LLM's peso amount. */
  amountCents: number;
  /** Null when the LLM couldn't map a category — the user picks in review. */
  categoryId: string | null;
  /** YYYY-MM-DD, or null when undetermined (review defaults to today). */
  date: string | null;
  note?: string;
  /**
   * LLM self-assessed certainty (0–1) that this transaction is correctly
   * understood. Normalized: missing/null → 1 (behave like today), malformed
   * or out-of-range → 0 (never saved blindly). Drives the review gate only.
   */
  confidence: number;
}

export type ParseErrorKind =
  | 'not-configured'
  | 'rate-limit'
  | 'provider'
  | 'network'
  | 'invalid-response'
  | 'license';

export interface ParseError {
  kind: ParseErrorKind;
  /** User-facing message. */
  message: string;
}

export type ParseResult = { ok: true; drafts: ParsedDraft[] } | { ok: false; error: ParseError };

/**
 * Service-side failures that are usually transient (shared free-tier quota
 * or a busy provider): worth ONE automatic retry before the user sees an
 * error. Network problems and unparseable replies are not retried — the
 * user is probably offline or needs to reword.
 */
const RETRYABLE_KINDS: ReadonlySet<ParseErrorKind> = new Set(['rate-limit', 'provider']);
const RETRY_DELAY_MS = 2000;

/** @returns true when the error deserves the single automatic retry. */
export function isRetryableParseError(error: ParseError): boolean {
  return RETRYABLE_KINDS.has(error.kind);
}

export interface ParseOptions {
  /** Called right before the automatic retry so the UI can update its label. */
  onRetry?: () => void;
  /**
   * Signed license token to attach to the request (unlimited tier). The
   * microservice verifies the signature and meters the license; invalid
   * tokens come back as a `license` error so the UI can clear them.
   */
  license?: string | null;
}

/**
 * Pure trust boundary for LLM output. The LLM never does arithmetic: the
 * frontend converts pesos → integer centavos here. `type` and `amount` are
 * required; category/date/notes may be absent or null and are filled in
 * during review. Unsupported category ids are dropped to null (never guessed
 * into a real category). Returns null when the payload can't be trusted.
 */
export function validateParsedTransaction(raw: unknown, categories: Category[]): ParsedDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const type = r.type;
  if (type !== 'expense' && type !== 'income') return null;

  let amount: number;
  if (typeof r.amount === 'number') {
    amount = r.amount;
  } else if (typeof r.amount === 'string' && r.amount.trim() !== '') {
    amount = Number(r.amount);
  } else {
    return null;
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const amountCents = Math.round(amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return null;

  let categoryId: string | null = null;
  if (typeof r.categoryId === 'string' && r.categoryId !== '') {
    const cat = categories.find((c) => c.id === r.categoryId);
    if (cat && cat.kind === type && !cat.archived) categoryId = r.categoryId;
  }

  let date: string | null = null;
  if (typeof r.date === 'string' && isValidISODate(r.date)) date = r.date;

  // Certainty grade: a finite number in [0,1] is kept; missing/null means the
  // model said nothing (trust as today); anything else is corrupt (review).
  let confidence = 1;
  const rawConfidence = r.confidence;
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    confidence = rawConfidence >= 0 && rawConfidence <= 1 ? rawConfidence : 0;
  } else if (rawConfidence !== undefined && rawConfidence !== null) {
    confidence = 0;
  }

  const draft: ParsedDraft = { type, amountCents, categoryId, date, confidence };
  if (typeof r.notes === 'string') {
    const note = r.notes.trim();
    if (note) draft.note = note;
  }
  return draft;
}

/** One utterance may yield many transactions, but never unboundedly many. */
export const MAX_TRANSACTIONS = 20;

/**
 * Below this grade the entry is flagged for review instead of instant-save,
 * even when every field parsed. Tuned by the user (0.8, 2026-09).
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

/** True when the draft must be checked by the user before it is saved. */
export function needsReview(draft: ParsedDraft): boolean {
  return draft.categoryId === null || draft.confidence < REVIEW_CONFIDENCE_THRESHOLD;
}

/**
 * Trust boundary for a whole parse: a non-empty array (capped) where EVERY
 * element passes validateParsedTransaction. One bad element rejects the
 * entire payload — a dubious transaction is never silently dropped.
 */
export function validateParsedTransactions(raw: unknown, categories: Category[]): ParsedDraft[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRANSACTIONS) return null;
  const drafts: ParsedDraft[] = [];
  for (const item of raw) {
    const draft = validateParsedTransaction(item, categories);
    if (!draft) return null;
    drafts.push(draft);
  }
  return drafts;
}

const NOT_CONFIGURED: ParseResult = {
  ok: false,
  error: {
    kind: 'not-configured',
    message: t('parse.notConfigured'),
  },
};

/**
 * Send the utterance to the parse microservice and validate the reply.
 * Transient service-side failures (busy/quota) get one automatic retry after
 * a short pause, so most free-tier 429s clear without any user action.
 */
export async function parseUtterance(
  utterance: string,
  categories: Category[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const first = await parseUtteranceOnce(utterance, categories, options.license ?? null);
  if (first.ok || !isRetryableParseError(first.error)) return first;
  options.onRetry?.();
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return parseUtteranceOnce(utterance, categories, options.license ?? null);
}

/** Single parse attempt; see parseUtterance for the retry wrapper. */
async function parseUtteranceOnce(utterance: string, categories: Category[], license: string | null): Promise<ParseResult> {
  const text = utterance.trim();
  if (!text) {
    return { ok: false, error: { kind: 'invalid-response', message: t('parse.nothing') } };
  }
  if (!ENDPOINT || !SECRET) return NOT_CONFIGURED;

  const refs = categories
    .filter((c) => !c.archived)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-budget-secret': SECRET,
      },
      body: JSON.stringify({ utterance: text, categories: refs, today: todayISO(), language: getLanguage(), license: license ?? null }),
    });
  } catch {
    return {
      ok: false,
      error: { kind: 'network', message: t('parse.unreachable') },
    };
  }

  if (res.status === 401 || res.status === 403) return NOT_CONFIGURED;

  let payload: { ok?: boolean; parsed?: unknown; code?: string } | null = null;
  try {
    payload = (await res.json()) as { ok?: boolean; parsed?: unknown; code?: string };
  } catch {
    payload = null;
  }

  if (payload && payload.ok === true && payload.parsed !== undefined) {
    const drafts = validateParsedTransactions(payload.parsed, categories);
    if (drafts) return { ok: true, drafts };
    return invalidResponse();
  }

  const code = payload?.code;
  // License rejections take priority: the server answers them with 403/429,
  // which must not be confused with the free-tier "busy" paths.
  if (code === 'license-invalid') return licenseGone();
  if (code === 'license-limit') return licenseLimit();
  // rate-limited = our per-IP limiter; provider-busy = Gemini quota/transient
  // after the server's own retries and fallback. Same friendly message, same
  // single automatic retry on the client.
  if (code === 'rate-limited' || code === 'provider-busy' || res.status === 429) return busy();
  if (code === 'invalid-response') return invalidResponse();
  if (code === 'provider' || res.status >= 500) return providerTrouble();
  if (code === 'unauthorized' || code === 'origin-not-allowed') return NOT_CONFIGURED;
  return unexpected();
}

function licenseGone(): ParseResult {
  return {
    ok: false,
    error: {
      kind: 'license',
      message: t('parse.licenseGone'),
    },
  };
}

function licenseLimit(): ParseResult {
  return {
    ok: false,
    error: {
      kind: 'license',
      message: t('parse.licenseLimit'),
    },
  };
}

function busy(): ParseResult {
  return {
    ok: false,
    error: { kind: 'rate-limit', message: t('parse.busy') },
  };
}

function providerTrouble(): ParseResult {
  return {
    ok: false,
    error: { kind: 'provider', message: t('parse.trouble') },
  };
}

function unexpected(): ParseResult {
  return {
    ok: false,
    error: { kind: 'network', message: t('parse.unexpected') },
  };
}

function invalidResponse(): ParseResult {
  return {
    ok: false,
    error: { kind: 'invalid-response', message: t('parse.unclear') },
  };
}
