/**
 * Firebase (server-side) via the REST APIs — ZERO npm dependencies.
 *
 * Replaces firebase-admin: Vercel's zero-config dependency tracing silently
 * dropped firebase-admin from the function bundles ("Cannot find package
 * 'firebase-admin' imported from /var/task/api/…"), so this module hand-rolls
 * the three pieces we actually use, with node:crypto only:
 *
 *   - OAuth access token from the service account (RS256 JWT grant), cached.
 *   - Firestore REST (get doc, merge-set doc, list collection).
 *   - Firebase ID-token verification (Google's securetoken JWKS, RS256).
 *   - accounts:lookup (email → uid) for the webhook self-heal path.
 *
 * API surface mirrors what the endpoints used before:
 *   db().collection(c).doc(id).set(data)      → merge-write
 *   db().collection(c).doc(id).get()          → { exists, data() }
 *   db().collection(c).get()                  → { docs: [{ data() }] }
 *   verifyIdTokenSafe(idToken)                → { ok, uid, email }
 *   getUserByEmailSafe(email)                 → { uid } | null
 *
 * Plain JS with JSDoc (tsconfig.node checkJs), smoke-tested pure helpers.
 */

import { createSign, createVerify, createPublicKey } from 'node:crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const SECURETOKEN_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ID_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/v1';
const SCOPES = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit';

/* ---------- service account ---------- */

let serviceAccount = /** @type {{ client_email: string, private_key: string, project_id: string } | null} */ (null);
let serviceAccountLoaded = false;

/** @returns {{ client_email: string, private_key: string, project_id: string } | null} */
function getServiceAccount() {
  if (serviceAccountLoaded) return serviceAccount;
  serviceAccountLoaded = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
  if (!raw) {
    console.error('firebase: FIREBASE_SERVICE_ACCOUNT missing');
    return null;
  }
  try {
    const sa = JSON.parse(raw);
    if (typeof sa.client_email === 'string' && typeof sa.private_key === 'string' && typeof sa.project_id === 'string') {
      serviceAccount = /** @type {{ client_email: string, private_key: string, project_id: string }} */ (sa);
      return serviceAccount;
    }
  } catch (err) {
    console.error('firebase: service account JSON invalid', /** @type {Error} */ (err).message);
  }
  console.error('firebase: service account fields missing');
  return null;
}

function projectId() {
  const env = (process.env.FIREBASE_PROJECT_ID ?? '').trim();
  if (env) return env;
  return getServiceAccount()?.project_id ?? '';
}

/* ---------- OAuth access token (cached) ---------- */

let tokenCache = { token: '', expiresAt: 0 };

/**
 * Build + sign an RS256 JWT (exported for smoke tests).
 * @param {Record<string, unknown>} claims
 * @param {string} privateKeyPem
 */
export function signJwt(claims, privateKeyPem) {
  /** @param {unknown} o */
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKeyPem).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** @returns {Promise<string | null>} */
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const sa = getServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    { iss: sa.client_email, scope: SCOPES, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600 },
    sa.private_key,
  );
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      console.error('firebase: token endpoint', res.status);
      return null;
    }
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    const token = payload && typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!token || !payload) return null;
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  } catch {
    return null;
  }
}

/* ---------- Firestore REST ---------- */

/** @param {string} path @returns {string} full document resource name */
function docName(path) {
  const encoded = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `projects/${projectId()}/databases/(default)/documents/${encoded}`;
}

/** @param {string} collection */
function collectionName(collection) {
  return `projects/${projectId()}/databases/(default)/documents/${encodeURIComponent(collection)}`;
}

/**
 * Convert a plain object to Firestore field values (scalars only — the
 * ledger/entitlement/license docs never store arrays or maps).
 * @param {Record<string, unknown>} obj
 */
export function toFields(obj) {
  /** @type {Record<string, unknown>} */
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) fields[key] = { nullValue: null };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') {
      if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
      else fields[key] = { doubleValue: value };
    } else fields[key] = { stringValue: String(value) };
  }
  return fields;
}

/**
 * Convert Firestore field values back to a plain object.
 * @param {unknown} fields
 */
export function fromFields(fields) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (fields))) {
    const v = /** @type {Record<string, unknown>} */ (value);
    if ('nullValue' in v) out[key] = null;
    else if ('booleanValue' in v) out[key] = v.booleanValue === true;
    else if ('integerValue' in v) out[key] = Number(v.integerValue);
    else if ('doubleValue' in v) out[key] = Number(v.doubleValue);
    else if ('stringValue' in v) out[key] = String(v.stringValue);
  }
  return out;
}

/**
 * Set a document with MERGE semantics (create if missing, patch fields if
 * present) via the commit REST API.
 * @param {string} path e.g. "sales/order-id"
 * @param {Record<string, unknown>} data
 */
async function setDocMerge(path, data) {
  const token = await getAccessToken();
  if (!token) return;
  const name = docName(path);
  const fields = toFields(data);
  const fieldPaths = Object.keys(data);

  const commit = async (/** @type {unknown} */ writes) => {
    const res = await fetch(`${FIRESTORE_BASE}/projects/${projectId()}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
    });
    return /** @type {Promise<{ error?: { status?: string, message?: string }, writeResults?: unknown }>} */ (res.json());
  };

  // Update-with-mask (merge). When the document doesn't exist yet, Firestore
  // answers NOT_FOUND → retry as create. A rare concurrent create answers
  // ALREADY_EXISTS → retry as update once more.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const write = attempt === 1 ? { create: { name, fields } } : { update: { name, fields, updateMask: { fieldPaths } } };
    /** @type {{ error?: { status?: string, message?: string }, writeResults?: unknown }} */
    let payload;
    try {
      payload = await commit([write]);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const status = payload.error?.status;
    if (!status) return;
    if (attempt === 0 && status === 'NOT_FOUND') continue; // → create
    if (attempt === 1 && status === 'ALREADY_EXISTS') continue; // → update
    console.error('firebase: commit failed', status, payload.error?.message ?? '');
    return;
  }
}

/**
 * Read a document.
 * @param {string} path @returns {Promise<Record<string, unknown> | null>}
 */
async function getDoc(path) {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${FIRESTORE_BASE}/${docName(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    return fromFields(payload?.fields);
  } catch {
    return null;
  }
}

/**
 * List every document in a collection (follows nextPageToken — the ledger
 * export must not silently drop rows).
 * @param {string} collection @returns {Promise<Array<Record<string, unknown>>>}
 */
async function listDocs(collection) {
  const token = await getAccessToken();
  if (!token) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  let pageToken = '';
  try {
    for (;;) {
      const url = `${FIRESTORE_BASE}/${collectionName(collection)}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return out;
      const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
      const docs = Array.isArray(payload?.documents) ? /** @type {unknown[]} */ (payload.documents) : [];
      for (const doc of docs) {
        const docObj = doc && typeof doc === 'object' ? /** @type {Record<string, unknown>} */ (doc) : {};
        out.push(fromFields(docObj.fields));
      }
      const next = typeof payload?.nextPageToken === 'string' && payload.nextPageToken !== '' ? payload.nextPageToken : null;
      if (next) {
        pageToken = next;
        continue;
      }
      return out;
    }
  } catch {
    return out;
  }
}

/* ---------- Firebase ID-token verification (JWKS) ---------- */

let jwksCache = { keys: /** @type {Array<{ kid?: string, n?: string, e?: string }>} */ ([]), expiresAt: 0 };

/** @returns {Promise<Array<{ kid?: string, n?: string, e?: string }>>} */
async function getSecureTokenJwks() {
  if (jwksCache.keys.length > 0 && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  try {
    const res = await fetch(SECURETOKEN_JWKS);
    if (!res.ok) return jwksCache.keys;
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    const keys = Array.isArray(payload?.keys)
      ? /** @type {Array<{ kid?: string, n?: string, e?: string }>} */ (payload.keys)
      : [];
    jwksCache = { keys, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return keys;
  } catch {
    return jwksCache.keys;
  }
}

/** @param {string} s */
function base64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

/**
 * @param {string} token
 * @returns {{ header: Record<string, unknown>, payload: Record<string, unknown> } | null}
 */
export function decodeJwtParts(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * Verify a Firebase ID token (signature via Google's securetoken JWKS, then
 * aud/iss/exp claims). Never throws.
 * @param {string | null | undefined} idToken
 * @returns {Promise<{ ok: true, uid: string, email: string | null } | { ok: false }>}
 */
export async function verifyIdTokenSafe(idToken) {
  if (!idToken) return { ok: false };
  const pid = projectId();
  if (!pid) return { ok: false };
  const parts = idToken.split('.');
  const decoded = decodeJwtParts(idToken);
  if (!decoded || parts.length !== 3) return { ok: false };
  const { header, payload } = decoded;

  const kid = typeof header.kid === 'string' ? header.kid : '';
  const jwks = await getSecureTokenJwks();
  const jwk = jwks.find((k) => k.kid === kid);
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return { ok: false };

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlDecode(parts[2]), data);
    if (!valid) return { ok: false };
  } catch {
    return { ok: false };
  }

  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (aud !== pid || iss !== `https://securetoken.google.com/${pid}`) return { ok: false };
  if (exp * 1000 <= Date.now()) return { ok: false };
  const uid = typeof payload.sub === 'string' ? payload.sub : typeof payload.user_id === 'string' ? payload.user_id : '';
  if (!uid) return { ok: false };
  const email = typeof payload.email === 'string' ? payload.email : null;
  return { ok: true, uid, email };
}

/**
 * Resolve a uid from a buyer email via Identity Toolkit's accounts:lookup
 * (lets the webhook bind a sale without a client round-trip). Returns null on
 * any failure — the redeem/lookup endpoints still bind via idToken.
 * @param {string} email
 * @returns {Promise<{ uid: string } | null>}
 */
export async function getUserByEmailSafe(email) {
  if (!email) return null;
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${ID_TOOLKIT_BASE}/projects/${projectId()}/accounts:lookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    });
    if (!res.ok) return null;
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    const users = Array.isArray(payload?.users) ? /** @type {unknown[]} */ (payload.users) : [];
    const first = /** @type {Record<string, unknown> | null} */ (users[0] ?? null);
    const localId = first && typeof first.localId === 'string' ? first.localId : '';
    return localId ? { uid: localId } : null;
  } catch {
    return null;
  }
}

/* ---------- adapter mirroring the firebase-admin calls used ---------- */

/**
 * Firestore adapter, or null when the service account is missing.
 */
export function db() {
  if (!getServiceAccount()) return null;
  return {
    collection(/** @type {string} */ name) {
      return {
        doc(/** @type {string} */ id) {
          return {
            /**
             * Merge-write (create if missing, patch fields if present).
             * @param {Record<string, unknown>} data
             * @param {unknown} [_options] ignored — merge semantics are built in
             */
            async set(data, _options) {
              await setDocMerge(`${name}/${id}`, data);
            },
            async get() {
              const found = await getDoc(`${name}/${id}`);
              return { exists: found !== null, data: () => found ?? undefined };
            },
          };
        },
        async get() {
          const rows = await listDocs(name);
          return { docs: rows.map((data) => ({ data: () => data })) };
        },
      };
    },
  };
}

/* ---------- exported pure helper (smoke tests) ---------- */

/**
 * Verify an RS256 signature over a JWT signing input (test-only helper).
 * @param {string} signingInput
 * @param {string} signatureBase64url
 * @param {string} publicKeyPem
 */
export function verifyJwtSignature(signingInput, signatureBase64url, publicKeyPem) {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    return verifier.verify(createPublicKey(publicKeyPem), Buffer.from(signatureBase64url, 'base64url'));
  } catch {
    return false;
  }
}
