/**
 * Firebase Client SDK Initialization and Hardened Error Interceptors
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  signOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const env = (import.meta as any).env || {};

export const effectiveFirebaseConfig = {
  ...firebaseConfig,
  apiKey: env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  appId: env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  firestoreDatabaseId:
    env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    (firebaseConfig as any).firestoreDatabaseId ||
    'ai-studio-incomeallocation-3bc1b95e-b972-42e3-bbe2-a92535526c60',
  oAuthClientId:
    env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    (firebaseConfig as any).oAuthClientId ||
    '',
};

// Initialize Firebase App
export const app = initializeApp(effectiveFirebaseConfig);

// CRITICAL: Initialize Firestore with persistent IndexedDB offline cache using the exact configured database ID
// so signed-in users continue reading/writing their cloud data seamlessly when offline without falling back to local ledger.
function createPersistentFirestore() {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      effectiveFirebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, effectiveFirebaseConfig.firestoreDatabaseId);
  }
}

export const db = createPersistentFirestore();

// Initialize Firebase Authentication with durable local persistence
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore persistence fallback in restricted contexts
});

const PERSISTED_AUTH_USER_KEY = 'savenknow_authenticated_user_session';

export interface PersistedAuthSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export function getPersistedAuthUser(): User | null {
  if (auth.currentUser) return auth.currentUser;
  try {
    const raw = localStorage.getItem(PERSISTED_AUTH_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAuthSession;
    if (parsed && typeof parsed.uid === 'string' && parsed.uid.trim()) {
      return {
        uid: parsed.uid,
        email: parsed.email || null,
        displayName: parsed.displayName || null,
        photoURL: parsed.photoURL || null,
        emailVerified: true,
        isAnonymous: false,
        metadata: {},
        providerData: [],
        refreshToken: '',
        tenantId: null,
        delete: async () => {},
        getIdToken: async () => '',
        getIdTokenResult: async () => ({} as any),
        reload: async () => {},
        toJSON: () => parsed,
        phoneNumber: null,
        providerId: 'google.com',
      } as unknown as User;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function setPersistedAuthUser(user: User | null): void {
  try {
    if (!user || !user.uid) return;
    const payload: PersistedAuthSession = {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
    };
    localStorage.setItem(PERSISTED_AUTH_USER_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function clearPersistedAuthUser(): void {
  try {
    localStorage.removeItem(PERSISTED_AUTH_USER_KEY);
  } catch {
    // ignore storage errors
  }
}

// Validate connection to Firestore on boot (only when online)
async function testConnection() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Standard Google Sign-In scopes (email & profile only so production domains on Render do not fail restricted scope checks)
export const SCOPES = ['email', 'profile'];

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// In-memory token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const setAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

// Complete any pending OAuth redirect flow on boot
getRedirectResult(auth)
  .then((result) => {
    if (result) {
      if (result.user) {
        setPersistedAuthUser(result.user);
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
      }
    }
  })
  .catch((err) => {
    console.warn('Redirect sign-in check:', err);
  });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isFirestoreOffline(error: unknown): boolean {
  const errMsg = error instanceof Error ? error.message : String(error || '');
  const errCode = (error as any)?.code || '';
  const lowerMsg = errMsg.toLowerCase();
  return (
    lowerMsg.includes('offline') ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('failed-precondition') ||
    errCode === 'unavailable' ||
    errCode === 'failed-precondition'
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);

  if (isFirestoreOffline(error)) {
    console.warn(`[Firestore Offline / Network Issue] ${operationType} on ${path}: ${errMsg}`);
    throw error instanceof Error ? error : new Error(errMsg);
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface AuthDiagnosticInfo {
  code: string;
  title: string;
  summary: string;
  currentHostname: string;
  currentOrigin: string;
  projectId: string;
  authDomain: string;
  oAuthClientId: string;
  firebaseAuthSettingsUrl: string;
  gcpCredentialsUrl: string;
  requiredRedirectUris: string[];
  isUnauthorizedDomain: boolean;
}

export function getFirebaseAuthDiagnostic(error?: unknown): AuthDiagnosticInfo {
  const code = String((error as any)?.code || '');
  const msg = error instanceof Error ? error.message : String(error || '');
  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'your-app.onrender.com';
  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : `https://${currentHostname}`;
  const projectId = effectiveFirebaseConfig.projectId;
  const authDomain = effectiveFirebaseConfig.authDomain;
  const oAuthClientId = effectiveFirebaseConfig.oAuthClientId;

  const isUnauthorizedDomain =
    code === 'auth/unauthorized-domain' ||
    msg.toLowerCase().includes('unauthorized-domain') ||
    msg.toLowerCase().includes('domain is not authorized');

  const firebaseAuthSettingsUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
  const gcpCredentialsUrl = `https://console.cloud.google.com/apis/credentials?project=${projectId}`;
  const requiredRedirectUris = [
    `https://${authDomain}/__/auth/handler`,
    `${currentOrigin}/__/auth/handler`,
  ];

  if (isUnauthorizedDomain) {
    return {
      code: code || 'auth/unauthorized-domain',
      title: 'Authorize Render Domain in Firebase',
      summary: `Add "${currentHostname}" to Firebase Authentication Authorized Domains so Google Sign-In is permitted on Render.`,
      currentHostname,
      currentOrigin,
      projectId,
      authDomain,
      oAuthClientId,
      firebaseAuthSettingsUrl,
      gcpCredentialsUrl,
      requiredRedirectUris,
      isUnauthorizedDomain: true,
    };
  }

  return {
    code: code || 'auth/sign-in-check',
    title: 'Google Sign-In Configuration Check',
    summary:
      msg ||
      `Verify "${currentHostname}" is listed in Firebase Authorized Domains and OAuth Redirect URIs.`,
    currentHostname,
    currentOrigin,
    projectId,
    authDomain,
    oAuthClientId,
    firebaseAuthSettingsUrl,
    gcpCredentialsUrl,
    requiredRedirectUris,
    isUnauthorizedDomain: false,
  };
}

export async function loginWithGoogle(
  preferRedirect = false
): Promise<{ user: User | null; accessToken: string | null }> {
  try {
    if (preferRedirect) {
      await signInWithRedirect(auth, googleProvider);
      return { user: null, accessToken: null };
    }

    const result = await signInWithPopup(auth, googleProvider);
    if (result.user) {
      setPersistedAuthUser(result.user);
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    const code = String(error?.code || '');
    // Automatic fallback to redirect if the browser blocked the popup window
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, googleProvider);
      return { user: null, accessToken: null };
    }
    console.error('Google Sign In failed:', error);
    throw error;
  }
}

export async function logoutUser(): Promise<void> {
  clearPersistedAuthUser();
  await signOut(auth);
  cachedAccessToken = null;
}

export function onAuthStateChanged(
  authInstance: typeof auth,
  callback: (user: User | null) => void
) {
  return firebaseOnAuthStateChanged(authInstance, (currentUser) => {
    if (currentUser) {
      setPersistedAuthUser(currentUser);
      callback(currentUser);
      return;
    }
    // If a signed-in session was persisted (and user did not sign out), preserve their logged-in session
    // even when offline or while Firebase Auth is rehydrating.
    const persisted = getPersistedAuthUser();
    if (persisted) {
      callback(persisted);
      return;
    }
    callback(null);
  });
}

export type { User };
