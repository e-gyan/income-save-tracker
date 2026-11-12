import React, { useEffect, useState } from 'react';
import { ActiveTab, NAV_ITEMS } from './Navigation.tsx';
import { APP_VERSION } from './Header.tsx';
import {
  ThemeMode,
  AppColorTheme,
} from '../types/finance.ts';
import { APP_COLOR_THEMES } from '../lib/colorThemes.ts';
import {
  TimeRangePreset,
  TIME_RANGE_OPTIONS,
} from '../lib/dateFilters.ts';
import {
  auth,
  loginWithGoogle,
  logoutUser,
  onAuthStateChanged,
  User,
  AuthDiagnosticInfo,
  getFirebaseAuthDiagnostic,
} from '../lib/firebase.ts';

interface SidebarProps {
  isOpen: boolean;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  colorTheme: AppColorTheme;
  onColorThemeChange: (theme: AppColorTheme) => void;
  timeRange: TimeRangePreset;
  onSelectTimeRange: (range: TimeRangePreset) => void;
  accountsCount?: number;
  budgetsCount?: number;
  budgetAlertsCount?: number;
  onReset: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  activeTab,
  onSelectTab,
  onClose,
  themeMode,
  onThemeModeChange,
  colorTheme,
  onColorThemeChange,
  timeRange,
  onSelectTimeRange,
  accountsCount = 0,
  budgetsCount = 0,
  budgetAlertsCount = 0,
  onReset,
}) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authDiagnostic, setAuthDiagnostic] =
    useState<AuthDiagnosticInfo | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSignIn = async () => {
    setIsAuthLoading(true);
    setAuthDiagnostic(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setAuthDiagnostic(getFirebaseAuthDiagnostic(err));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsAuthLoading(true);
    try {
      await logoutUser();
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleCopyDomain = async (domain: string) => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (!isOpen && !authDiagnostic) return null;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Application Menu"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/35 backdrop-blur-[1px] transition-opacity"
            onClick={onClose}
          />

          {/* Top-Right Anchored Menu Drawer */}
          <aside className="relative z-10 flex h-full w-80 max-w-[88vw] flex-col justify-between border-l border-slate-200 bg-white shadow-xl overflow-y-auto">
            <div className="divide-y divide-slate-100">
              {/* 1. Drawer Top Header: App Name, Version & Close */}
              <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white font-display font-bold text-xs"
                    style={{ backgroundColor: 'var(--app-accent)' }}
                  >
                    S
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-display text-sm font-extrabold text-slate-900 truncate">
                        Save N Know
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTab('settings');
                          onClose();
                        }}
                        className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 hover:bg-slate-200 hover:text-slate-900 shrink-0"
                        title="View Version Release Log in Settings"
                      >
                        v{APP_VERSION}
                      </button>
                    </div>
                    
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close menu"
                  className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 shrink-0"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.25}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* 2. Account & Login Details Section */}
              <div className="p-4 space-y-2.5 bg-slate-50/60">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Account & Login Details
                </div>
                {user ? (
                  <div className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white p-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white uppercase"
                        style={{ backgroundColor: 'var(--app-accent)' }}
                      >
                        {(user.displayName || user.email || 'U').slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {user.displayName || 'Signed In User'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {user.email || 'Cloud Sync Active'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={isAuthLoading}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 shrink-0"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200/90 bg-white p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900">
                          Local Ledger Session
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Sign in to sync across devices
                        </div>
                      </div>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shrink-0">
                        Local Mode
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleSignIn}
                      disabled={isAuthLoading}
                      className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {isAuthLoading ? 'Connecting...' : 'Sign In with Google'}
                    </button>
                  </div>
                )}
              </div>

              {/* 3. Primary Navigation Links */}
              <nav className="p-3 space-y-1">
                <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Workspace Views
                </div>
                {NAV_ITEMS.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                        isActive
                          ? 'bg-slate-900 font-bold text-white'
                          : 'font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <span>{item.label}</span>
                      <div className="flex items-center gap-1.5">
                        {item.id === 'budgets' && budgetsCount > 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                              budgetAlertsCount > 0
                                ? 'bg-rose-500 text-white'
                                : isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {budgetAlertsCount > 0
                              ? `${budgetAlertsCount} alert`
                              : budgetsCount}
                          </span>
                        )}
                        {item.id === 'accounts' && accountsCount > 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {accountsCount}
                          </span>
                        )}
                        {isActive && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: 'var(--app-accent)' }}
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </nav>

              {/* 4. Date Filter Quick Selector */}
              <div className="p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Date Filter
                  </span>
                  {timeRange !== 'all' && (
                    <button
                      type="button"
                      onClick={() => onSelectTimeRange('all')}
                      className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline"
                    >
                      Show All
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {TIME_RANGE_OPTIONS.map((opt) => {
                    const isSelected = timeRange === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onSelectTimeRange(opt.id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors truncate ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 5. Color Theme & Appearance Mode */}
              <div className="p-3.5 space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Appearance & Color Theme
                </div>

                {/* Theme Mode (Light / Dark / Auto) */}
                <div className="space-y-1">
                  <span className="block text-[11px] font-semibold text-slate-600">
                    Display Mode
                  </span>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                    {(['light', 'dark', 'system'] as ThemeMode[]).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => onThemeModeChange(mode)}
                          className={`rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
                            themeMode === mode
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {mode === 'system' ? 'Auto' : mode}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Color Palette Swatches */}
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold text-slate-600">
                    Color Theme
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {APP_COLOR_THEMES.map((palette) => {
                      const isSelected = colorTheme === palette.id;
                      return (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => onColorThemeChange(palette.id)}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors min-w-0 ${
                            isSelected
                              ? 'border-slate-900 bg-slate-100 font-bold text-slate-900'
                              : 'border-slate-200/80 bg-white font-medium text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: palette.primary }}
                          />
                          <span className="truncate">{palette.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer: Version Info & Reset Sheet */}
            <div className="border-t border-slate-200 bg-slate-50/70 p-3.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('settings');
                  onClose();
                }}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-900"
              >
                Save N Know · v{APP_VERSION}
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReset();
                }}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                Reset Sheet
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Firebase Authentication Diagnostic & Setup Modal */}
      {authDiagnostic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-block rounded-md bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800">
                  {authDiagnostic.code}
                </span>
                <h3 className="mt-1 font-display text-base font-bold text-slate-900">
                  {authDiagnostic.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAuthDiagnostic(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-600">
              {authDiagnostic.summary}
            </p>

            {authDiagnostic.currentHostname && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Current Preview Domain
                  </div>
                  <div className="truncate font-mono text-xs font-semibold text-slate-900">
                    {authDiagnostic.currentHostname}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyDomain(authDiagnostic.currentHostname)
                  }
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {copiedDomain ? 'Copied' : 'Copy Domain'}
                </button>
              </div>
            )}

            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
              <div className="text-xs font-semibold text-slate-800">
                Required OAuth Redirect URIs:
              </div>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-slate-600 font-mono">
                {authDiagnostic.requiredRedirectUris.map((uri: string, i: number) => (
                  <li key={i} className="leading-relaxed break-all">
                    {uri}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-500">
                Your data remains saved locally while signed out.
              </span>
              <button
                type="button"
                onClick={() => setAuthDiagnostic(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Continue in Local Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
