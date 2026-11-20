/**
 * PWA & Android Biometric Authentication Utility (WebAuthn Platform Authenticator)
 *
 * Leverages Android BiometricPrompt (Fingerprint / Face Unlock / Device Credential),
 * iOS Face ID / Touch ID, and desktop platform authenticators via WebAuthn,
 * with backend challenge/verification endpoints and full offline PWA support
 * plus optional salted SHA-256 backup passcode fallback.
 */

const BIOMETRIC_STORAGE_KEY = 'snk_biometric_lock_v1';

export interface BiometricDeviceState {
  enabled: boolean;
  lockOnResume: boolean;
  credentialId?: string; // Base64URL WebAuthn credential ID bound to this device
  enrolledAt?: string;
  passcodeHash?: string; // Optional salted SHA-256 hash of backup 4-6 digit passcode
  passcodeSalt?: string;
}

export interface BiometricSupportInfo {
  webAuthnSupported: boolean;
  platformAvailable: boolean;
  isAndroid: boolean;
  isStandalonePwa: boolean;
  isSecureContext: boolean;
  isInIframe: boolean;
}

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function generateLocalChallenge(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bufferToBase64Url(bytes);
}

async function fetchBiometricChallenge(action: 'register' | 'verify'): Promise<string> {
  try {
    const resp = await fetch('/api/security/biometric/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.success && typeof data?.challenge === 'string' && data.challenge.length >= 16) {
        return data.challenge;
      }
    }
  } catch {
    // Offline PWA fallback uses local CSPRNG challenge
  }
  return generateLocalChallenge();
}

export function getBiometricDeviceState(): BiometricDeviceState {
  try {
    const raw = localStorage.getItem(BIOMETRIC_STORAGE_KEY);
    if (!raw) {
      return { enabled: false, lockOnResume: true };
    }
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      lockOnResume: parsed?.lockOnResume !== false,
      credentialId: typeof parsed?.credentialId === 'string' ? parsed.credentialId : undefined,
      enrolledAt: typeof parsed?.enrolledAt === 'string' ? parsed.enrolledAt : undefined,
      passcodeHash: typeof parsed?.passcodeHash === 'string' ? parsed.passcodeHash : undefined,
      passcodeSalt: typeof parsed?.passcodeSalt === 'string' ? parsed.passcodeSalt : undefined,
    };
  } catch {
    return { enabled: false, lockOnResume: true };
  }
}

export function saveBiometricDeviceState(
  patch: Partial<BiometricDeviceState>
): BiometricDeviceState {
  const current = getBiometricDeviceState();
  const next: BiometricDeviceState = {
    ...current,
    ...patch,
  };
  try {
    localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota issues
  }
  return next;
}

export function shouldStartAppLocked(): boolean {
  const state = getBiometricDeviceState();
  return Boolean(state.enabled && (state.credentialId || state.passcodeHash));
}

export async function checkBiometricSupport(): Promise<BiometricSupportInfo> {
  const isSecure = typeof window !== 'undefined' && Boolean(window.isSecureContext);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isAndroid = /android/.test(ua);
  const isStandalonePwa =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as unknown as { standalone?: boolean })?.standalone === true);

  let isInIframe = false;
  try {
    isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    isInIframe = true;
  }

  const webAuthnSupported =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get);

  let platformAvailable = false;
  if (webAuthnSupported && isSecure) {
    try {
      if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        platformAvailable =
          await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch {
      platformAvailable = false;
    }
  }

  return {
    webAuthnSupported,
    platformAvailable,
    isAndroid,
    isStandalonePwa,
    isSecureContext: isSecure,
    isInIframe,
  };
}

/**
 * Enrolls the device's native platform biometric authenticator (Android BiometricPrompt,
 * iOS Face ID / Touch ID, Windows Hello, macOS Touch ID) via WebAuthn.
 */
export async function enrollPlatformBiometric(
  userLabel: string,
  userId: string
): Promise<{ success: boolean; credentialId?: string; error?: string; blockedByEnvironment?: boolean }> {
  const support = await checkBiometricSupport();
  if (!support.webAuthnSupported || !support.isSecureContext) {
    return {
      success: false,
      blockedByEnvironment: true,
      error: 'Device biometrics are unavailable in this browser. You can set a backup passcode instead.',
    };
  }

  try {
    const challengeB64 = await fetchBiometricChallenge('register');
    const challengeBytes = base64UrlToUint8Array(challengeB64);
    const cleanUserId = (userId || 'snk_user').slice(0, 48);
    const userIdBytes = new TextEncoder().encode(cleanUserId);
    const cleanName = (userLabel || 'Save N Know User').slice(0, 64);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challengeBytes.buffer as ArrayBuffer,
        rp: {
          name: 'Save N Know',
          id: window.location.hostname,
        },
        user: {
          id: userIdBytes.buffer as ArrayBuffer,
          name: cleanName,
          displayName: cleanName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (Android Keystore / Apple Secure Enclave)
          { type: 'public-key', alg: -257 }, // RS256 fallback
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      return {
        success: false,
        error: 'Biometric setup was not completed. Please try again.',
      };
    }

    const credentialId = bufferToBase64Url(credential.rawId);
    saveBiometricDeviceState({
      enabled: true,
      credentialId,
      enrolledAt: new Date().toISOString(),
    });

    return { success: true, credentialId };
  } catch (err: any) {
    const name = String(err?.name || '');
    const msg = String(err?.message || '');
    if (name === 'NotAllowedError') {
      if (
        msg.toLowerCase().includes('publickey-credentials-create') ||
        msg.toLowerCase().includes('permissions policy') ||
        msg.toLowerCase().includes('iframe')
      ) {
        return {
          success: false,
          blockedByEnvironment: true,
          error:
            'Biometrics are restricted inside embedded preview frames. Install or open the PWA directly on your device, or set a backup passcode below.',
        };
      }
      return {
        success: false,
        error: 'Biometric verification was cancelled or timed out.',
      };
    }
    if (name === 'SecurityError' || name === 'NotSupportedError') {
      return {
        success: false,
        blockedByEnvironment: true,
        error:
          'Native biometric sensor is not available on this browser context. Set a backup passcode to lock the app.',
      };
    }
    return {
      success: false,
      error: msg || 'Unable to enable biometric authentication.',
    };
  }
}

/**
 * Prompts Android BiometricPrompt / native device biometrics to unlock the app.
 */
export async function verifyPlatformBiometric(): Promise<{
  success: boolean;
  error?: string;
}> {
  const state = getBiometricDeviceState();
  if (!state.credentialId) {
    return {
      success: false,
      error: 'No biometric credential found on this device.',
    };
  }

  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined' ||
    !navigator.credentials?.get
  ) {
    return {
      success: false,
      error: 'Biometric authentication is not supported on this device.',
    };
  }

  try {
    const challengeB64 = await fetchBiometricChallenge('verify');
    const challengeBytes = base64UrlToUint8Array(challengeB64);
    const credIdBytes = base64UrlToUint8Array(state.credentialId);

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes.buffer as ArrayBuffer,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: credIdBytes.buffer as ArrayBuffer,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion || !assertion.response) {
      return { success: false, error: 'Verification failed. Try again.' };
    }

    const authResponse = assertion.response as AuthenticatorAssertionResponse;
    const clientDataB64 = bufferToBase64Url(authResponse.clientDataJSON);
    const authDataB64 = bufferToBase64Url(authResponse.authenticatorData);
    const signatureB64 = bufferToBase64Url(authResponse.signature);
    const returnedCredId = bufferToBase64Url(assertion.rawId);

    // Local cryptographic structure verification (works offline in PWA)
    const decodedClientData = JSON.parse(
      new TextDecoder().decode(authResponse.clientDataJSON)
    );
    const authDataBytes = new Uint8Array(authResponse.authenticatorData);
    const flags = authDataBytes.length > 32 ? authDataBytes[32] : 0;
    const userPresent = (flags & 0x01) !== 0;
    const userVerified = (flags & 0x04) !== 0;

    if (
      decodedClientData?.type !== 'webauthn.get' ||
      decodedClientData?.challenge !== challengeB64 ||
      !userPresent ||
      !userVerified
    ) {
      return {
        success: false,
        error: 'Biometric verification could not be confirmed.',
      };
    }

    // Backend assertion verification (non-blocking offline fallback)
    if (typeof navigator === 'undefined' || navigator.onLine) {
      try {
        const resp = await fetch('/api/security/biometric/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentialId: returnedCredId,
            expectedChallenge: challengeB64,
            clientDataJSON: clientDataB64,
            authenticatorData: authDataB64,
            signature: signatureB64,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.success === false) {
            return {
              success: false,
              error: data?.error || 'Backend biometric verification failed.',
            };
          }
        }
      } catch {
        // Offline PWA: local verification already passed
      }
    }

    return { success: true };
  } catch (err: any) {
    const name = String(err?.name || '');
    if (name === 'NotAllowedError') {
      return {
        success: false,
        error: 'Biometric check was cancelled. Tap below to try again.',
      };
    }
    return {
      success: false,
      error: err?.message || 'Unable to verify biometrics. Try again.',
    };
  }
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic fallback hash if subtle crypto unavailable
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export async function setBackupPasscode(pin: string): Promise<boolean> {
  const clean = pin.replace(/\D/g, '');
  if (clean.length < 4 || clean.length > 6) return false;
  const salt = generateLocalChallenge().slice(0, 16);
  const hash = await sha256Hex(`${salt}:${clean}`);
  saveBiometricDeviceState({
    passcodeSalt: salt,
    passcodeHash: hash,
  });
  return true;
}

export async function verifyBackupPasscode(pin: string): Promise<boolean> {
  const state = getBiometricDeviceState();
  if (!state.passcodeHash || !state.passcodeSalt) return false;
  const clean = pin.replace(/\D/g, '');
  const hash = await sha256Hex(`${state.passcodeSalt}:${clean}`);
  return hash === state.passcodeHash;
}

export function clearBackupPasscode(): void {
  saveBiometricDeviceState({
    passcodeHash: undefined,
    passcodeSalt: undefined,
  });
}

export function disableBiometricDeviceLock(): void {
  saveBiometricDeviceState({
    enabled: false,
  });
}
