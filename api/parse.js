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
 *   GEMINI_API_KEY      — Google AI Studio API key (free tier)
 *   BUDGET_PARSE_SECRET — shared secret; must match VITE_PARSE_SECRET baked
 *                         into the app build
 *
 * See README.md → "Smart entry (AI parsing)" for the full setup.
 */

/** Current free-tier Gemini model. Verified 2026-09-05 against this account's
 *  models list; Google recommends gemini-3.6-flash for new users (2.5-flash
 *  is deprecated for them). Check https://ai.google.dev/models if it changes. */
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

/** Origins allowed to call this service (plus localhost for dev). */
const ALLOWED_ORIGINS = ['https://camichaves79.github.io'];

const MAX_BODY_BYTES = 10_000;
const MAX_UTTERANCE_CHARS = 500;
const MAX_CATEGORIES = 50;
const MAX_ID_CHARS = 64;
const MAX_NAME_CHARS = 64;

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
 * best-effort protection against casual abuse, not a hard guarantee.
 * @param {{ limit?: number, windowMs?: number }} opts
 */
export function createRateLimiter({ limit = 20, windowMs = 10 * 60 * 1000 } = {}) {
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

/* ---------- Gemini integration ---------- */

/**
 * @param {CategoryRef[]} categories
 * @param {string} today
 */
export function buildSystemPrompt(categories, today) {
  const lines = categories.map((c) => `${c.id} | ${c.name} | ${c.kind}`);
  return [
    'You turn a short natural-language transaction description into structured JSON for a budget app.',
    'The user may type or dictate in any language; the JSON keys stay fixed.',
    'Amounts are in Colombian pesos (COP). Read the number the user said as pesos — do not convert currencies and do no arithmetic beyond reading the amount.',
    `Today's date is ${today}. Resolve relative dates ("yesterday", "last Friday") against it. If no date can be determined, use null.`,
    'Respond with ONLY one JSON object with exactly these keys:',
    '"type": "expense" or "income"',
    '"amount": positive number in pesos, no thousands separators',
    '"categoryId": one of the category ids below (matching the transaction kind), or null if none fits',
    '"notes": a very short description, or null',
    '"date": "YYYY-MM-DD", or null',
    'Available categories (id | name | kind):',
    ...(lines.length ? lines : ['(none)']),
  ].join('\n');
}

/**
 * Extract the structured JSON object from a Gemini generateContent response.
 * The LLM output is untrusted: only a plain object that parsed as JSON is
 * returned; the app re-validates it client-side before creating anything.
 * @param {unknown} payload
 * @returns {Record<string, unknown> | null}
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/* ---------- Handler ---------- */

const rateLimiter = createRateLimiter();

/**
 * POST { utterance, categories, today } with header `x-budget-secret` →
 * { ok: true, parsed: <LLM JSON> } or { ok: false, code }.
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
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, code: 'bad-request' }, cors);
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

  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown') || 'unknown';
  if (!checkRateLimit(rateLimiter, ip)) {
    send(res, 429, { ok: false, code: 'rate-limited' }, cors);
    return;
  }

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

  let geminiRes;
  try {
    geminiRes = await fetch(`${GEMINI_URL}${GEMINI_MODEL}:generateContent`, {
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
          maxOutputTokens: 500,
          // Gemini 3.x thinks by default and hidden thoughts eat the output
          // budget before the answer is produced; "low" keeps extraction fast
          // and leaves the budget for the JSON answer.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });
  } catch {
    send(res, 502, { ok: false, code: 'provider' }, cors);
    return;
  }

  if (!geminiRes.ok) {
    // Log provider metadata only (status + error code) — never user text.
    try {
      const errBody = await geminiRes.json();
      const err = errBody && typeof errBody === 'object' ? /** @type {{ error?: unknown }} */ (errBody).error : null;
      const code = err && typeof err === 'object' ? /** @type {{ code?: unknown, message?: unknown }} */ (err).code : null;
      console.error('gemini error', geminiRes.status, String(code ?? ''), String((/** @type {{ message?: unknown }} */ (err ?? {})).message ?? ''));
    } catch {
      console.error('gemini error', geminiRes.status, 'no body');
    }
    // 429 = Gemini quota; 401/403 = key problem; anything else is transient.
    if (geminiRes.status === 429) {
      send(res, 429, { ok: false, code: 'rate-limited' }, cors);
      return;
    }
    send(res, 502, { ok: false, code: 'provider' }, cors);
    return;
  }

  let payload;
  try {
    payload = await geminiRes.json();
  } catch {
    send(res, 502, { ok: false, code: 'provider' }, cors);
    return;
  }

  const parsed = parseGeminiResponse(payload);
  if (!parsed) {
    send(res, 200, { ok: false, code: 'invalid-response' }, cors);
    return;
  }
  send(res, 200, { ok: true, parsed }, cors);
}
