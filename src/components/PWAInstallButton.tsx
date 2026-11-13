import React, { useState } from 'react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'header',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Hide when already running as an installed standalone PWA
  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuideModal(true);
  };

  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleAction}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] sm:text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer shrink-0"
          title="Install Save N Know on your phone"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0 text-emerald-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Install App</span>
        </button>
      ) : (
        <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/70 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900">
                Install on Android / Phone
              </div>
              <div className="text-[11px] text-slate-600">
                Add Save N Know to your home screen
              </div>
            </div>
            <span className="rounded-md bg-emerald-600 px-2 py-0.5 font-mono text-[10px] font-bold text-white shrink-0">
              PWA
            </span>
          </div>

          <button
            type="button"
            onClick={handleAction}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            <span>{isInstallable ? 'Install Now' : 'How to Install on Phone'}</span>
          </button>
        </div>
      )}

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-md max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Install Save N Know on Your Phone
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Run full-screen from your home screen with offline caching.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {/* Step 1: Android Instructions */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 space-y-2 text-xs">
              <div className="font-bold text-emerald-900">
                Android (Chrome / Edge / Samsung Internet)
              </div>
              <ol className="list-decimal pl-4 space-y-1.5 text-slate-700">
                <li>
                  Open this app link directly in <strong>Google Chrome</strong> on your Android phone.
                </li>
                <li>
                  Tap the <strong>Install App</strong> button in the top bar, or tap the browser&apos;s top-right <strong>⋮ (Three Dots)</strong> menu.
                </li>
                <li>
                  Select <strong>Add to Home screen</strong> or <strong>Install app</strong>, then tap <strong>Install</strong>.
                </li>
              </ol>
            </div>

            {/* Step 2: iOS Instructions */}
            {isIOS || true ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs">
                <div className="font-bold text-slate-900">
                  iPhone / iPad (Safari)
                </div>
                <ol className="list-decimal pl-4 space-y-1.5 text-slate-700">
                  <li>
                    Open this app link in <strong>Safari</strong>.
                  </li>
                  <li>
                    Tap the <strong>Share</strong> icon in the bottom toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                </ol>
              </div>
            ) : null}

            {/* Copy App URL Helper */}
            {appUrl && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    App URL for Mobile Browser
                  </div>
                  <div className="font-mono text-xs font-semibold text-slate-800 truncate">
                    {appUrl}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 shrink-0"
                >
                  {copiedUrl ? 'Copied' : 'Copy Link'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      Offline Mode — Local ledger data active.
    </div>
  );
};
