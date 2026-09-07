/**
 * Shared HTTP helpers for the license/ledger Vercel Functions.
 * (api/parse.js keeps its own copies — it shipped first and is untouched
 * except for the license check; new files import from here.)
 *
 * Plain JS with JSDoc, checked by tsconfig.node.json (checkJs), tested via
 * tests/smoke.ts. Node-style handler(req, res) — Vercel does NOT use the Web
 * Request API for these functions.
 */

const ALLOWED_ORIGINS = ['https://camichaves79.github.io'];

/** @param {string | null} origin */
export function isAllowedOrigin(origin) {
  if (origin === null || origin === '') return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Dev server and local previews on any port.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** @param {string | null} origin @returns {Record<string, string>} */
export function corsHeaders(origin) {
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
export function send(res, status, body, headers) {
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
 * Read + JSON-parse a bounded request body. Resolves null on any failure.
 * @param {import('node:http').IncomingMessage} req
 */
export async function readJsonBody(req, maxBytes = 10_000) {
  const text = await readBodyText(req, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read the raw body as text (bounded). Resolves null on any failure.
 * @param {import('node:http').IncomingMessage} req
 */
export async function readBodyText(req, maxBytes = 64_000) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBytes) return null;
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Enforce the shared-secret header (same posture as api/parse.js, A10).
 * Returns true when the request carries the right secret.
 * @param {import('node:http').IncomingMessage} req
 */
export function hasSharedSecret(req) {
  const raw = req.headers['x-budget-secret'];
  const secret = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const expected = process.env.BUDGET_PARSE_SECRET ?? '';
  return expected !== '' && secret !== '' && secret === expected;
}

/* ---------- Per-IP rate limiting (shared by the license endpoints) ---------- */

/**
 * Fixed-window per-IP limiter, same design as api/parse.js (which keeps its
 * own copy — this one is for the newer endpoints). Dampens order-id
 * enumeration against the redeem endpoint; NOT a hard guarantee (instances
 * are ephemeral), just like the parse limiter.
 * @param {{ limit?: number, windowMs?: number }} [opts]
 */
export function createIpRateLimiter({ limit = 30, windowMs = 10 * 60 * 1000 } = {}) {
  return { limit, windowMs, /** @type {Map<string, { count: number, resetAt: number }>} */ hits: new Map() };
}

/**
 * Count one hit from the request's IP (x-forwarded-for first hop, "unknown"
 * fallback). Returns true when the request is allowed.
 * @param {{ limit: number, windowMs: number, hits: Map<string, { count: number, resetAt: number }> }} limiter
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [now]
 */
export function checkIpRateLimit(limiter, req, now = Date.now()) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : 'unknown') || 'unknown';
  const entry = limiter.hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    limiter.hits.set(ip, { count: 1, resetAt: now + limiter.windowMs });
    return true;
  }
  if (entry.count >= limiter.limit) return false;
  entry.count += 1;
  return true;
}

/**
 * Standard CORS/OPTIONS prologue shared by every function.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function handleCors(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') {
    send(res, 204, null, cors);
    return { cors, done: true };
  }
  return { cors, done: false };
}
