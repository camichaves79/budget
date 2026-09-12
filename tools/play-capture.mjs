/**
 * Capture the CLIENT layer of a Play purchase, inside the live TWA page, over
 * the Chrome DevTools protocol.
 *
 * Why: every previous attempt was missing at least one layer. The Worker logs a
 * safe `tokenFingerprint` (v0.3.11), but that only helps if someone is watching
 * the Cloudflare log stream at the right second — and it never shows the token
 * itself, so a token that Google rejects cannot be re-tested directly. The app
 * posts the purchase token to `/api/license/redeem-play`, and that request body
 * is the single most valuable artifact of a retry: it is the exact
 * `purchaseToken` + `productId` the APP sent.
 *
 * This patches `window.fetch` in the live page (no rebuild, no support build,
 * works on a release TWA because Chrome is the debuggable process) and records
 * every `/api/license/*` call: URL, method, request body, response status and
 * response text. With the raw token in hand, `play-credentials-check.mjs
 * <key> --token <token>` can then ask Google DIRECTLY whether that token is
 * valid for `app.fivebudget` / `smart_entry_yearly` — which separates "the
 * token is bad" from "the Worker is misconfigured" without reading any log.
 *
 * Usage:
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node tools/play-capture.mjs install          # patch the live page
 *   # ... tap Subscribe in the app and finish the purchase ...
 *   node tools/play-capture.mjs dump             # fingerprints + server answer
 *   node tools/play-capture.mjs dump --raw       # also write the raw token to
 *                                                # /tmp/twa-forensics/<tag>/client-token.txt
 *   node tools/play-capture.mjs status           # is the patch still installed?
 *
 * The patch lives in the page's JS context: a real page RELOAD removes it. That
 * is why `install` must run AFTER the app is launched and BEFORE the purchase —
 * and why `status` exists.
 */
const ENDPOINT = process.env.DEVTOOLS_ENDPOINT || 'http://127.0.0.1:9222';
const OUT_DIR = process.env.FORENSICS_OUT || '/tmp/twa-forensics';
const TAG = process.env.TAG || 'playretry';

/** @param {string} expression */
async function evaluate(expression) {
  let targets;
  try {
    const res = await fetch(`${ENDPOINT}/json/list`);
    targets = await res.json();
  } catch (err) {
    console.error(`cannot reach the Chrome DevTools endpoint at ${ENDPOINT} (${err.message}).`);
    console.error('Is the phone on USB, and did you run:');
    console.error('  tools/adb/adb.sh forward tcp:9222 localabstract:chrome_devtools_remote');
    process.exit(1);
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('5budget.app'));
  if (!page) {
    console.error('no 5budget.app page target — launch the app first (the target only');
    console.error('exists while the app is running). targets:');
    console.error(targets.map((t) => `  ${t.type} ${t.url}`).join('\n'));
    process.exit(1);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('devtools timeout')), 15000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message ?? e.type}`)));
  });
  ws.close();
  if (reply.error) throw new Error(`devtools error: ${JSON.stringify(reply.error)}`);
  const err = reply.result?.exceptionDetails;
  if (err) throw new Error(`page threw: ${err.exception?.description ?? err.text}`);
  return reply.result?.result?.value;
}

const INSTALL = `(() => {
  if (window.__budgetPlayCapture) return JSON.stringify({ ok: true, already: true, entries: window.__budgetPlayCapture.entries.length });
  const cap = { installedAt: Date.now(), entries: [] };
  const summarize = (raw) => {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { return { raw }; }
    const out = { bodyKeys: Object.keys(parsed), productId: parsed.productId ?? null, hasIdToken: typeof parsed.idToken === 'string', idTokenLen: typeof parsed.idToken === 'string' ? parsed.idToken.length : 0 };
    if (typeof parsed.purchaseToken === 'string') {
      const t = parsed.purchaseToken;
      out.purchaseToken = {
        len: t.length,
        head: t.slice(0, 6),
        tail: t.slice(-4),
        whitespace: /\\s/.test(t),
        segments: t.split('.').length,
        charset: /^[A-Za-z0-9._-]+$/.test(t) ? 'url-safe' : 'other',
      };
      out.rawPurchaseToken = t;
    }
    return out;
  };
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    const body = init && typeof init.body === 'string' ? init.body : null;
    return orig.apply(this, arguments).then((res) => {
      if (url.indexOf('/api/license/') >= 0) {
        const entry = { at: new Date().toISOString(), url, method, request: body ? summarize(body) : null, status: res.status, responseText: '' };
        cap.entries.push(entry);
        res.clone().text().then((t) => { entry.responseText = t.slice(0, 1200); }).catch(() => {});
      }
      return res;
    }, (err) => {
      if (url.indexOf('/api/license/') >= 0) {
        cap.entries.push({ at: new Date().toISOString(), url, method, request: body ? summarize(body) : null, status: 0, error: String(err && err.message ? err.message : err) });
      }
      throw err;
    });
  };
  window.__budgetPlayCapture = cap;
  return JSON.stringify({ ok: true, already: false, url: location.href });
})()`;

const DUMP = `(() => {
  const cap = window.__budgetPlayCapture;
  if (!cap) return JSON.stringify({ installed: false, entries: [] });
  return JSON.stringify({ installed: true, installedAt: cap.installedAt, url: location.href, entries: cap.entries });
})()`;

const mode = process.argv[2] || 'status';
const raw = process.argv.includes('--raw');

if (mode === 'install') {
  console.log(await evaluate(INSTALL));
} else if (mode === 'status' || mode === 'dump') {
  const out = JSON.parse(String(await evaluate(DUMP)));
  if (!out.installed) {
    console.error('the capture patch is NOT installed in the live page (a reload removes it).');
    console.error('Run:  node tools/play-capture.mjs install   — then purchase.');
    process.exit(1);
  }
  const entries = out.entries ?? [];
  if (mode === 'status') {
    console.log(`patch installed at ${new Date(out.installedAt).toISOString()} on ${out.url}`);
    console.log(`captured ${entries.length} /api/license/* call(s)`);
    process.exit(0);
  }
  if (entries.length === 0) {
    console.error('patch is installed but no /api/license/* call has been captured yet.');
    process.exit(1);
  }
  for (const [i, e] of entries.entries()) {
    console.log(`\n--- [${i + 1}] ${e.at} ${e.method} ${e.url}`);
    console.log(`    status  ${e.status}${e.error ? `  error=${e.error}` : ''}`);
    const r = e.request;
    if (r) {
      console.log(`    body    keys=${JSON.stringify(r.bodyKeys)} productId=${r.productId} idToken=${r.hasIdToken ? `yes(${r.idTokenLen})` : 'NO'}`);
      if (r.purchaseToken) {
        const t = r.purchaseToken;
        console.log(`    token   len=${t.len} head=${t.head}… tail=…${t.tail} whitespace=${t.whitespace} segments=${t.segments} charset=${t.charset}`);
        const decoded = decodeTokenPayload(r.rawPurchaseToken);
        if (decoded) console.log(`    decoded ${decoded}`);
      }
    }
    if (e.responseText) console.log(`    reply   ${e.responseText}`);
  }
  const withToken = entries.filter((e) => e.request && e.request.rawPurchaseToken);
  if (raw && withToken.length) {
    const fs = await import('node:fs');
    const dir = `${OUT_DIR}/${TAG}`;
    fs.mkdirSync(dir, { recursive: true });
    const last = withToken[withToken.length - 1];
    const file = `${dir}/client-token.txt`;
    fs.writeFileSync(file, `${last.request.rawPurchaseToken}\n`);
    console.log(`\nraw token written to ${file} (NOT in the repo — a purchase token is bearer-like).`);
    console.log(`now ask Google directly:\n  node tools/play-credentials-check.mjs <play-key.json> --token "$(cat ${file})"`);
  } else if (withToken.length) {
    console.log('\n(pass --raw to write the last token to disk for a direct Google check)');
  }
} else {
  console.error('usage: node tools/play-capture.mjs {install|status|dump} [--raw]');
  process.exit(2);
}

/**
 * A Google Play purchase token is an opaque string, but subscription tokens
 * normally carry a base64 JSON payload naming the package and product they were
 * issued for — which is exactly what the hand-off asked to check. Anything
 * unexpected (whitespace, a different package) explains a 400 on its own.
 * @param {string} token
 * @returns {string} a one-line, human-readable summary, or '' if undecodable
 */
function decodeTokenPayload(token) {
  for (const part of [token, ...token.split('.')]) {
    for (const candidate of [part, part.replace(/-/g, '+').replace(/_/g, '/')]) {
      try {
        const pad = candidate + '='.repeat((4 - (candidate.length % 4)) % 4);
        const text = Buffer.from(pad, 'base64').toString('utf8');
        if (!text.includes('{')) continue;
        const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (json && typeof json === 'object') return JSON.stringify(json);
      } catch {
        /* not base64 JSON — keep trying */
      }
    }
  }
  return '';
}
