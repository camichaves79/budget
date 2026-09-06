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
 */
export async function signInWithGoogle(): Promise<'popup' | 'redirect' | 'cancelled' | 'failed'> {
  const auth = getFirebaseAuth();
  if (!auth) return 'failed';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    return 'popup';
  } catch (err) {
    const code = typeof (err as { code?: unknown }).code === 'string' ? (err as { code?: unknown }).code : '';
    if (code === 'auth/popup-closed-by-user') return 'cancelled';
    try {
      await signInWithRedirect(auth, new GoogleAuthProvider());
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
