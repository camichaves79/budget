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
 * Deploy: create a Vercel project (Framework Preset: Other, no build command)
 * importing this repo, then set environment variables:
 *   GEMINI_API_KEY      — Google AI Studio API key (free tier)
 *   BUDGET_PARSE_SECRET — shared secret; must match VITE_PARSE_SECRET baked
 *                         into the app build
 *
 * See README.md → "Smart entry (AI parsing)" for the full setup.
 */

/** Current free-tier Gemini model (verify at https://ai.google.dev/models). */
const GEMINI_MODEL = 'gemini-2.5-flash';
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

/** @param {unknown} body @param {number} status @param {Record<string, string>} headers @returns {Response} */
function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
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
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export default async function handler(req) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ ok: false, code: 'bad-request' }, 405, cors);
  if (!isAllowedOrigin(origin)) return json({ ok: false, code: 'origin-not-allowed' }, 403, cors);

  const secret = req.headers.get('x-budget-secret') ?? '';
  const expected = process.env.BUDGET_PARSE_SECRET ?? '';
  if (expected === '' || secret === '' || secret !== expected) {
    return json({ ok: false, code: 'unauthorized' }, 401, cors);
  }

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  if (!checkRateLimit(rateLimiter, ip)) {
    return json({ ok: false, code: 'rate-limited' }, 429, cors);
  }

  let raw;
  try {
    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_BYTES) throw new Error('body too large');
    raw = JSON.parse(bodyText);
  } catch {
    return json({ ok: false, code: 'bad-request' }, 400, cors);
  }
  const input = sanitizeRequest(raw);
  if (!input) return json({ ok: false, code: 'bad-request' }, 400, cors);

  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (apiKey === '') return json({ ok: false, code: 'provider' }, 502, cors);

  let res;
  try {
    res = await fetch(`${GEMINI_URL}${GEMINI_MODEL}:generateContent`, {
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
          maxOutputTokens: 300,
        },
      }),
    });
  } catch {
    return json({ ok: false, code: 'provider' }, 502, cors);
  }

  if (!res.ok) {
    // 429 = Gemini quota; 401/403 = key problem; anything else is transient.
    if (res.status === 429) return json({ ok: false, code: 'rate-limited' }, 429, cors);
    return json({ ok: false, code: 'provider' }, 502, cors);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return json({ ok: false, code: 'provider' }, 502, cors);
  }

  const parsed = parseGeminiResponse(payload);
  if (!parsed) return json({ ok: false, code: 'invalid-response' }, 200, cors);
  return json({ ok: true, parsed }, 200, cors);
}
