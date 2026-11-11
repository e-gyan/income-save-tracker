import React, { useState, useRef, useEffect } from 'react';
import {
  User,
  loginWithGoogle,
  logoutUser,
  getFirebaseAuthDiagnostic,
  AuthDiagnosticInfo,
} from '../lib/firebase.ts';
import { ThemeMode, AppColorTheme } from '../types/finance.ts';
import { APP_COLOR_THEMES, getColorThemeConfig } from '../lib/colorThemes.ts';
import { APP_VERSION } from '../lib/calculations.ts';
import { ActiveTab } from './Navigation.tsx';

interface HeaderProps {
  currentUser: User | null;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
  colorTheme?: AppColorTheme;
  onColorThemeChange?: (colorTheme: AppColorTheme) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onTabChange,
  themeMode = 'light',
  onThemeModeChange,
  colorTheme = 'emerald',
  onColorThemeChange,
}) => {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [authDiagnostic, setAuthDiagnostic] = useState<AuthDiagnosticInfo | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setIsPaletteOpen(false);
      }
    };
    if (isPaletteOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPaletteOpen]);

  const handleAuthAction = async (useRedirect = false) => {
    if (currentUser) {
      await logoutUser();
    } else {
      setAuthDiagnostic(null);
      try {
        await loginWithGoogle(useRedirect);
      } catch (err: unknown) {
        const code = String((err as { code?: string })?.code || '');
        if (
          code !== 'auth/popup-closed-by-user' &&
          code !== 'auth/cancelled-popup-request'
        ) {
          setAuthDiagnostic(getFirebaseAuthDiagnostic(err));
        }
      }
    }
  };

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const cycleTheme = () => {
    if (!onThemeModeChange) return;
    const next: ThemeMode =
      themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    onThemeModeChange(next);
  };

  const activeColorConfig = getColorThemeConfig(colorTheme);

  return (
    <header className="border-b border-slate-200/80 bg-white/95">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => onTabChange('dashboard')}
            className="flex items-center gap-2 font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 text-left focus-visible:outline-none"
          >
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0 transition-colors"
              style={{ backgroundColor: 'var(--app-accent)' }}
            />
            <span className="break-words">Save N Know</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange('settings')}
            className="rounded-md border border-slate-200 bg-slate-100/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 hover:bg-slate-200/70 shrink-0"
            title="Version Control"
          >
            v{APP_VERSION}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Functional App Color Picker */}
          {onColorThemeChange && (
            <div className="relative" ref={paletteRef}>
              <button
                type="button"
                onClick={() => setIsPaletteOpen((prev) => !prev)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                title="App Color Palette"
              >
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: activeColorConfig.primary }}
                />
                <span className="hidden sm:inline">{activeColorConfig.name.split(' ')[0]}</span>
              </button>

              {isPaletteOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl z-50 space-y-1.5">
                  <div className="px-1.5 py-1 text-[11px] font-semibold text-slate-500">
                    App Color Palette
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {APP_COLOR_THEMES.map((item) => {
                      const isSelected = item.id === colorTheme;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onColorThemeChange(item.id);
                            setIsPaletteOpen(false);
                          }}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                            isSelected
                              ? 'bg-slate-100 font-semibold text-slate-900'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: item.primary }}
                            />
                            <div className="truncate">
                              <span className="text-slate-900">{item.name}</span>
                              <span className="ml-1.5 text-[10px] text-slate-400">
                                · {item.functionLabel}
                              </span>
                            </div>
                          </div>
                          {isSelected && (
                            <span
                              className="text-[11px] font-bold shrink-0"
                              style={{ color: item.primary }}
                            >
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Theme Mode Switcher */}
          {onThemeModeChange && (
            <button
              type="button"
              onClick={cycleTheme}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              title="Switch Theme Mode"
            >
              {themeMode === 'dark' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : themeMode === 'system' ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
              <span className="hidden sm:inline capitalize">{themeMode}</span>
            </button>
          )}

          {currentUser ? (
            <div className="flex items-center gap-2">
              <span className="hidden md:inline text-xs text-slate-500 max-w-[160px] truncate">
                {currentUser.email || currentUser.displayName}
              </span>
              <button
                type="button"
                onClick={() => handleAuthAction(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleAuthAction(false)}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Production Google Auth Setup / Diagnostic Modal */}
      {authDiagnostic && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setAuthDiagnostic(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  {authDiagnostic.title}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  {authDiagnostic.code} · Project: {authDiagnostic.projectId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuthDiagnostic(null)}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed break-words">
              {authDiagnostic.summary}
            </p>

            {/* Quick Copy Domain & Redirect URIs for Render */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-slate-500">
                    1. Firebase Authorized Domain
                  </div>
                  <div className="font-mono font-semibold text-slate-900 break-all">
                    {authDiagnostic.currentHostname}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(authDiagnostic.currentHostname, 'domain')
                  }
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 shrink-0"
                >
                  {copiedField === 'domain' ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="border-t border-slate-200/70 pt-2 space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-500">
                  2. OAuth 2.0 Authorized Redirect URIs
                </div>
                {authDiagnostic.requiredRedirectUris.map((uri, i) => (
                  <div
                    key={uri}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200/80 bg-white px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[11px] text-slate-800 break-all">
                      {uri}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(uri, `uri-${i}`)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 shrink-0"
                    >
                      {copiedField === `uri-${i}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-800">
                Steps to Authorize on Render:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-xs text-slate-600 leading-relaxed">
                <li className="break-words">
                  In Firebase Console → Authentication → Settings → Authorized domains, add{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {authDiagnostic.currentHostname}
                  </span>
                  .
                </li>
                <li className="break-words">
                  In Google Cloud Console → APIs & Services → Credentials (OAuth Client{' '}
                  <span className="font-mono text-[11px]">
                    {authDiagnostic.oAuthClientId}
                  </span>
                  ), add{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {authDiagnostic.currentOrigin}
                  </span>{' '}
                  under Authorized JavaScript origins.
                </li>
                <li className="break-words">
                  Under Authorized redirect URIs, ensure the two URIs above are listed and save.
                </li>
              </ol>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={authDiagnostic.firebaseAuthSettingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2"
                >
                  Firebase Auth Settings ↗
                </a>
                <a
                  href={authDiagnostic.gcpCredentialsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2"
                >
                  GCP OAuth Credentials ↗
                </a>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAuthAction(true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Sign In via Redirect
                </button>
                <button
                  type="button"
                  onClick={() => setAuthDiagnostic(null)}
                  className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
