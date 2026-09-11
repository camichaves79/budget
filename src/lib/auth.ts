/**
 * Firebase Auth (client). Google sign-in only for now; Apple arrives later
 * as a config-only change (needs a $99/yr Apple Developer account — see
 * ARCHITECTURE.md A13 and skills/paywall-ops.md).
 *
 * Everything is lazy: when the Firebase env vars are missing (unconfigured
 * build), every function degrades to a no-op/false instead of throwing, so
 * the rest of the app works normally without an identity provider.
 *
 * Flow note: popup first, redirect as fallback. Since June 2024 browsers
 * that block third-party storage break signInWithRedirect on non-Firebase
 * Hosting domains (GitHub Pages), so popup is the primary path; redirect
 * still completes where the blocking does not apply, and its result is
 * collected at boot via handleAuthRedirect().
 */

import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, getIdToken, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';

export interface AuthUser {
  uid: string;
  email: string | null;
  name: string | null;
}

let app: FirebaseApp | null | undefined;

function getAppLazy(): FirebaseApp | null {
  if (app !== undefined) return app;
  const apiKey = (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim();
  const authDomain = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim();
  const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  const appId = (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim();
  // Auth only needs apiKey + authDomain + projectId; appId is passed through
  // when present for future-proofing but is not required.
  if (!apiKey || !authDomain || !projectId) {
    app = null;
    return null;
  }
  // Guard: the web apiKey is a short AIza… token. A pasted service-account
  // JSON (a REAL secret — private key included) must never reach this bundle,
  // so anything that looks like JSON is treated as unconfigured.
  if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
    app = null;
    return null;
  }
  try {
    app = initializeApp({ apiKey, authDomain, projectId, ...(appId ? { appId } : {}) });
  } catch {
    app = null;
  }
  return app;
}

/** True when this build has Firebase credentials baked in. */
export function authConfigured(): boolean {
  return getAppLazy() !== null;
}

export function getFirebaseAuth(): Auth | null {
  const a = getAppLazy();
  return a ? getAuth(a) : null;
}

export function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return { uid: user.uid, email: user.email ?? null, name: user.displayName ?? null };
}

/**
 * Sign in with Google. Popup first — since June 2024, browsers that block
 * third-party storage (Safari 16.1+, Chrome 115+, Firefox 109+) break
 * signInWithRedirect on non-Firebase-Hosting domains like GitHub Pages, and
 * popup is Firebase's documented zero-server alternative. When the popup is
 * unavailable (blocked in the environment), we fall back to redirect; older
 * browsers and non-blocking setups still complete that path.
 *
 * `prompt: 'select_account'` is set deliberately: without it Chrome silently
 * reuses the account already signed into the browser, so a user with a second
 * Google account has no way to choose it and can end up licensed to the wrong
 * identity (the server email-authors licenses, and Play purchases additionally
 * require the purchaser email to match — see `play-email-mismatch` in
 * skills/paywall-ops.md). One extra tap on the account picker buys a choice we
 * cannot otherwise offer.
 */
function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInWithGoogle(): Promise<'popup' | 'redirect' | 'cancelled' | 'failed'> {
  const auth = getFirebaseAuth();
  if (!auth) return 'failed';
  try {
    await signInWithPopup(auth, googleProvider());
    return 'popup';
  } catch (err) {
    const code = typeof (err as { code?: unknown }).code === 'string' ? (err as { code?: unknown }).code : '';
    if (code === 'auth/popup-closed-by-user') return 'cancelled';
    try {
      await signInWithRedirect(auth, googleProvider());
      return 'redirect';
    } catch {
      return 'failed';
    }
  }
}

export async function signOutUser(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // Best-effort; the local session expires anyway.
  }
}

/** Subscribe to the signed-in user. Returns an unsubscribe function. */
export function watchAuthUser(callback: (user: AuthUser | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => callback(toAuthUser(user)));
}

/** A fresh Firebase ID token for the current user, or null. */
export async function getUserIdToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  if (!auth || !auth.currentUser) return null;
  try {
    return await getIdToken(auth.currentUser, true);
  } catch {
    return null;
  }
}

let redirectPromise: Promise<AuthUser | null> | null = null;

/**
 * Consume the result of a Google sign-in redirect. Memoized at module level
 * so React StrictMode's double effect (and the double getRedirectResult that
 * would follow) cannot lose or double-process the pending result.
 */
export function handleAuthRedirect(): Promise<AuthUser | null> {
  if (!redirectPromise) {
    redirectPromise = (async () => {
      const auth = getFirebaseAuth();
      if (!auth) return null;
      try {
        const result = await getRedirectResult(auth);
        return toAuthUser(result?.user ?? null);
      } catch {
        // A stale/absent pending redirect is normal; never surface it.
        return null;
      }
    })();
  }
  return redirectPromise;
}
