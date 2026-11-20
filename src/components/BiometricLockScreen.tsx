import React, { useState, useEffect, useRef } from 'react';
import {
  getBiometricDeviceState,
  verifyPlatformBiometric,
  verifyBackupPasscode,
} from '../lib/biometricAuth.ts';

interface BiometricLockScreenProps {
  onUnlocked: () => void;
  userDisplayName?: string;
}

export const BiometricLockScreen: React.FC<BiometricLockScreenProps> = ({
  onUnlocked,
  userDisplayName,
}) => {
  const deviceState = getBiometricDeviceState();
  const hasBiometric = Boolean(deviceState.credentialId);
  const hasPasscode = Boolean(deviceState.passcodeHash);

  const [mode, setMode] = useState<'biometric' | 'passcode'>(
    hasBiometric ? 'biometric' : 'passcode'
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const autoPromptTriggeredRef = useRef(false);

  const handleBiometricUnlock = async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorMsg(null);
    try {
      const result = await verifyPlatformBiometric();
      if (result.success) {
        onUnlocked();
      } else {
        setErrorMsg(result.error || 'Verification cancelled. Try again.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    if (hasBiometric && !autoPromptTriggeredRef.current) {
      autoPromptTriggeredRef.current = true;
      const timer = window.setTimeout(() => {
        handleBiometricUnlock();
      }, 180);
      return () => window.clearTimeout(timer);
    }
  }, [hasBiometric]);

  const handlePasscodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pinInput.replace(/\D/g, '');
    if (cleanPin.length < 4 || isVerifying) return;
    setIsVerifying(true);
    setErrorMsg(null);
    try {
      const valid = await verifyBackupPasscode(cleanPin);
      if (valid) {
        setPinInput('');
        onUnlocked();
      } else {
        setErrorMsg('Incorrect passcode. Try again.');
        setPinInput('');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50 px-4 py-8 text-slate-900">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-lg space-y-6 text-center">
        {/* Shield / Fingerprint Emblem */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
          <svg
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
            />
          </svg>
        </div>

        <div className="space-y-1">
          <h1 className="font-display text-lg font-semibold text-slate-900">
            Save N Know
          </h1>
          <p className="text-xs text-slate-500">
            {userDisplayName
              ? `Locked for ${userDisplayName}. Verify your identity to continue.`
              : 'Verify your identity to access your ledger.'}
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {errorMsg}
          </div>
        )}

        {mode === 'biometric' && hasBiometric ? (
          <div className="space-y-3">
            <button
              type="button"
              disabled={isVerifying}
              onClick={handleBiometricUnlock}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {isVerifying ? 'Waiting for biometric check...' : 'Unlock with Biometrics'}
            </button>

            {hasPasscode && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setMode('passcode');
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Use Backup Passcode
              </button>
            )}
          </div>
        ) : hasPasscode ? (
          <form onSubmit={handlePasscodeSubmit} className="space-y-3 text-left">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5 text-center">
                Enter Passcode
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-center font-mono text-base tracking-[0.4em] text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || pinInput.length < 4}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {isVerifying ? 'Verifying...' : 'Unlock'}
            </button>

            {hasBiometric && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setMode('biometric');
                  handleBiometricUnlock();
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Use Biometrics Instead
              </button>
            )}
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Biometric credentials are not enrolled on this device.
            </p>
            <button
              type="button"
              onClick={onUnlocked}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              Continue to App
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
