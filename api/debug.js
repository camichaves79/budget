/**
 * TEMPORARY diagnostic endpoint — probe the Vercel runtime for the license
 * functions. DELETE after the firebase-admin import issue is resolved.
 *
 * @param {import('node:http').IncomingMessage} _req
 * @param {import('node:http').ServerResponse} res
 */
export default async function handler(_req, res) {
  /** @type {Record<string, unknown>} */
  const out = {
    node: process.version,
    envNames: Object.keys(process.env)
      .filter((k) => ['FIREBASE', 'LEMON', 'BUDGET', 'GEMINI'].some((p) => k.startsWith(p)))
      .map((k) => (k.startsWith('FIREBASE_SERVICE') ? `${k}=(len ${(process.env[k] ?? '').length})` : `${k}=(set)`))
      .sort(),
  };
  /** @type {Record<string, string>} */
  const checks = {};
  for (const spec of ['firebase-admin/app', 'firebase-admin/auth', 'firebase-admin/firestore']) {
    try {
      await import(spec);
      checks[spec] = 'ok';
    } catch (err) {
      checks[spec] = `FAIL: ${/** @type {Error} */ (err).message}`;
    }
  }
  try {
    const fs = await import('node:fs/promises');
    const pkg = JSON.parse(await fs.readFile('node_modules/firebase-admin/package.json', 'utf8'));
    checks['firebase-admin version on disk'] = String(pkg.version);
  } catch (err) {
    checks['firebase-admin version on disk'] = `MISSING: ${/** @type {Error} */ (err).message}`;
  }
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ out, checks }, null, 2));
}
