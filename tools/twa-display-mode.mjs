/**
 * Read `display-mode` (and friends) from the live page inside the Play-installed
 * TWA, over the Chrome DevTools protocol.
 *
 * Why: cause 3 of `getDigitalGoodsService()`'s `unsupported context` is
 * `CustomTabActivity#isInTwaMode()` being false, and the app's own support-mode
 * dump is the only other way to see it — which costs an arm/relaunch cycle and
 * is read once per JS session. Evaluating in the real page is immediate and
 * authoritative, and it works for a release (non-debuggable) TWA because Chrome
 * is the debuggable process, not the app.
 *
 * Usage:
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   node tools/twa-display-mode.mjs
 */
const ENDPOINT = process.env.DEVTOOLS_ENDPOINT || 'http://127.0.0.1:9222';

const EXPR = `(() => {
  const modes = ['standalone','minimal-ui','fullscreen','browser','window-controls-overlay'];
  const matched = modes.filter(m => window.matchMedia('(display-mode: ' + m + ')').matches);
  return JSON.stringify({
    url: location.href,
    search: location.search,
    matched,
    standalone: window.navigator.standalone === true,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    screenHeight: window.screen.height,
    screenWidth: window.screen.width,
    chromePx: Math.max(0, Math.round(window.screen.height - window.innerHeight)),
    userAgent: navigator.userAgent,
  });
})()`;

const res = await fetch(`${ENDPOINT}/json/list`);
const targets = await res.json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('5budget.app'));
if (!page) {
  console.error('no 5budget.app page target — launch the app first');
  console.error('targets:', targets.map((t) => `${t.type} ${t.url}`).join(', '));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const reply = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('devtools timeout')), 10000);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: EXPR, returnByValue: true } }));
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

if (reply.error) {
  console.error('devtools error:', JSON.stringify(reply.error));
  process.exit(1);
}
const value = reply.result?.result?.value;
if (typeof value !== 'string') {
  console.error('unexpected result:', JSON.stringify(reply.result));
  process.exit(1);
}

const d = JSON.parse(value);
console.log(`url          ${d.url}`);
console.log(`display-mode ${d.matched.length ? d.matched.join(' + ') : '(none)'}`);
console.log(`standalone   ${d.standalone ? 'yes' : 'no'}`);
console.log(`viewport     inner ${d.innerHeight} / screen ${d.screenHeight} / chrome≈${d.chromePx}px`);
console.log(`ua           ${d.userAgent}`);
console.log('');
const isBrowser = d.matched.includes('browser');
console.log(
  isBrowser
    ? 'VERDICT: display-mode includes "browser" -> a Custom Tab, app mode is OFF'
    : d.chromePx <= 160
      ? 'VERDICT: no "browser" mode and almost no browser chrome -> TWA app mode looks ON'
      : `VERDICT: no "browser" mode but chrome≈${d.chromePx}px -> a toolbar is still present`,
);
