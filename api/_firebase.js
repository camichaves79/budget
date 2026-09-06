/**
 * firebase-admin (server-side only) for the license/ledger functions.
 *
 * Initialized from the FIREBASE_SERVICE_ACCOUNT env var (service-account
 * JSON, single line) — required for Firestore writes. verifyIdToken works
 * with only a projectId (public JWKS), but we keep one code path: the
 * service account drives both Firestore and token verification.
 *
 * The client never talks to Firestore: rules are locked down and all reads
 * and writes go through these Vercel functions (ARCHITECTURE.md A13).
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let booted = false;
let firestore = /** @type {ReturnType<typeof getFirestore> | null} */ (null);
let authAdmin = /** @type {ReturnType<typeof getAuth> | null} */ (null);
let serviceAccountReady = false;

function boot() {
  if (booted) return;
  booted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
  const projectId = (process.env.FIREBASE_PROJECT_ID ?? '').trim();
  let credential = null;
  if (raw) {
    try {
      credential = cert(JSON.parse(raw));
      serviceAccountReady = true;
    } catch (err) {
      console.error('firebase service account invalid', /** @type {Error} */ (err).message);
    }
  }

  if (getApps().length === 0) {
    try {
      initializeApp({ ...(credential ? { credential } : {}), ...(projectId ? { projectId } : {}) });
    } catch (err) {
      console.error('firebase init failed', /** @type {Error} */ (err).message);
    }
  }

  try {
    firestore = getFirestore();
    authAdmin = getAuth();
  } catch (err) {
    console.error('firebase services unavailable', /** @type {Error} */ (err).message);
  }
}

/** Firestore handle, or null when the service account is missing/invalid. */
export function db() {
  boot();
  return serviceAccountReady ? firestore : null;
}

/** Auth handle for verifyIdToken; usable with only a projectId configured. */
export function adminAuth() {
  boot();
  return authAdmin;
}

/**
 * Verify a Firebase ID token. Never throws.
 * @param {string | null | undefined} idToken
 * @returns {Promise<{ ok: true, uid: string, email: string | null } | { ok: false }>}
 */
export async function verifyIdTokenSafe(idToken) {
  if (!idToken) return { ok: false };
  const auth = adminAuth();
  if (!auth) return { ok: false };
  try {
    const decoded = await auth.verifyIdToken(idToken);
    return { ok: true, uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email : null };
  } catch {
    return { ok: false };
  }
}

/**
 * Resolve a uid from a buyer email — lets a webhook bind a sale to a
 * signed-in user without any client round-trip. Never throws.
 * @param {string} email
 * @returns {Promise<{ uid: string } | null>}
 */
export async function getUserByEmailSafe(email) {
  const auth = adminAuth();
  if (!auth || !email) return null;
  try {
    const user = await auth.getUserByEmail(email);
    return { uid: user.uid };
  } catch {
    return null;
  }
}
