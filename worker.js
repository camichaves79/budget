/**
 * Cloudflare Worker entry (hosting migration A15, Phase 2): ONE Worker that
 * routes the six Vercel Functions to their UNMODIFIED Node-style
 * `handler(req, res)` implementations through a small adapter. Node-style
 * handlers are not Web-standard — this file is the bridge:
 *
 *   - toNodeReq:     Web Request → { method, url (path+query), headers
 *                    (lowercased, arrays when repeated), async body iterator }
 *   - createNodeRes: captures statusCode / setHeader / end → Web Response
 *   - fetch():       hydrates process.env from the env binding, routes by
 *                    path, then hands off — each handler keeps its own
 *                    CORS/secret/method logic (OPTIONS preflights are
 *                    answered inside the handlers, exactly like on Vercel).
 *
 * wrangler.toml enables nodejs_compat, which provides Buffer and node:crypto
 * used by the api modules. Instance-local state (parse response cache,
 * license meters, rate-limiter maps) persists per isolate, matching the
 * Vercel warm-instance behavior. Rate limiting keeps working: the Workers
 * cf-connecting-ip header is exposed as x-forwarded-for so the per-IP
 * limiters see the real client IP with no code changes.
 *
 * Env reads are all call-time (parse.js was made lazy-env for this — see its
 * module header): module scope in a Worker runs before any request, so
 * nothing may read process.env at import time.
 */

import parseHandler from './api/parse.js';
import redeemHandler from './api/license/redeem.js';
import lookupHandler from './api/license/lookup.js';
import checkHandler from './api/license/check.js';
import webhookHandler from './api/webhooks/ls.js';
import ledgerExportHandler from './api/ledger/export.js';

/**
 * Path → handler table (method checks stay inside the handlers, which
 * mirrors Vercel's per-file routing: OPTIONS answers 204 via handleCors,
 * wrong methods answer 405).
 * @type {Array<[string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>]>}
 */
const ROUTES = [
  ['/api/parse', parseHandler],
  ['/api/license/redeem', redeemHandler],
  ['/api/license/lookup', lookupHandler],
  ['/api/license/check', checkHandler],
  ['/api/webhooks/ls', webhookHandler],
  ['/api/ledger/export', ledgerExportHandler],
];

/**
 * Map a Web Request onto the IncomingMessage surface the handlers use.
 * Exported for the smoke suite.
 * @param {Request} request
 * @returns {import('node:http').IncomingMessage}
 */
export function toNodeReq(request) {
  /** @type {Record<string, string | string[]>} */
  const headers = {};
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    const existing = headers[lower];
    if (existing === undefined) headers[lower] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else headers[lower] = [existing, value];
  }
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && headers['x-forwarded-for'] === undefined) headers['x-forwarded-for'] = cfIp;

  const url = new URL(request.url);
  const bodyStream = request.body;
  const body = bodyStream
    ? (async function* () {
        const reader = bodyStream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield Buffer.from(value);
        }
      })()
    : (async function* () {})();

  return /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ ({
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    [Symbol.asyncIterator]: () => body[Symbol.asyncIterator](),
  }));
}

/**
 * Capture the ServerResponse surface the handlers use (setHeader /
 * statusCode / end) and turn it into a Web Response. Exported for the smoke
 * suite.
 * @returns {{ statusCode: number, setHeader: (key: string, value: string) => void, end: (text?: string) => void, toResponse: () => Response }}
 */
export function createNodeRes() {
  /** @type {Record<string, string>} */
  const headers = {};
  /** @type {string[]} */
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader(/** @type {string} */ key, /** @type {string} */ value) {
      headers[key.toLowerCase()] = String(value);
    },
    end(/** @type {string | undefined} */ text) {
      if (typeof text === 'string') chunks.push(text);
    },
    /** 204 must carry no body; an empty 200 body is still a body. */
    toResponse() {
      const body = chunks.length > 0 ? chunks.join('') : res.statusCode === 204 ? null : '';
      return new Response(body, { status: res.statusCode, headers });
    },
  };
  return res;
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    // nodejs_compat also populates process.env from the Worker's bindings;
    // this per-request hydration is belt-and-braces so every call-time env
    // read sees the Worker's variables (local `wrangler dev` included).
    Object.assign(process.env, env);

    const url = new URL(request.url);
    const route = ROUTES.find(([path]) => path === url.pathname);
    if (!route) return new Response('Not Found', { status: 404 });

    const req = toNodeReq(request);
    const res = createNodeRes();
    await route[1](req, /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)));
    return res.toResponse();
  },
};
