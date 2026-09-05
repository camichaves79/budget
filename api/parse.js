/**
 * Parse microservice — the budget app's first backend.
 *
 * A single Vercel Function (route: /api/parse) that proxies natural-language
 * transaction text to Google Gemini with the API key kept server-side. The
 * static PWA (GitHub Pages) calls this endpoint; it never touches Gemini or
 * any credentials.
 *
 * Deliberately plain JavaScript (JSDoc-typed) so the function deploys on
 * Vercel with no build step or tsconfig involvement. It is checked locally by
 * `tsc -b` via tsconfig.node.json (checkJs) and covered by tests/smoke.ts.
 *
 * The handler uses Vercel's Node.js runtime signature handler(req, res) with
 * Node-style http objects (Vercel invokes functions this way).
 *
 * Deploy: Vercel project (Framework Preset: Other, no build command) with
 * environment variables:
 *   GEMINI_API_KEY        — Google AI Studio API key (free tier)
 *   BUDGET_PARSE_SECRET   — shared secret; must match VITE_PARSE_SECRET baked
 *                           into the app build
 *   GEMINI_FALLBACK_MODEL — optional second model tried when the primary is
 *                           quota-blocked (defaults to gemini-3.5-flash-lite,
 *                           which has its own free-tier quota; empty string
 *                           disables the fallback)
 *
 * See README.md → "Smart entry (AI parsing)" for the full setup.
 */

/** Current free-tier Gemini model. Verified 2026-09-05 against this account's
 *  models list; Google recommends gemini-3.6-flash for new users (2.5-flash
 *  is deprecated for them). Check https://ai.google.dev/models if it changes. */
const GEMINI_MODEL = 'gemini-3.6-flash';
/**
 * Second model tried when the primary is blocked by quota (429) or transient
 * 5xx. gemini-3.5-flash-lite has its OWN free-tier quota (limits are per
 * model), so it doubles the daily headroom and gives a second lane when the
 * primary's quota is exhausted. Set the env var to an empty string to
 * disable the fallback.
 */
const FALLBACK_MODEL = (process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite').trim() || null;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Gemini's free tier is shared, so transient 429/5xx responses are common.
 * Retry a failed call up to RETRY_ATTEMPTS extra times, honoring the
 * provider-requested RetryInfo.retryDelay when it's short (traffic) and
 * giving up when it's long (daily quota exhausted — retrying is pointless;
 * the fallback model gets its turn instead).
 */
const RETRY_ATTEMPTS = 2;
const RETRY_SKIP_DELAY_SECONDS = 5;
const RETRY_DELAY_CAP_MS = 3000;
const RETRY_BACKOFF_MS = [800, 1600];

/** HTTP statuses worth retrying (0 = the fetch itself failed). */
const TRANSIENT_STATUSES = new Set([0, 429, 500, 502, 503, 529]);

/** Origins allowed to call this service (plus localhost for dev). */
const ALLOWED_ORIGINS = ['https://camichaves79.github.io'];

const MAX_BODY_BYTES = 10_000;
const MAX_UTTERANCE_CHARS = 500;
const MAX_CATEGORIES = 50;
const MAX_ID_CHARS = 64;
const MAX_NAME_CHARS = 64;
/** One utterance may produce many transactions, but never unboundedly many. */
const MAX_TRANSACTIONS = 20;

/** @typedef {{ id: string, name: string, kind: 'expense' | 'income' }} CategoryRef */
/** @typedef {{ utterance: string, categories: CategoryRef[], today: string }} ParseInput */

/* ---------- CORS ---------- */

/** @param {string | null} origin */
function isAllowedOrigin(origin) {
  if (origin === null || origin === '') return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Dev server and local previews on any port.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** @param {string | null} origin @returns {Record<string, string>} */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin ?? '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-budget-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} headers
 */
function send(res, status, body, headers) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.statusCode = status;
  if (body === null || body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Read the request body with a hard size cap. Returns null when too large.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<string | null>}
 */
async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) return null;
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* ---------- Rate limiting (per warm instance) ---------- */

/**
 * Fixed-window rate limiter. Serverless instances are ephemeral, so this is
 * best-effort protection against casual abuse, not a hard guarantee. The
 * origin allow-list and shared secret run first, so this only counts calls
 * that already authenticated; 40/10min leaves a single heavy user room to
 * work (test bursts, re-submits after retries) while still damping abuse.
 * @param {{ limit?: number, windowMs?: number }} opts
 */
export function createRateLimiter({ limit = 40, windowMs = 10 * 60 * 1000 } = {}) {
  return { limit, windowMs, /** @type {Map<string, { count: number, resetAt: number }>} */ hits: new Map() };
}

/**
 * @param {ReturnType<typeof createRateLimiter>} limiter
 * @param {string} key
 * @param {number} [now]
 * @returns {boolean} true when the request is allowed.
 */
export function checkRateLimit(limiter, key, now = Date.now()) {
  const entry = limiter.hits.get(key);
  if (!entry || now >= entry.resetAt) {
    limiter.hits.set(key, { count: 1, resetAt: now + limiter.windowMs });
    return true;
  }
  if (entry.count >= limiter.limit) return false;
  entry.count += 1;
  // Opportunistic cleanup so a warm instance never grows without bound.
  if (limiter.hits.size > 1000) {
    for (const [k, v] of limiter.hits) {
      if (now >= v.resetAt) limiter.hits.delete(k);
    }
  }
  return true;
}

/* ---------- Fair-use daily cap (shared free-tier quota protection) ---------- */

/**
 * Epoch ms of the next 00:00:00 in America/Los_Angeles (handles PDT/PST via
 * Intl). The daily cap resets at midnight Pacific time, matching Google's
 * RPD reset. Converges in two iterations: interpret the PT wall time as UTC
 * to recover the offset, jump to the next PT midnight, re-check.
 * @param {number} [now]
 * @returns {number}
 */
export function nextPTMidnight(now = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  /** @param {number} ms @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }} */
  const wall = (ms) => {
    const parts = fmt.formatToParts(new Date(ms));
    /** @param {string} t */
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
  };
  let guess = now;
  for (let i = 0; i < 8; i++) {
    const w = wall(guess);
    const wallEpoch = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    const offset = wallEpoch - guess;
    const ptNow = guess + offset;
    const sinceMidnight = ((ptNow % 86400000) + 86400000) % 86400000;
    guess = guess + (86400000 - sinceMidnight);
    const landed = wall(guess);
    if (landed.hour === 0 && landed.minute === 0 && landed.second === 0) return guess;
  }
  return guess;
}

/**
 * Fair-use daily cap (per IP, per warm instance). One device can't exhaust
 * the shared free-tier daily quota for everyone; when per-user keys exist the
 * cap should apply to shared-key requests only. Best-effort like the window
 * limiter: instances are ephemeral, and the window resets at PT midnight.
 * @param {{ limit?: number }} opts
 */
export function createDailyLimiter({ limit = 30 } = {}) {
  return { limit, /** @type {Map<string, { count: number, resetAt: number }>} */ hits: new Map() };
}

/**
 * @param {ReturnType<typeof createDailyLimiter>} limiter
 * @param {string} key
 * @param {number} [now]
 * @returns {{ allowed: boolean, retryAt: number }}
 */
export function checkDailyLimit(limiter, key, now = Date.now()) {
  const entry = limiter.hits.get(key);
  const retryAt = entry && now < entry.resetAt ? entry.resetAt : nextPTMidnight(now);
  if (!entry || now >= entry.resetAt) {
    limiter.hits.set(key, { count: 1, resetAt: retryAt });
    return { allowed: true, retryAt };
  }
  if (entry.count >= limiter.limit) return { allowed: false, retryAt };
  entry.count += 1;
  return { allowed: true, retryAt };
}

/* ---------- Request validation (treat the client as untrusted) ---------- */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} s */
export function isISODate(s) {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * Validate and whitelist the request body. Returns null when it can't be
 * trusted; otherwise a sanitized ParseInput (only known fields survive).
 * @param {unknown} raw
 * @returns {ParseInput | null}
 */
export function sanitizeRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);

  if (typeof r.utterance !== 'string') return null;
  const utterance = r.utterance.trim();
  if (utterance === '' || utterance.length > MAX_UTTERANCE_CHARS) return null;

  if (!Array.isArray(r.categories) || r.categories.length === 0 || r.categories.length > MAX_CATEGORIES) {
    return null;
  }
  /** @type {CategoryRef[]} */
  const categories = [];
  for (const c of r.categories) {
    if (!c || typeof c !== 'object') return null;
    const { id, name, kind } = /** @type {Record<string, unknown>} */ (c);
    if (typeof id !== 'string' || typeof name !== 'string') return null;
    const idTrimmed = id.trim();
    const nameTrimmed = name.trim();
    if (
      idTrimmed === '' || idTrimmed.length > MAX_ID_CHARS ||
      nameTrimmed === '' || nameTrimmed.length > MAX_NAME_CHARS ||
      (kind !== 'expense' && kind !== 'income')
    ) {
      return null;
    }
    categories.push({ id: idTrimmed, name: nameTrimmed, kind });
  }

  if (typeof r.today !== 'string' || !isISODate(r.today)) return null;

  return { utterance, categories, today: r.today };
}

/* ---------- Retry policy (Gemini free-tier 429s are common) ---------- */

/**
 * Read the provider-requested retry delay (seconds) from a Gemini error body.
 * Quota errors carry `error.details[].retryDelay` ("3s", "16s", "12h", …).
 * Returns null when the body doesn't specify one.
 * @param {unknown} errBody
 * @returns {number | null}
 */
export function parseRetryDelaySeconds(errBody) {
  if (!errBody || typeof errBody !== 'object' || Array.isArray(errBody)) return null;
  const error = /** @type {Record<string, unknown>} */ (errBody).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const details = /** @type {Record<string, unknown>} */ (error).details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const rec = /** @type {Record<string, unknown>} */ (d);
    if (rec['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo' || typeof rec.retryDelay !== 'string') continue;
    const m = /^(\d+(?:\.\d+)?)s$/.exec(rec.retryDelay);
    if (m) return Number(m[1]);
  }
  return null;
}

/** @param {number} status @returns {boolean} */
export function isTransientGeminiStatus(status) {
  return TRANSIENT_STATUSES.has(status);
}

/**
 * How long (ms) to wait before retrying a failed Gemini call; 0 = don't
 * retry. Short provider-requested delays are honored (capped), long ones
 * (daily quota) are not retried at all.
 * @param {{ attempt: number, status: number, retryDelaySeconds: number | null }} failure
 * @returns {number}
 */
export function nextRetryDelayMs({ attempt, status, retryDelaySeconds }) {
  if (attempt >= RETRY_ATTEMPTS) return 0;
  if (!isTransientGeminiStatus(status)) return 0;
  if (retryDelaySeconds !== null && retryDelaySeconds > RETRY_SKIP_DELAY_SECONDS) return 0;
  if (retryDelaySeconds !== null) {
    return Math.min(Math.max(Math.round(retryDelaySeconds * 1000), 0), RETRY_DELAY_CAP_MS);
  }
  return RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? 0;
}

/* ---------- Response cache (per warm instance) ---------- */

/**
 * Successful parses are cached so that re-submitting the same text (exactly
 * the flow the "try again in a moment" message suggests) answers instantly
 * and costs no Gemini quota. Instance-local only: warm instances share
 * nothing and a cold start loses it — acceptable for a single-user app, and
 * free (no storage service).
 * @param {{ ttlMs?: number, maxEntries?: number }} opts
 */
export function createResponseCache({ ttlMs = 60 * 60 * 1000, maxEntries = 200 } = {}) {
  return {
    ttlMs,
    maxEntries,
    /** @type {Map<string, { at: number, parsed: Record<string, unknown>[] }>} */
    entries: new Map(),
  };
}

/** Deterministic key for an identical parse request (text + date + categories). */
/** @param {ParseInput} input */
export function cacheKeyFor(input) {
  return JSON.stringify([input.utterance, input.today, input.categories]);
}

/**
 * @param {ReturnType<typeof createResponseCache>} cache
 * @param {string} key
 * @param {number} [now]
 * @returns {Record<string, unknown>[] | null}
 */
export function cacheGet(cache, key, now = Date.now()) {
  const entry = cache.entries.get(key);
  if (!entry) return null;
  if (now - entry.at > cache.ttlMs) {
    cache.entries.delete(key);
    return null;
  }
  return entry.parsed;
}

/**
 * @param {ReturnType<typeof createResponseCache>} cache
 * @param {string} key
 * @param {Record<string, unknown>[]} parsed
 * @param {number} [now]
 */
export function cacheSet(cache, key, parsed, now = Date.now()) {
  if (cache.entries.size >= cache.maxEntries) {
    const oldest = cache.entries.keys().next().value;
    if (oldest !== undefined) cache.entries.delete(oldest);
  }
  cache.entries.set(key, { at: now, parsed });
}

/* ---------- Gemini integration ---------- */

/**
 * @param {CategoryRef[]} categories
 * @param {string} today
 */
export function buildSystemPrompt(categories, today) {
  const lines = categories.map((c) => `${c.id} | ${c.name} | ${c.kind}`);
  return [
    'You turn short natural-language transaction descriptions into structured JSON for a budget app.',
    'The user may type or dictate in any language; the JSON keys stay fixed.',
    'The user may describe SEVERAL transactions in one message (a list of payments or income). Split them into one array element per transaction. Do not merge two items into one, and do not split one item into several.',
    'Amounts are in Colombian pesos (COP). Read the number the user said as pesos — do not convert currencies and do no arithmetic beyond reading the amount.',
    `Today's date is ${today}. Resolve relative dates ("yesterday", "last Friday") against it. If no date can be determined, use null.`,
    'Respond with ONLY a JSON array of transaction objects (usually one element). Each element has exactly these keys:',
    '"type": "expense" or "income"',
    '"amount": positive number in pesos, no thousands separators',
    '"categoryId": one of the category ids below (matching the transaction kind), or null if none fits',
    '"notes": a very short description of that transaction, or null',
    '"date": "YYYY-MM-DD", or null',
    '"confidence": a number from 0 to 1 — how certain you are that this transaction is correctly understood (0 = guessing, 1 = certain). Lower the confidence and use null for any field you are unsure about.',
    'Available categories (id | name | kind):',
    ...(lines.length ? lines : ['(none)']),
  ].join('\n');
}

/**
 * Extract the structured JSON array from a Gemini generateContent response.
 * The LLM output is untrusted: only a NON-EMPTY plain array of plain objects
 * (capped at MAX_TRANSACTIONS) is returned; the app re-validates every
 * element client-side before creating anything.
 * @param {unknown} payload
 * @returns {Record<string, unknown>[] | null}
 */
export function parseGeminiResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidates = /** @type {{ candidates?: unknown }} */ (payload).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!first || typeof first !== 'object') return null;
  const content = /** @type {{ content?: unknown }} */ (first).content;
  if (!content || typeof content !== 'object') return null;
  const parts = /** @type {{ parts?: unknown }} */ (content).parts;
  if (!Array.isArray(parts)) return null;
  let text = null;
  for (const part of parts) {
    if (part && typeof part === 'object' && typeof (/** @type {{ text?: unknown }} */ (part).text) === 'string') {
      text = /** @type {{ text?: string }} */ (part).text ?? null;
      break;
    }
  }
  if (text === null) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_TRANSACTIONS) return null;
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  }
  return parsed;
}

/* ---------- Handler ---------- */

const rateLimiter = createRateLimiter();
const dailyLimiter = createDailyLimiter();
const responseCache = createResponseCache();

/**
 * In-memory counters for the owner (GET /api/parse with the secret).
 * Per warm instance and lossy by design — a glance at usage, not a metric
 * system. Counts only; never user text.
 */
const stats = {
  calls: 0, // authenticated POSTs that reached parsing
  cacheHits: 0,
  gemini429: 0,
  rateLimited: 0, // per-IP 10-min window
  dailyLimited: 0, // per-IP fair-use daily cap
  fallbackUsed: 0,
};

/** @typedef {{ status: number, code: string, retryDelaySeconds: number | null }} GeminiFailure */

/**
 * One generateContent call for one model. Never throws: failures come back
 * as a structured `{ ok: false, status, ... }` so the caller decides whether
 * to retry or fall back.
 * @param {string} model
 * @param {ParseInput} input
 * @param {string} apiKey
 * @returns {Promise<{ ok: true, parsed: Record<string, unknown>[] } | { ok: false } & GeminiFailure>}
 */
async function callGemini(model, input, apiKey) {
  let geminiRes;
  try {
    geminiRes = await fetch(`${GEMINI_URL}${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(input.categories, input.today) }] },
        contents: [{ role: 'user', parts: [{ text: input.utterance }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          // Long transaction lists need more room than a single entry; the
          // "low" thinking level keeps hidden thoughts from eating it.
          maxOutputTokens: 2000,
          // Gemini 3.x thinks by default and hidden thoughts eat the output
          // budget before the answer is produced; "low" keeps extraction fast
          // and leaves the budget for the JSON answer.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });
  } catch {
    console.error('gemini fetch failed', model);
    return { ok: false, status: 0, code: 'network', retryDelaySeconds: null };
  }

  if (!geminiRes.ok) {
    // Log provider metadata only (model, status, error code, retry delay) —
    // never user text.
    let retryDelaySeconds = null;
    try {
      const errBody = await geminiRes.json();
      retryDelaySeconds = parseRetryDelaySeconds(errBody);
      const err = errBody && typeof errBody === 'object' ? /** @type {{ error?: unknown }} */ (errBody).error : null;
      const code = err && typeof err === 'object' ? String(/** @type {{ code?: unknown }} */ (err).code ?? '') : '';
      const status = err && typeof err === 'object' ? String(/** @type {{ status?: unknown }} */ (err).status ?? '') : '';
      console.error(
        'gemini error',
        model,
        geminiRes.status,
        code || status || 'no body',
        retryDelaySeconds === null ? 'retryDelay=n/a' : `retryDelay=${retryDelaySeconds}s`,
      );
    } catch {
      console.error('gemini error', model, geminiRes.status, 'no body', 'retryDelay=n/a');
    }
    if (geminiRes.status === 429) stats.gemini429++;
    return { ok: false, status: geminiRes.status, code: 'http', retryDelaySeconds };
  }

  let payload;
  try {
    payload = await geminiRes.json();
  } catch {
    console.error('gemini bad json', model);
    return { ok: false, status: 200, code: 'bad-json', retryDelaySeconds: null };
  }

  const parsed = parseGeminiResponse(payload);
  if (!parsed) {
    return { ok: false, status: 200, code: 'invalid-response', retryDelaySeconds: null };
  }
  return { ok: true, parsed };
}

/**
 * Parse with the primary model, retrying transient failures with backoff,
 * then try the fallback model when the primary stays quota-blocked (its
 * quota is separate, so it usually has headroom left). Never throws.
 * @param {ParseInput} input
 * @param {string} apiKey
 * @returns {Promise<{ ok: true, parsed: Record<string, unknown>[], model: string } | { ok: false, failure: GeminiFailure }>}
 */
async function parseWithGemini(input, apiKey) {
  const models = [GEMINI_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== GEMINI_MODEL) models.push(FALLBACK_MODEL);

  let lastFailure = /** @type {GeminiFailure} */ ({ status: 0, code: 'network', retryDelaySeconds: null });
  let transientFailure = null;
  for (const model of models) {
    let attempt = 0;
    for (;;) {
      const result = await callGemini(model, input, apiKey);
      if (result.ok) {
        if (model !== GEMINI_MODEL) {
          stats.fallbackUsed++;
          console.error('gemini fallback model used', model);
        }
        return { ok: true, parsed: result.parsed, model };
      }
      lastFailure = { status: result.status, code: result.code, retryDelaySeconds: result.retryDelaySeconds };
      if (isTransientGeminiStatus(result.status)) transientFailure = lastFailure;
      const delayMs = nextRetryDelayMs({ attempt, status: result.status, retryDelaySeconds: result.retryDelaySeconds });
      if (delayMs === 0) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
    // The fallback only helps quota/transient failures; a config or key
    // error (4xx) would fail identically on the second model.
    if (!isTransientGeminiStatus(lastFailure.status)) break;
  }
  // Prefer reporting the quota-type failure even when the fallback model
  // itself failed for another reason — the client shows the friendly
  // "busy" message and the user retries in a moment.
  return { ok: false, failure: transientFailure ?? lastFailure };
}

/**
 * POST { utterance, categories, today } with header `x-budget-secret` →
 * { ok: true, parsed: <LLM JSON array> } or { ok: false, code }.
 * GET with the same header + allowed origin → { ok: true, stats } (owner
 * glance at in-memory counters; per warm instance).
 *
 * Successful parses are cached per warm instance (TTL 1h), so re-submitting
 * identical text — the natural retry after a "busy" response — answers
 * instantly without a Gemini call. Codes: `bad-request`, `unauthorized`,
 * `origin-not-allowed`, `rate-limited` (our per-IP 10-min limiter),
 * `daily-limit` (fair-use per-IP daily cap with `retryAt`, PT midnight),
 * `provider-busy` (Gemini quota/transient after retries + fallback),
 * `provider`, `invalid-response`.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    send(res, 204, null, cors);
    return;
  }
  if (!isAllowedOrigin(origin)) {
    send(res, 403, { ok: false, code: 'origin-not-allowed' }, cors);
    return;
  }

  const rawSecret = req.headers['x-budget-secret'];
  const secret = Array.isArray(rawSecret) ? (rawSecret[0] ?? '') : (rawSecret ?? '');
  const expected = process.env.BUDGET_PARSE_SECRET ?? '';
  if (expected === '' || secret === '' || secret !== expected) {
    send(res, 401, { ok: false, code: 'unauthorized' }, cors);
    return;
  }

  if (req.method === 'GET') {
    // Owner stats: a glance at usage (in-memory, per warm instance).
    send(res, 200, { ok: true, stats: { ...stats } }, cors);
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown') || 'unknown';
  if (!checkRateLimit(rateLimiter, ip)) {
    stats.rateLimited++;
    send(res, 429, { ok: false, code: 'rate-limited' }, cors);
    return;
  }
  const daily = checkDailyLimit(dailyLimiter, ip);
  if (!daily.allowed) {
    stats.dailyLimited++;
    send(res, 429, { ok: false, code: 'daily-limit', retryAt: daily.retryAt }, cors);
    return;
  }
  stats.calls++;

  const bodyText = await readBody(req, MAX_BODY_BYTES);
  let raw;
  try {
    if (bodyText === null) throw new Error('body too large');
    raw = JSON.parse(bodyText);
  } catch {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }
  const input = sanitizeRequest(raw);
  if (!input) {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (apiKey === '') {
    send(res, 502, { ok: false, code: 'provider' }, cors);
    return;
  }

  // Re-submitting identical text answers from the warm-instance cache with
  // no Gemini call and no quota cost.
  const cacheKey = cacheKeyFor(input);
  const cached = cacheGet(responseCache, cacheKey);
  if (cached !== null) {
    stats.cacheHits++;
    send(res, 200, { ok: true, parsed: cached }, cors);
    return;
  }

  const outcome = await parseWithGemini(input, apiKey);
  if (outcome.ok) {
    cacheSet(responseCache, cacheKey, outcome.parsed);
    send(res, 200, { ok: true, parsed: outcome.parsed }, cors);
    return;
  }

  const failure = outcome.failure;
  if (failure.code === 'invalid-response') {
    send(res, 200, { ok: false, code: 'invalid-response' }, cors);
    return;
  }
  if (failure.status === 429 || failure.status === 0) {
    // Gemini quota exhausted (429) or Google unreachable — the client shows
    // the friendly "busy" message and the user retries in a moment.
    send(res, 503, { ok: false, code: 'provider-busy' }, cors);
    return;
  }
  send(res, 502, { ok: false, code: 'provider' }, cors);
}
