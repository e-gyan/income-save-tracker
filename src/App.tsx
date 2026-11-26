/**
 * Save N Know — Main Application Orchestrator
 */

import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import {
  auth,
  onAuthStateChanged,
  getPersistedAuthUser,
  User,
} from './lib/firebase.ts';
import {
  UserSettings,
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  SavingsBucket,
  FinancialBudget,
  ThemeMode,
  AppColorTheme,
} from './types/finance.ts';
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_FINANCIAL_ACCOUNTS,
  LEGACY_AUTO_ACCOUNT_IDS,
  LEGACY_SEEDED_CUT_IDS,
  getEffectiveSavingsPillars,
  getEffectiveExpenseCategoryPreferences,
  getEffectiveIncomeDeductions,
  isSavingsVaultAccount,
  isSavingsDeduction,
  computeSavingsBreakdown,
  buildDefaultDeductionsForIncome,
  resolveIntuitiveSubcategoryColor,
} from './lib/calculations.ts';
import {
  evaluateAllBudgets,
  computeRecurringPeriodBounds,
  reconcileRecurringBudgets,
} from './lib/budgetCalculations.ts';
import { learnSavingsVaultDebitAccount } from './lib/deductionIntelligence.ts';
import {
  applyColorThemeToDocument,
  applyAccountingFigureColorsToDocument,
  getPersistedColorTheme,
  setPersistedColorTheme,
  getPersistedThemeMode,
  setPersistedThemeMode,
  getScheduledThemeIsDark,
  getPersistedAccountingFiguresEnabled,
  getPersistedPositiveFigureColor,
  getPersistedNegativeFigureColor,
} from './lib/colorThemes.ts';
import {
  fetchUserSettings,
  saveUserSettings,
  subscribeToIncomes,
  saveIncomeReceipt,
  deleteIncomeReceipt,
  subscribeToFlexibleExpenses,
  saveFlexibleExpense,
  deleteFlexibleExpense,
  subscribeToAccounts,
  saveFinancialAccount,
  deleteFinancialAccount,
  subscribeToTransfers,
  saveAccountTransfer,
  deleteAccountTransfer,
  subscribeToBudgets,
  saveFinancialBudget,
  deleteFinancialBudget,
  clearAllTransactionsAndTransfers,
  batchDeleteTransactions,
  getLocalData,
  setLocalData,
  clearUnassignedLocalData,
  syncAuthenticatedCloudSnapshotToBackend,
  hydrateAuthenticatedCloudSnapshotFromBackend,
} from './lib/firestoreService.ts';

import { Header } from './components/Header.tsx';
import {
  Navigation,
  BottomMenuBar,
  BOTTOM_NAV_ITEMS,
  ActiveTab,
} from './components/Navigation.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { IncomeLogView } from './components/IncomeLogView.tsx';
import { FlexibleExpensesView } from './components/FlexibleExpensesView.tsx';
import { AccountsView } from './components/AccountsView.tsx';
import { BudgetsView } from './components/BudgetsView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { CleanSheetModal } from './components/CleanSheetModal.tsx';
import { FloatingQuickActions } from './components/FloatingQuickActions.tsx';
import { DeductionAgentModal } from './components/DeductionAgentModal.tsx';
import { EditExpenseModal } from './components/EditExpenseModal.tsx';
import { OfflineIndicator } from './components/PWAInstallButton.tsx';
import { BiometricLockScreen } from './components/BiometricLockScreen.tsx';
import { DriveAlignmentApprovalPayload } from './lib/driveAlignment.ts';
import {
  shouldStartAppLocked,
  getBiometricDeviceState,
  saveBiometricDeviceState,
} from './lib/biometricAuth.ts';
import {
  TimeRangePreset,
  CustomDateRange,
  isDateInPreset,
} from './lib/dateFilters.ts';
import {
  loadPersistedNavigationState,
  savePersistedNavigationState,
  buildHistoryStateSnapshot,
  parseHistoryStateSnapshot,
  clearWorkflowState,
} from './lib/appStateRestore.ts';
import {
  findNov24ImportedTransactions,
  RESTORE_TARGET_DATE_LABEL,
  IMPORT_PURGE_DATE_LABEL,
} from './lib/nov24Restore.ts';

export default function App() {
  // Synchronously hydrate the signed-in user and their cloud-cached records on frame 0
  // so refreshing or opening the app renders data immediately without waiting.
  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    getPersistedAuthUser()
  );

  // Synchronously restore previous navigation & workflow state (browser history or persisted session)
  const initialNavBoot = useMemo(() => {
    const initialUid = getPersistedAuthUser()?.uid || 'guest_user';
    const historySnap =
      typeof window !== 'undefined'
        ? parseHistoryStateSnapshot(window.history.state)
        : null;
    const savedNav = loadPersistedNavigationState(initialUid);
    const restoredTab: ActiveTab =
      historySnap?.activeTab || savedNav?.activeTab || 'dashboard';
    const restoredRange: TimeRangePreset =
      historySnap?.timeRange || savedNav?.timeRange || 'all';
    const restoredCustomRange: CustomDateRange = historySnap?.customDateRange ||
      savedNav?.customDateRange || { startDate: '', endDate: '' };
    const restoredDriveOpen =
      restoredTab === 'settings' &&
      Boolean(
        historySnap?.isDriveAlignmentOpen ??
          savedNav?.isDriveAlignmentOpen ??
          false
      );
    return {
      activeTab: restoredTab,
      timeRange: restoredRange,
      customDateRange: restoredCustomRange,
      isDriveAlignmentOpen: restoredDriveOpen,
      scrollByTab: savedNav?.scrollByTab || {},
    };
  }, []);

  const [activeTab, setActiveTab] = useState<ActiveTab>(
    () => initialNavBoot.activeTab
  );
  const [, startTransition] = useTransition();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileDateFilterOpen, setIsMobileDateFilterOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRangePreset>(
    () => initialNavBoot.timeRange
  );
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>(
    () => initialNavBoot.customDateRange
  );
  const [isDriveAlignmentOpen, setIsDriveAlignmentOpen] = useState<boolean>(
    () => initialNavBoot.isDriveAlignmentOpen
  );
  const [isRestoringNov23, setIsRestoringNov23] = useState(false);
  const [nov24BannerDismissed, setNov24BannerDismissed] = useState(false);
  const [nov24ConfirmBanner, setNov24ConfirmBanner] = useState(false);
  const [nov24RestoreNotice, setNov24RestoreNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeductionAgentOpen, setIsDeductionAgentOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FlexibleExpense | null>(null);
  const [expandIncomeTrigger, setExpandIncomeTrigger] = useState(0);
  const [expandExpenseTrigger, setExpandExpenseTrigger] = useState(0);
  const [openTransferTrigger, setOpenTransferTrigger] = useState(0);
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() =>
    shouldStartAppLocked()
  );
  const hiddenSinceRef = useRef<number | null>(null);
  const scrollByTabRef = useRef<Partial<Record<ActiveTab, number>>>(
    initialNavBoot.scrollByTab
  );
  const activeTabRef = useRef<ActiveTab>(initialNavBoot.activeTab);
  const timeRangeRef = useRef<TimeRangePreset>(initialNavBoot.timeRange);
  const customDateRangeRef = useRef<CustomDateRange>(
    initialNavBoot.customDateRange
  );
  const driveOpenRef = useRef<boolean>(initialNavBoot.isDriveAlignmentOpen);
  const scrollSaveTimerRef = useRef<number | null>(null);

  // Core Data States (Strictly attached to the signed-in account; hydrated synchronously on mount)
  const [settings, setSettings] = useState<UserSettings>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return DEFAULT_USER_SETTINGS;
    const cached = getLocalData<UserSettings>(
      'settings',
      {
        ...DEFAULT_USER_SETTINGS,
        userId: initialUid,
        colorTheme: getPersistedColorTheme(),
        themeMode: getPersistedThemeMode(),
        accountingFigureColorsEnabled: getPersistedAccountingFiguresEnabled(),
        positiveFigureColor: getPersistedPositiveFigureColor(),
        negativeFigureColor: getPersistedNegativeFigureColor(),
      },
      initialUid
    );
    return {
      ...cached,
      colorTheme: cached.colorTheme || getPersistedColorTheme(),
      themeMode: cached.themeMode || getPersistedThemeMode(),
      accountingFigureColorsEnabled:
        cached.accountingFigureColorsEnabled !== undefined
          ? Boolean(cached.accountingFigureColorsEnabled)
          : getPersistedAccountingFiguresEnabled(),
      positiveFigureColor:
        cached.positiveFigureColor || getPersistedPositiveFigureColor(),
      negativeFigureColor:
        cached.negativeFigureColor || getPersistedNegativeFigureColor(),
      customCuts: (cached.customCuts || []).filter(
        (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
      ),
    };
  });

  const [accounts, setAccounts] = useState<FinancialAccount[]>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return DEFAULT_FINANCIAL_ACCOUNTS;
    return getLocalData<FinancialAccount[]>(
      'accounts',
      DEFAULT_FINANCIAL_ACCOUNTS,
      initialUid
    );
  });

  const [transfers, setTransfers] = useState<AccountTransfer[]>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return [];
    return getLocalData<AccountTransfer[]>('transfers', [], initialUid);
  });

  const [incomes, setIncomes] = useState<IncomeReceipt[]>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return [];
    return getLocalData<IncomeReceipt[]>('incomes', [], initialUid);
  });

  const [expenses, setExpenses] = useState<FlexibleExpense[]>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return [];
    return getLocalData<FlexibleExpense[]>('expenses', [], initialUid);
  });

  const [budgets, setBudgets] = useState<FinancialBudget[]>(() => {
    const initialUid = getPersistedAuthUser()?.uid;
    if (!initialUid) return [];
    return getLocalData<FinancialBudget[]>('budgets', [], initialUid);
  });

  const effectiveUserId = currentUser?.uid || 'guest_user';

  // Apply Theme Mode (light / dark / 6:45 AM-PM schedule / Auto system), Color Theme & Accounting Figure Colors
  useEffect(() => {
    const mode: ThemeMode = settings.themeMode || getPersistedThemeMode();
    const colorTheme: AppColorTheme =
      settings.colorTheme || getPersistedColorTheme();
    const root = document.documentElement;

    setPersistedThemeMode(mode);
    setPersistedColorTheme(colorTheme);
    applyAccountingFigureColorsToDocument({
      enabled: settings.accountingFigureColorsEnabled !== false,
      positiveColor: settings.positiveFigureColor || '#059669',
      negativeColor: settings.negativeFigureColor || '#e11d48',
    });

    const applyThemeAndColors = () => {
      let isDark = false;
      if (mode === 'dark') {
        isDark = true;
      } else if (mode === 'light') {
        isDark = false;
      } else if (mode === 'schedule') {
        isDark = getScheduledThemeIsDark(new Date());
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      root.classList.toggle('dark', isDark);
      applyColorThemeToDocument(colorTheme, isDark);
    };

    applyThemeAndColors();

    if (mode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyThemeAndColors();
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }

    if (mode === 'schedule') {
      const intervalId = window.setInterval(applyThemeAndColors, 30_000);
      const onVis = () => {
        if (document.visibilityState === 'visible') {
          applyThemeAndColors();
        }
      };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', onVis);
      };
    }
  }, [
    settings.themeMode,
    settings.colorTheme,
    settings.accountingFigureColorsEnabled,
    settings.positiveFigureColor,
    settings.negativeFigureColor,
  ]);

  // Auth and Firestore Subscriptions — Data is strictly attached to the signed-in account
  useEffect(() => {
    let unsubs: (() => void)[] = [];

    const cleanupActiveSubscriptions = () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          // ignore cleanup errors
        }
      }
      unsubs = [];
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      cleanupActiveSubscriptions();
      setCurrentUser(user);

      try {
        if (user) {
          const uid = user.uid;

          const cachedSettings = getLocalData<UserSettings>(
            'settings',
            {
              ...DEFAULT_USER_SETTINGS,
              userId: uid,
              colorTheme: getPersistedColorTheme(),
              themeMode: getPersistedThemeMode(),
              accountingFigureColorsEnabled: getPersistedAccountingFiguresEnabled(),
              positiveFigureColor: getPersistedPositiveFigureColor(),
              negativeFigureColor: getPersistedNegativeFigureColor(),
            },
            uid
          );
          const cleanedCachedSettings: UserSettings = {
            ...cachedSettings,
            colorTheme: cachedSettings.colorTheme || getPersistedColorTheme(),
            themeMode: cachedSettings.themeMode || getPersistedThemeMode(),
            accountingFigureColorsEnabled:
              cachedSettings.accountingFigureColorsEnabled !== undefined
                ? Boolean(cachedSettings.accountingFigureColorsEnabled)
                : getPersistedAccountingFiguresEnabled(),
            positiveFigureColor:
              cachedSettings.positiveFigureColor || getPersistedPositiveFigureColor(),
            negativeFigureColor:
              cachedSettings.negativeFigureColor || getPersistedNegativeFigureColor(),
            customCuts: (cachedSettings.customCuts || []).filter(
              (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
            ),
          };
          setSettings(cleanedCachedSettings);

          const cachedIncomes = getLocalData<IncomeReceipt[]>('incomes', [], uid);
          setIncomes(cachedIncomes);

          const cachedExpenses = getLocalData<FlexibleExpense[]>('expenses', [], uid);
          setExpenses(cachedExpenses);

          const cachedTransfers = getLocalData<AccountTransfer[]>('transfers', [], uid);
          setTransfers(cachedTransfers);

          const cachedAccounts = getLocalData<FinancialAccount[]>(
            'accounts',
            DEFAULT_FINANCIAL_ACCOUNTS,
            uid
          );
          setAccounts(cachedAccounts);

          const cachedBudgets = getLocalData<FinancialBudget[]>('budgets', [], uid);
          setBudgets(cachedBudgets);

          // Non-blocking backend cloud-session snapshot check for instant cross-tab/refresh continuity
          hydrateAuthenticatedCloudSnapshotFromBackend(uid)
            .then((snap) => {
              if (!snap) return;
              if (snap.incomes && snap.incomes.length > 0 && cachedIncomes.length === 0) {
                setIncomes(snap.incomes);
                setLocalData('incomes', snap.incomes, uid);
              }
              if (snap.expenses && snap.expenses.length > 0 && cachedExpenses.length === 0) {
                setExpenses(snap.expenses);
                setLocalData('expenses', snap.expenses, uid);
              }
              if (snap.transfers && snap.transfers.length > 0 && cachedTransfers.length === 0) {
                setTransfers(snap.transfers);
                setLocalData('transfers', snap.transfers, uid);
              }
              if (snap.accounts && snap.accounts.length > 0 && cachedAccounts.length <= 1) {
                setAccounts(snap.accounts);
                setLocalData('accounts', snap.accounts, uid);
              }
              if (snap.budgets && snap.budgets.length > 0 && cachedBudgets.length === 0) {
                setBudgets(snap.budgets);
                setLocalData('budgets', snap.budgets, uid);
              }
            })
            .catch(() => {});

          clearUnassignedLocalData();

          fetchUserSettings(uid)
            .then((userSettings) => {
              setSettings(userSettings);
              setLocalData('settings', userSettings, uid);
            })
            .catch((err) => {
              console.warn('Using user settings cache:', err);
            });

          const unsubIncomes = subscribeToIncomes(
            uid,
            (items) => {
              setIncomes(items);
              setLocalData('incomes', items, uid);
              syncAuthenticatedCloudSnapshotToBackend(uid, { incomes: items });
            },
            (err) => console.warn('Incomes subscription fallback to user cache:', err)
          );
          unsubs.push(unsubIncomes);

          const unsubExpenses = subscribeToFlexibleExpenses(uid, (items) => {
            setExpenses(items);
            setLocalData('expenses', items, uid);
            syncAuthenticatedCloudSnapshotToBackend(uid, { expenses: items });
          });
          unsubs.push(unsubExpenses);

          const unsubAccounts = subscribeToAccounts(uid, (items) => {
            const cleaned = items.filter(
              (a) =>
                !LEGACY_AUTO_ACCOUNT_IDS.has(a.id) ||
                (a.initialBalance && a.initialBalance > 0)
            );
            const hasOperatingAccount = cleaned.some(
              (a) =>
                a.id === 'acc-main-op' ||
                a.id === 'acc_main' ||
                !a.linkedSavingsBucketId
            );
            const missingMain = !hasOperatingAccount
              ? DEFAULT_FINANCIAL_ACCOUNTS.filter(
                  (da) => da.id === 'acc-main-op'
                ).map((da) => ({ ...da, userId: uid }))
              : [];

            const merged = [...cleaned, ...missingMain];
            setAccounts(merged);
            setLocalData('accounts', merged, uid);
            syncAuthenticatedCloudSnapshotToBackend(uid, { accounts: merged });

            if (missingMain.length > 0) {
              for (const m of missingMain) {
                saveFinancialAccount(uid, m).catch(() => {});
              }
            }
          });
          unsubs.push(unsubAccounts);

          const unsubTransfers = subscribeToTransfers(uid, (items) => {
            setTransfers(items);
            setLocalData('transfers', items, uid);
            syncAuthenticatedCloudSnapshotToBackend(uid, { transfers: items });
          });
          unsubs.push(unsubTransfers);

          const unsubBudgets = subscribeToBudgets(uid, (items) => {
            setBudgets(items);
            setLocalData('budgets', items, uid);
            syncAuthenticatedCloudSnapshotToBackend(uid, { budgets: items });
          });
          unsubs.push(unsubBudgets);
        } else {
          // Signed Out: Keep all records attached to the signed-in account and clear signed-out view
          clearUnassignedLocalData();
          setIncomes([]);
          setExpenses([]);
          setTransfers([]);
          setBudgets([]);
          setAccounts(DEFAULT_FINANCIAL_ACCOUNTS);
          setSettings((prev) => ({
            ...DEFAULT_USER_SETTINGS,
            themeMode: prev.themeMode || getPersistedThemeMode(),
            colorTheme: prev.colorTheme || getPersistedColorTheme(),
          }));
        }
      } catch (authError) {
        console.warn('Auth subscription warning:', authError);
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      cleanupActiveSubscriptions();
      unsubscribeAuth();
    };
  }, []);

  // Clean Sheet Reset Modal State
  const [isCleanSheetModalOpen, setIsCleanSheetModalOpen] = useState(false);
  const [isClearingSheet, setIsClearingSheet] = useState(false);

  const handleConfirmCleanSheet = async () => {
    setIsClearingSheet(true);
    try {
      setIncomes([]);
      setExpenses([]);
      setTransfers([]);
      setBudgets([]);

      setLocalData('incomes', [], effectiveUserId);
      setLocalData('expenses', [], effectiveUserId);
      setLocalData('transfers', [], effectiveUserId);
      setLocalData('budgets', [], effectiveUserId);

      const zeroedAccounts = accounts.map((a) => ({ ...a, initialBalance: 0 }));
      setAccounts(zeroedAccounts);
      setLocalData('accounts', zeroedAccounts, effectiveUserId);

      await clearAllTransactionsAndTransfers(effectiveUserId);
      setIsCleanSheetModalOpen(false);
    } catch (err) {
      console.error('Clean sheet reset error:', err);
    } finally {
      setIsClearingSheet(false);
    }
  };

  const handleSaveSettings = async (updatedSettings: UserSettings) => {
    setSettings(updatedSettings);
    setLocalData('settings', updatedSettings, effectiveUserId);

    // Synchronize Savings Vault accounts with updatedSettings.savingsBuckets
    const effectivePillars = getEffectiveSavingsPillars(updatedSettings);
    const activeVaultIds = new Set(effectivePillars.map((p) => p.accountId));
    const rawOperatingList = accounts.filter(
      (a) => !isSavingsVaultAccount(a, settings) && !activeVaultIds.has(a.id)
    );
    const operatingAccountsList =
      rawOperatingList.length > 0
        ? rawOperatingList
        : [
            {
              ...DEFAULT_FINANCIAL_ACCOUNTS[0],
              userId: effectiveUserId,
            },
          ];
    const defaultOpId =
      operatingAccountsList.find((a) => !a.isVirtual && a.isDefaultDeposit)?.id ||
      operatingAccountsList.find((a) => !a.isVirtual)?.id ||
      operatingAccountsList.find((a) => a.isDefaultDeposit)?.id ||
      operatingAccountsList[0]?.id ||
      'acc-main-op';

    const syncedVaultAccounts: FinancialAccount[] = effectivePillars.map((pillar) => {
      const existing = accounts.find((a) => a.id === pillar.accountId);
      const custodianId =
        updatedSettings.vaultCustodianAccounts?.[pillar.accountId] ||
        pillar.custodianAccountId ||
        existing?.custodianAccountId ||
        defaultOpId;
      return existing
        ? {
            ...existing,
            name: pillar.name,
            type: 'Savings',
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
            description: `${pillar.percentage}% savings allocation vault`,
            updatedAt: new Date().toISOString(),
          }
        : {
            id: pillar.accountId,
            userId: effectiveUserId,
            name: pillar.name,
            type: 'Savings',
            institution: 'Savings Vault',
            initialBalance: 0,
            color: pillar.color,
            description: `${pillar.percentage}% savings allocation vault`,
            isDefaultDeposit: false,
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
    });

    const deletedVaultAccounts = accounts.filter(
      (a) => isSavingsVaultAccount(a, settings) && !activeVaultIds.has(a.id)
    );
    const nextAccounts = [...operatingAccountsList, ...syncedVaultAccounts];
    setAccounts(nextAccounts);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    (async () => {
      setIsSaving(true);
      try {
        if (currentUser) {
          await saveUserSettings(currentUser.uid, updatedSettings);
          for (const va of syncedVaultAccounts) {
            await saveFinancialAccount(currentUser.uid, va);
          }
          for (const delVa of deletedVaultAccounts) {
            await deleteFinancialAccount(currentUser.uid, delVa.id);
          }
        }
      } catch (err) {
        console.error('Background settings save error:', err);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  // Sync device biometric lock-on-resume preference and re-lock when returning to the PWA from background
  useEffect(() => {
    const devState = getBiometricDeviceState();
    const desiredResume = settings.biometricLockOnResume !== false;
    if (devState.lockOnResume !== desiredResume) {
      saveBiometricDeviceState({ lockOnResume: desiredResume });
    }
  }, [settings.biometricLockOnResume]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        const devState = getBiometricDeviceState();
        const lockActive = Boolean(
          devState.enabled && (devState.credentialId || devState.passcodeHash)
        );
        const lockOnResume =
          devState.lockOnResume && settings.biometricLockOnResume !== false;
        const hiddenDurationMs = hiddenSinceRef.current
          ? Date.now() - hiddenSinceRef.current
          : 0;
        hiddenSinceRef.current = null;
        if (lockActive && lockOnResume && hiddenDurationMs >= 15000) {
          setIsAppLocked(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [settings.biometricLockOnResume]);

  /**
   * Backend-managed prospective savings vault percentage update.
   * Freezes existing income records using the previous vault rates before applying the new
   * percentages so changes take effect ONLY on new income records and never alter past history.
   */
  const handleUpdateSavingsVaultRates = async (
    nextBuckets: SavingsBucket[],
    nextCustodians?: Record<string, string>
  ): Promise<{
    settings: UserSettings;
    summary: {
      totalRatePercent: number;
      preservedIncomesCount: number;
      totalExistingIncomes: number;
    };
  }> => {
    const resolvedCustodians =
      nextCustodians !== undefined
        ? nextCustodians
        : settings.vaultCustodianAccounts || {};

    let updatedSettings: UserSettings | null = null;
    let updatedIncomes: IncomeReceipt[] = incomes;
    let changedIncomes: IncomeReceipt[] = [];
    let summary = {
      totalRatePercent:
        Math.round(
          nextBuckets.reduce((s, b) => s + (Number(b.percentage) || 0), 0) * 100
        ) / 100,
      preservedIncomesCount: 0,
      totalExistingIncomes: incomes.length,
    };

    try {
      const resp = await fetch('/api/settings/vault-rates/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousSettings: settings,
          nextBuckets,
          vaultCustodianAccounts: resolvedCustodians,
          incomes,
          accounts,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.success && data?.settings) {
          updatedSettings = data.settings as UserSettings;
          updatedIncomes = Array.isArray(data.incomes)
            ? (data.incomes as IncomeReceipt[])
            : incomes;
          changedIncomes = Array.isArray(data.changedIncomes)
            ? (data.changedIncomes as IncomeReceipt[])
            : [];
          if (data.summary) {
            summary = {
              totalRatePercent: Number(data.summary.totalRatePercent) || 0,
              preservedIncomesCount: Number(data.summary.preservedIncomesCount) || 0,
              totalExistingIncomes: Number(data.summary.totalExistingIncomes) || incomes.length,
            };
          }
        }
      }
    } catch {
      // Offline PWA fallback executes identical prospective snapshot preservation locally
    }

    if (!updatedSettings) {
      const localChanged: IncomeReceipt[] = [];
      const localUpdatedIncomes = incomes.map((inc) => {
        if (!Array.isArray(inc.allocatedDeductions)) return inc;
        let modified = false;
        const nextDeds = inc.allocatedDeductions.map((ded) => {
          if (!isSavingsDeduction(ded)) return ded;
          if (
            Array.isArray(ded.savingsSplitSnapshot) &&
            ded.savingsSplitSnapshot.length > 0
          ) {
            return ded;
          }
          modified = true;
          return {
            ...ded,
            savingsSplitSnapshot: computeSavingsBreakdown(
              ded.amount,
              accounts,
              settings
            ),
          };
        });
        if (!modified) return inc;
        const frozen: IncomeReceipt = {
          ...inc,
          allocatedDeductions: nextDeds,
          updatedAt: new Date().toISOString(),
        };
        localChanged.push(frozen);
        return frozen;
      });

      updatedSettings = {
        ...settings,
        savingsBuckets: nextBuckets,
        vaultCustodianAccounts: resolvedCustodians,
        updatedAt: new Date().toISOString(),
      };
      updatedIncomes = localUpdatedIncomes;
      changedIncomes = localChanged;
      summary = {
        totalRatePercent:
          Math.round(
            nextBuckets.reduce((s, b) => s + (Number(b.percentage) || 0), 0) * 100
          ) / 100,
        preservedIncomesCount: localChanged.length,
        totalExistingIncomes: localUpdatedIncomes.length,
      };
    }

    // Apply settings, preserved incomes, and synced vault accounts atomically
    setSettings(updatedSettings);
    setLocalData('settings', updatedSettings, effectiveUserId);

    if (changedIncomes.length > 0) {
      setIncomes(updatedIncomes);
      setLocalData('incomes', updatedIncomes, effectiveUserId);
    }

    const effectivePillars = getEffectiveSavingsPillars(updatedSettings);
    const activeVaultIds = new Set(effectivePillars.map((p) => p.accountId));
    const rawOperatingList = accounts.filter(
      (a) => !isSavingsVaultAccount(a, settings) && !activeVaultIds.has(a.id)
    );
    const operatingAccountsList =
      rawOperatingList.length > 0
        ? rawOperatingList
        : [
            {
              ...DEFAULT_FINANCIAL_ACCOUNTS[0],
              userId: effectiveUserId,
            },
          ];
    const defaultOpId =
      operatingAccountsList.find((a) => !a.isVirtual && a.isDefaultDeposit)?.id ||
      operatingAccountsList.find((a) => !a.isVirtual)?.id ||
      operatingAccountsList.find((a) => a.isDefaultDeposit)?.id ||
      operatingAccountsList[0]?.id ||
      'acc-main-op';

    const syncedVaultAccounts: FinancialAccount[] = effectivePillars.map((pillar) => {
      const existing = accounts.find((a) => a.id === pillar.accountId);
      const custodianId =
        updatedSettings!.vaultCustodianAccounts?.[pillar.accountId] ||
        pillar.custodianAccountId ||
        existing?.custodianAccountId ||
        defaultOpId;
      return existing
        ? {
            ...existing,
            name: pillar.name,
            type: 'Savings',
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
            description: `${pillar.percentage}% savings allocation vault`,
            updatedAt: new Date().toISOString(),
          }
        : {
            id: pillar.accountId,
            userId: effectiveUserId,
            name: pillar.name,
            type: 'Savings',
            institution: 'Savings Vault',
            initialBalance: 0,
            color: pillar.color,
            description: `${pillar.percentage}% savings allocation vault`,
            isDefaultDeposit: false,
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
    });

    const deletedVaultAccounts = accounts.filter(
      (a) => isSavingsVaultAccount(a, settings) && !activeVaultIds.has(a.id)
    );
    const nextAccounts = [...operatingAccountsList, ...syncedVaultAccounts];
    setAccounts(nextAccounts);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    const finalSettings = updatedSettings;
    const finalIncomes = updatedIncomes;
    const finalChangedIncomes = changedIncomes;

    (async () => {
      setIsSaving(true);
      try {
        if (currentUser) {
          await saveUserSettings(currentUser.uid, finalSettings);
          for (const va of syncedVaultAccounts) {
            await saveFinancialAccount(currentUser.uid, va);
          }
          for (const delVa of deletedVaultAccounts) {
            await deleteFinancialAccount(currentUser.uid, delVa.id);
          }
          for (let i = 0; i < finalChangedIncomes.length; i += 8) {
            const chunk = finalChangedIncomes.slice(i, i + 8);
            await Promise.all(
              chunk.map((inc) => saveIncomeReceipt(currentUser.uid, inc))
            );
          }
          syncAuthenticatedCloudSnapshotToBackend(currentUser.uid, {
            settings: finalSettings,
            accounts: nextAccounts,
            incomes: finalIncomes,
          });
        }
      } catch (err) {
        console.error('Background vault rate update save error:', err);
      } finally {
        setIsSaving(false);
      }
    })();

    return { settings: finalSettings, summary };
  };

  const handleThemeModeChange = (mode: ThemeMode) => {
    setPersistedThemeMode(mode);
    handleSaveSettings({
      ...settings,
      themeMode: mode,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleColorThemeChange = (colorTheme: AppColorTheme) => {
    setPersistedColorTheme(colorTheme);
    handleSaveSettings({
      ...settings,
      colorTheme,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddSavingsStructure = async (
    structureData: Omit<SavingsBucket, 'id'>,
    accountDetails?: { institution?: string; color?: string; initialBalance?: number }
  ) => {
    const bucketId = `bucket_${Date.now()}`;
    const accountId = `acc_sav_${Date.now()}`;

    const newAccount: FinancialAccount = {
      id: accountId,
      userId: effectiveUserId,
      name: structureData.name,
      type: 'Savings',
      institution: accountDetails?.institution || 'Savings Vault',
      initialBalance: accountDetails?.initialBalance || 0,
      color: accountDetails?.color || '#059669',
      description: structureData.description || '',
      isDefaultDeposit: false,
      linkedSavingsBucketId: bucketId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newBucket: SavingsBucket = {
      ...structureData,
      id: bucketId,
      accountId,
    };

    const nextBuckets = [...settings.savingsBuckets, newBucket];
    const nextAccounts = [...accounts, newAccount];
    const updatedSettings: UserSettings = {
      ...settings,
      savingsBuckets: nextBuckets,
      updatedAt: new Date().toISOString(),
    };

    setSettings(updatedSettings);
    setAccounts(nextAccounts);
    setLocalData('settings', updatedSettings, effectiveUserId);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    if (currentUser) {
      saveFinancialAccount(currentUser.uid, newAccount).catch(() => {});
      saveUserSettings(currentUser.uid, updatedSettings).catch(() => {});
    }
  };

  const buildStampedIncomeReceipt = (
    receiptData: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>,
    nowMs: number,
    idx = 0
  ): IncomeReceipt => {
    // Stamp active savings vault split percentages onto each savings deduction so
    // future vault percentage changes in Settings never rewrite this income record.
    const stampedDeductions = Array.isArray(receiptData.allocatedDeductions)
      ? receiptData.allocatedDeductions.map((ded) => {
          if (!isSavingsDeduction(ded)) return ded;
          if (
            Array.isArray(ded.savingsSplitSnapshot) &&
            ded.savingsSplitSnapshot.length > 0
          ) {
            return ded;
          }
          return {
            ...ded,
            savingsSplitSnapshot: computeSavingsBreakdown(
              ded.amount,
              accounts,
              settings
            ),
          };
        })
      : receiptData.allocatedDeductions;

    const randSuffix = Math.random().toString(36).slice(2, 7);
    const stampIso = new Date(nowMs + idx).toISOString();

    return {
      ...receiptData,
      allocatedDeductions: stampedDeductions,
      id: `inc_${nowMs}_${idx}_${randSuffix}`,
      userId: effectiveUserId,
      createdAt: stampIso,
      updatedAt: stampIso,
    };
  };

  const handleAddIncome = async (
    receiptData: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ): Promise<IncomeReceipt> => {
    const newReceipt = buildStampedIncomeReceipt(receiptData, Date.now(), 0);

    let persistedIncomes: IncomeReceipt[] = [];
    setIncomes((prev) => {
      const next = [newReceipt, ...prev];
      persistedIncomes = next;
      setLocalData('incomes', next, effectiveUserId);
      return next;
    });

    if (currentUser) {
      try {
        await saveIncomeReceipt(currentUser.uid, newReceipt);
        syncAuthenticatedCloudSnapshotToBackend(currentUser.uid, {
          incomes: persistedIncomes,
        });
      } catch (err) {
        console.error('Income save error:', err);
      }
    }

    return newReceipt;
  };

  const handleAddIncomes = async (
    receiptsData: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>[]
  ): Promise<IncomeReceipt[]> => {
    if (receiptsData.length === 0) return [];
    const nowMs = Date.now();
    const newReceipts: IncomeReceipt[] = receiptsData.map((r, idx) =>
      buildStampedIncomeReceipt(r, nowMs, idx)
    );

    let persistedIncomes: IncomeReceipt[] = [];
    setIncomes((prev) => {
      const next = [...newReceipts, ...prev];
      persistedIncomes = next;
      setLocalData('incomes', next, effectiveUserId);
      return next;
    });

    if (currentUser) {
      try {
        await Promise.all(
          newReceipts.map((rec) => saveIncomeReceipt(currentUser.uid, rec))
        );
        syncAuthenticatedCloudSnapshotToBackend(currentUser.uid, {
          incomes: persistedIncomes,
        });
      } catch (err) {
        console.error('Batch income save error:', err);
      }
    }

    return newReceipts;
  };

  const handleUpdateIncome = async (updatedReceipt: IncomeReceipt) => {
    const normalizedReceipt: IncomeReceipt = {
      ...updatedReceipt,
      allocatedDeductions: Array.isArray(updatedReceipt.allocatedDeductions)
        ? updatedReceipt.allocatedDeductions.map((ded) => {
            if (!isSavingsDeduction(ded)) return ded;
            if (
              Array.isArray(ded.savingsSplitSnapshot) &&
              ded.savingsSplitSnapshot.length > 0
            ) {
              return ded;
            }
            return {
              ...ded,
              savingsSplitSnapshot: computeSavingsBreakdown(
                ded.amount,
                accounts,
                settings
              ),
            };
          })
        : updatedReceipt.allocatedDeductions,
    };

    const nextIncomes = incomes.map((i) =>
      i.id === normalizedReceipt.id ? normalizedReceipt : i
    );
    setIncomes(nextIncomes);
    setLocalData('incomes', nextIncomes, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveIncomeReceipt(currentUser.uid, normalizedReceipt);
        }
      } catch (err) {
        console.error('Background income update error:', err);
      }
    })();
  };

  const handleDeleteIncome = async (receiptId: string) => {
    const nextIncomes = incomes.filter((i) => i.id !== receiptId);
    setIncomes(nextIncomes);
    setLocalData('incomes', nextIncomes, effectiveUserId);

    const linkedTransfersToDelete = transfers.filter(
      (t) => t.linkedIncomeId === receiptId
    );
    if (linkedTransfersToDelete.length > 0) {
      const nextTransfers = transfers.filter((t) => t.linkedIncomeId !== receiptId);
      setTransfers(nextTransfers);
      setLocalData('transfers', nextTransfers, effectiveUserId);
    }

    const linkedExpensesToDelete = expenses.filter(
      (e) => e.incomeReceiptId === receiptId
    );
    if (linkedExpensesToDelete.length > 0) {
      const nextExpenses = expenses.filter((e) => e.incomeReceiptId !== receiptId);
      setExpenses(nextExpenses);
      setLocalData('expenses', nextExpenses, effectiveUserId);
    }

    (async () => {
      try {
        if (currentUser) {
          await deleteIncomeReceipt(currentUser.uid, receiptId);
          for (const t of linkedTransfersToDelete) {
            await deleteAccountTransfer(currentUser.uid, t.id);
          }
          for (const exp of linkedExpensesToDelete) {
            await deleteFlexibleExpense(currentUser.uid, exp.id);
          }
        }
      } catch (err) {
        console.error('Background income delete error:', err);
      }
    })();
  };

  const handleAddExpenses = async (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => {
    if (items.length === 0) return;
    const nowMs = Date.now();
    const newRecords: FlexibleExpense[] = items.map((item, index) => {
      const selectedAcc = item.accountId
        ? accounts.find((a) => a.id === item.accountId)
        : undefined;
      const alreadyVault = Boolean(
        selectedAcc && isSavingsVaultAccount(selectedAcc, settings)
      );

      // Preserve the user's explicit account selection; only auto-route to a learned
      // Savings Vault when no valid account was selected on the payload.
      let resolvedAccountId = item.accountId;
      let resolvedVaultAction = item.vaultAction;

      if (!selectedAcc && item.vaultAction !== 'credit') {
        const learnedVault = learnSavingsVaultDebitAccount({
          recipient: item.recipient,
          description: item.description || item.notes,
          category: item.category,
          subcategory: item.subcategory,
          expenses,
          accounts,
          settings,
        });
        if (learnedVault) {
          resolvedAccountId = learnedVault.vaultAccountId;
          resolvedVaultAction = 'debit';
        }
      } else if (alreadyVault && !resolvedVaultAction) {
        resolvedVaultAction = 'debit';
      }

      const subColor =
        item.subcategoryColor ||
        (item.subcategory
          ? resolveIntuitiveSubcategoryColor(
              item.subcategory,
              item.category,
              settings,
              expenses
            )
          : undefined);

      const randSuffix = Math.random().toString(36).slice(2, 7);

      return {
        ...item,
        id: `exp_${nowMs}_${index}_${randSuffix}`,
        userId: effectiveUserId,
        accountId: resolvedAccountId,
        vaultAction: resolvedVaultAction,
        subcategoryColor: subColor,
        createdAt: new Date(nowMs + index).toISOString(),
      };
    });

    let persistedExpenses: FlexibleExpense[] = [];
    setExpenses((prev) => {
      const next = [...newRecords, ...prev];
      persistedExpenses = next;
      setLocalData('expenses', next, effectiveUserId);
      return next;
    });

    if (currentUser) {
      try {
        await Promise.all(
          newRecords.map((rec) => saveFlexibleExpense(currentUser.uid, rec))
        );
        syncAuthenticatedCloudSnapshotToBackend(currentUser.uid, {
          expenses: persistedExpenses,
        });
      } catch (err) {
        console.error('Expense save error:', err);
      }
    }
  };

  const handleUpdateExpense = async (updatedExpense: FlexibleExpense) => {
    // Income deduction expense transactions are read-only for editing and can only be deleted
    if (
      updatedExpense.id.startsWith('exp_ded_') ||
      updatedExpense.id.startsWith('exp_cut_') ||
      Boolean(updatedExpense.incomeReceiptId)
    ) {
      return;
    }

    const selectedAcc = updatedExpense.accountId
      ? accounts.find((a) => a.id === updatedExpense.accountId)
      : undefined;
    const isVaultAcc = Boolean(
      selectedAcc && isSavingsVaultAccount(selectedAcc, settings)
    );

    const normalized: FlexibleExpense = {
      ...updatedExpense,
      userId: effectiveUserId,
      vaultAction: isVaultAcc
        ? updatedExpense.vaultAction === 'credit'
          ? 'credit'
          : 'debit'
        : undefined,
      subcategoryColor: updatedExpense.subcategory
        ? resolveIntuitiveSubcategoryColor(
            updatedExpense.subcategory,
            updatedExpense.category,
            settings,
            expenses
          )
        : updatedExpense.subcategoryColor,
    };

    const exists = expenses.some((e) => e.id === normalized.id);
    const nextExpenses = exists
      ? expenses.map((e) => (e.id === normalized.id ? normalized : e))
      : [normalized, ...expenses];

    setExpenses(nextExpenses);
    setLocalData('expenses', nextExpenses, effectiveUserId);

    // Sync with backend endpoint and Firestore
    fetch('/api/expenses/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expense: normalized,
        baseCurrency: settings.currency,
        isVaultAccount: isVaultAcc,
      }),
    }).catch(() => {});

    (async () => {
      try {
        if (currentUser) {
          await saveFlexibleExpense(currentUser.uid, normalized);
        }
      } catch (err) {
        console.error('Expense update error:', err);
      }
    })();
  };

  const handleMoveSubcategory = async (
    subcategory: string,
    fromCategory: string,
    toCategory: string
  ) => {
    const cleanSub = subcategory.trim();
    const cleanFrom = fromCategory.trim();
    const cleanTo = toCategory.trim();
    if (!cleanSub || !cleanTo) return;
    if (cleanFrom.toLowerCase() === cleanTo.toLowerCase()) return;

    const subKey = cleanSub.toLowerCase();
    const fromKey = cleanFrom.toLowerCase();
    const toKey = cleanTo.toLowerCase();

    const currentPrefs = getEffectiveExpenseCategoryPreferences(settings, expenses);
    const preservedColor = resolveIntuitiveSubcategoryColor(
      cleanSub,
      cleanFrom || cleanTo,
      settings,
      expenses
    );

    let targetFound = false;
    const nextPrefs = currentPrefs.map((pref) => {
      const pKey = pref.name.trim().toLowerCase();
      const subs = pref.subcategories || [];
      const colors = { ...(pref.subcategoryColors || {}) };

      if (pKey === toKey) {
        targetFound = true;
        const hasSub = subs.some((s) => s.trim().toLowerCase() === subKey);
        const nextSubs = hasSub ? subs : [...subs, cleanSub];
        if (preservedColor && !colors[cleanSub]) {
          colors[cleanSub] = preservedColor;
        }
        return {
          ...pref,
          subcategories: nextSubs,
          subcategoryColors: colors,
        };
      }

      if (!fromKey || pKey === fromKey) {
        return {
          ...pref,
          subcategories: subs.filter((s) => s.trim().toLowerCase() !== subKey),
        };
      }

      return pref;
    });

    if (!targetFound) {
      nextPrefs.push({
        id: `cat_pref_${Date.now()}`,
        name: cleanTo,
        subcategories: [cleanSub],
        subcategoryColors: preservedColor ? { [cleanSub]: preservedColor } : {},
      });
    }

    const nextCuts = (settings.customCuts || []).map((cut) => {
      if ((cut.expenseSubcategory || '').trim().toLowerCase() === subKey) {
        return {
          ...cut,
          expenseCategory: cleanTo,
        };
      }
      return cut;
    });

    const updatedSettings: UserSettings = {
      ...settings,
      expenseCategories: nextPrefs.map((p) => p.name),
      expenseCategoryPreferences: nextPrefs,
      customCuts: nextCuts,
      updatedAt: new Date().toISOString(),
    };

    const changedExpenses: FlexibleExpense[] = [];
    const nextExpenses = expenses.map((exp) => {
      if ((exp.subcategory || '').trim().toLowerCase() === subKey) {
        const updatedExp: FlexibleExpense = {
          ...exp,
          category: cleanTo,
          subcategoryColor: preservedColor || exp.subcategoryColor,
        };
        changedExpenses.push(updatedExp);
        return updatedExp;
      }
      return exp;
    });

    const changedIncomes: IncomeReceipt[] = [];
    const nextIncomes = incomes.map((inc) => {
      if (!Array.isArray(inc.allocatedDeductions)) return inc;
      let changed = false;
      const nextDeds = inc.allocatedDeductions.map((d) => {
        if ((d.expenseSubcategory || '').trim().toLowerCase() === subKey) {
          changed = true;
          return {
            ...d,
            expenseCategory: cleanTo,
          };
        }
        return d;
      });
      if (changed) {
        const updatedInc: IncomeReceipt = {
          ...inc,
          allocatedDeductions: nextDeds,
          updatedAt: new Date().toISOString(),
        };
        changedIncomes.push(updatedInc);
        return updatedInc;
      }
      return inc;
    });

    const changedBudgets: FinancialBudget[] = [];
    const nextBudgets = budgets.map((b) => {
      const tracksSub = (b.subcategories || []).some(
        (s) => s.trim().toLowerCase() === subKey
      );
      if (!tracksSub) return b;
      const existingCats = b.categories || [];
      const hasTo = existingCats.some((c) => c.trim().toLowerCase() === toKey);
      const updatedBudget: FinancialBudget = {
        ...b,
        categories: hasTo ? existingCats : [...existingCats, cleanTo],
        updatedAt: new Date().toISOString(),
      };
      changedBudgets.push(updatedBudget);
      return updatedBudget;
    });

    setSettings(updatedSettings);
    setExpenses(nextExpenses);
    setIncomes(nextIncomes);
    setBudgets(nextBudgets);

    setLocalData('settings', updatedSettings, effectiveUserId);
    setLocalData('expenses', nextExpenses, effectiveUserId);
    setLocalData('incomes', nextIncomes, effectiveUserId);
    setLocalData('budgets', nextBudgets, effectiveUserId);

    // Notify backend route
    fetch('/api/categories/move-subcategory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcategory: cleanSub,
        fromCategory: cleanFrom,
        toCategory: cleanTo,
        settings: updatedSettings,
      }),
    }).catch(() => {});

    if (currentUser) {
      const uid = currentUser.uid;
      try {
        const chunkSize = 10;
        for (let i = 0; i < changedExpenses.length; i += chunkSize) {
          await Promise.all(
            changedExpenses
              .slice(i, i + chunkSize)
              .map((exp) => saveFlexibleExpense(uid, exp))
          );
        }
        for (let i = 0; i < changedIncomes.length; i += chunkSize) {
          await Promise.all(
            changedIncomes
              .slice(i, i + chunkSize)
              .map((inc) => saveIncomeReceipt(uid, inc))
          );
        }
        for (let i = 0; i < changedBudgets.length; i += chunkSize) {
          await Promise.all(
            changedBudgets
              .slice(i, i + chunkSize)
              .map((bgt) => saveFinancialBudget(uid, bgt))
          );
        }
        await saveUserSettings(uid, updatedSettings);
      } catch (err) {
        console.error('Move subcategory persistence error:', err);
      }
    }
  };

  const handleEditCategoryOrSubcategory = async (payload: {
    categoryId?: string;
    oldCategoryName: string;
    newCategoryName?: string;
    oldSubcategoryName?: string;
    newSubcategoryName?: string;
    subcategoryRenames?: { oldName: string; newName: string }[];
  }) => {
    const cleanOldCat = (payload.oldCategoryName || '').trim();
    const cleanNewCat = (payload.newCategoryName || cleanOldCat).trim();
    const currentEffectivePrefs = getEffectiveExpenseCategoryPreferences(
      settings,
      expenses
    );
    const snapshotSettings: UserSettings = {
      ...settings,
      expenseCategoryPreferences: currentEffectivePrefs,
      expenseCategories: currentEffectivePrefs.map((p) => p.name),
    };

    let updatedSettings: UserSettings | null = null;
    let nextExpenses: FlexibleExpense[] | null = null;
    let nextIncomes: IncomeReceipt[] | null = null;
    let nextBudgets: FinancialBudget[] | null = null;
    let changedExpenses: FlexibleExpense[] = [];
    let changedIncomes: IncomeReceipt[] = [];
    let changedBudgets: FinancialBudget[] = [];
    let summary = {
      expensesUpdated: 0,
      incomesUpdated: 0,
      budgetsUpdated: 0,
      deductionRulesUpdated: 0,
      totalRecordsUpdated: 0,
    };

    // 1. Primary path: Authoritative backend edit & full record cascade
    try {
      const resp = await fetch('/api/categories/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: payload.categoryId,
          oldCategoryName: cleanOldCat,
          newCategoryName: cleanNewCat,
          oldSubcategoryName: payload.oldSubcategoryName,
          newSubcategoryName: payload.newSubcategoryName,
          subcategoryRenames: payload.subcategoryRenames,
          settings: snapshotSettings,
          expenses,
          incomes,
          budgets,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.success && data?.settings) {
          updatedSettings = data.settings as UserSettings;
          nextExpenses = Array.isArray(data.expenses)
            ? (data.expenses as FlexibleExpense[])
            : expenses;
          nextIncomes = Array.isArray(data.incomes)
            ? (data.incomes as IncomeReceipt[])
            : incomes;
          nextBudgets = Array.isArray(data.budgets)
            ? (data.budgets as FinancialBudget[])
            : budgets;
          changedExpenses = Array.isArray(data.changedExpenses)
            ? (data.changedExpenses as FlexibleExpense[])
            : [];
          changedIncomes = Array.isArray(data.changedIncomes)
            ? (data.changedIncomes as IncomeReceipt[])
            : [];
          changedBudgets = Array.isArray(data.changedBudgets)
            ? (data.changedBudgets as FinancialBudget[])
            : [];
          if (data.summary) {
            summary = data.summary;
          }
        }
      }
    } catch {
      // Offline fallback executed below
    }

    // 2. Deterministic offline fallback when backend is unreachable
    if (!updatedSettings || !nextExpenses || !nextIncomes || !nextBudgets) {
      const normalizeLabelKey = (val?: string) =>
        (val || '')
          .toLowerCase()
          .replace(/&/g, ' and ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const nowIso = new Date().toISOString();
      const oldCatKey = normalizeLabelKey(cleanOldCat);
      const newCatKey = normalizeLabelKey(cleanNewCat);
      const categoryChanged =
        Boolean(cleanOldCat) && Boolean(cleanNewCat) && cleanOldCat !== cleanNewCat;

      const renameList: { oldName: string; newName: string }[] = [];
      if (payload.oldSubcategoryName && payload.newSubcategoryName) {
        renameList.push({
          oldName: payload.oldSubcategoryName.trim(),
          newName: payload.newSubcategoryName.trim(),
        });
      }
      for (const item of payload.subcategoryRenames || []) {
        const o = (item.oldName || '').trim();
        const n = (item.newName || '').trim();
        if (
          o &&
          n &&
          o !== n &&
          !renameList.some(
            (r) => normalizeLabelKey(r.oldName) === normalizeLabelKey(o)
          )
        ) {
          renameList.push({ oldName: o, newName: n });
        }
      }
      const subRenameLookup = new Map<string, string>();
      for (const r of renameList) {
        if (r.oldName && r.newName && r.oldName !== r.newName) {
          const k = normalizeLabelKey(r.oldName);
          if (k) subRenameLookup.set(k, r.newName);
        }
      }

      const dedupeList = (list: string[]) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const item of list) {
          const clean = (item || '').trim();
          if (!clean) continue;
          const k = normalizeLabelKey(clean);
          if (k && !seen.has(k)) {
            seen.add(k);
            out.push(clean);
          }
        }
        return out;
      };

      const targetIdx = currentEffectivePrefs.findIndex(
        (p) =>
          (payload.categoryId && p.id === payload.categoryId) ||
          (oldCatKey && normalizeLabelKey(p.name) === oldCatKey)
      );

      const subNamesInOtherCats = new Set<string>();
      const otherCategoryKeys = new Set<string>();
      currentEffectivePrefs.forEach((p, idx) => {
        if (idx === targetIdx) return;
        const pKey = normalizeLabelKey(p.name);
        if (pKey === oldCatKey) return;
        if (pKey) otherCategoryKeys.add(pKey);
        for (const s of p.subcategories || []) {
          const clean = normalizeLabelKey(s);
          if (clean) subNamesInOtherCats.add(clean);
        }
      });

      const targetUniqueSubKeys = new Set<string>();
      if (targetIdx >= 0) {
        for (const s of currentEffectivePrefs[targetIdx]?.subcategories || []) {
          const k = normalizeLabelKey(s);
          if (k && !subNamesInOtherCats.has(k)) {
            targetUniqueSubKeys.add(k);
          }
        }
      }
      for (const r of renameList) {
        const oldK = normalizeLabelKey(r.oldName);
        const newK = normalizeLabelKey(r.newName);
        if (oldK && !subNamesInOtherCats.has(oldK)) targetUniqueSubKeys.add(oldK);
        if (newK && !subNamesInOtherCats.has(newK)) targetUniqueSubKeys.add(newK);
      }

      const renamedColorMap = new Map<string, string>();
      const updatedTargetPref =
        targetIdx >= 0
          ? (() => {
              const pref = currentEffectivePrefs[targetIdx];
              const nextSubs = dedupeList(
                (pref.subcategories || []).map(
                  (s) => subRenameLookup.get(normalizeLabelKey(s)) || s
                )
              );
              const nextColors: Record<string, string> = {};
              for (const [k, v] of Object.entries(pref.subcategoryColors || {})) {
                const mapped = subRenameLookup.get(normalizeLabelKey(k));
                const finalKey = mapped || k;
                if (v && !nextColors[finalKey]) {
                  nextColors[finalKey] = v;
                }
                if (mapped && v) {
                  renamedColorMap.set(normalizeLabelKey(mapped), v);
                }
              }
              return {
                ...pref,
                name: cleanNewCat,
                subcategories: nextSubs,
                subcategoryColors: nextColors,
              };
            })()
          : {
              id: payload.categoryId || `exp_cat_${Date.now()}`,
              name: cleanNewCat,
              subcategories: dedupeList(renameList.map((r) => r.newName)),
              subcategoryColors: {} as Record<string, string>,
            };

      const nextPrefs: typeof currentEffectivePrefs = [];
      let mergedIntoExisting = false;
      for (let idx = 0; idx < currentEffectivePrefs.length; idx++) {
        if (idx === targetIdx) continue;
        const pref = currentEffectivePrefs[idx];
        const pKey = normalizeLabelKey(pref.name);
        if (pKey === newCatKey && categoryChanged) {
          mergedIntoExisting = true;
          nextPrefs.push({
            ...pref,
            name: cleanNewCat,
            subcategories: dedupeList([
              ...(pref.subcategories || []),
              ...(updatedTargetPref.subcategories || []),
            ]),
            subcategoryColors: {
              ...(updatedTargetPref.subcategoryColors || {}),
              ...(pref.subcategoryColors || {}),
            },
          });
        } else {
          nextPrefs.push(pref);
        }
      }
      if (!mergedIntoExisting) {
        if (targetIdx >= 0) {
          nextPrefs.splice(Math.min(targetIdx, nextPrefs.length), 0, updatedTargetPref);
        } else {
          nextPrefs.push(updatedTargetPref);
        }
      }

      let deductionRulesUpdated = 0;
      const nextCuts = (settings.customCuts || []).map((cut) => {
        const curCat = (cut.expenseCategory || '').trim();
        const curSub = (cut.expenseSubcategory || '').trim();
        const curCatKey = normalizeLabelKey(curCat);
        const curSubKey = normalizeLabelKey(curSub);
        const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
        const ownedSubOrphanCat =
          categoryChanged &&
          Boolean(curSubKey) &&
          targetUniqueSubKeys.has(curSubKey) &&
          (!curCatKey ||
            curCatKey === 'uncategorized' ||
            !otherCategoryKeys.has(curCatKey));
        const mappedSub = subRenameLookup.get(curSubKey);
        const subMatchesScope =
          Boolean(mappedSub) &&
          (matchesCat ||
            ownedSubOrphanCat ||
            curCatKey === newCatKey ||
            !curCatKey ||
            !subNamesInOtherCats.has(curSubKey));
        if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return cut;
        const updatedCat =
          matchesCat || ownedSubOrphanCat ? cleanNewCat : curCat || cleanNewCat;
        const updatedSub = subMatchesScope && mappedSub ? mappedSub : curSub;
        if (updatedCat !== curCat || updatedSub !== curSub) {
          deductionRulesUpdated++;
          return {
            ...cut,
            expenseCategory: updatedCat,
            expenseSubcategory: updatedSub,
          };
        }
        return cut;
      });

      updatedSettings = {
        ...settings,
        expenseCategoryPreferences: nextPrefs,
        expenseCategories: nextPrefs.map((p) => p.name),
        customCuts: nextCuts,
        updatedAt: nowIso,
      };

      changedExpenses = [];
      nextExpenses = expenses.map((exp) => {
        const curCat = (exp.category || '').trim();
        const curSub = (exp.subcategory || '').trim();
        const curDesc = (exp.description || '').trim();
        const curCatKey = normalizeLabelKey(curCat);
        const curSubKey = normalizeLabelKey(curSub);
        const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
        const ownedSubOrphanCat =
          categoryChanged &&
          Boolean(curSubKey) &&
          targetUniqueSubKeys.has(curSubKey) &&
          (!curCatKey ||
            curCatKey === 'uncategorized' ||
            !otherCategoryKeys.has(curCatKey));
        const mappedSub = subRenameLookup.get(curSubKey);
        const subMatchesScope =
          Boolean(mappedSub) &&
          (matchesCat ||
            ownedSubOrphanCat ||
            curCatKey === newCatKey ||
            !curCatKey ||
            curCatKey === 'uncategorized' ||
            !subNamesInOtherCats.has(curSubKey));
        if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return exp;
        const nextCat =
          matchesCat || ownedSubOrphanCat ? cleanNewCat : curCat || cleanNewCat;
        const nextSub = subMatchesScope && mappedSub ? mappedSub : curSub;
        const nextDesc =
          subMatchesScope &&
          mappedSub &&
          curDesc &&
          normalizeLabelKey(curDesc) === curSubKey
            ? mappedSub
            : exp.description;
        const nextColor =
          subMatchesScope && mappedSub
            ? renamedColorMap.get(normalizeLabelKey(mappedSub)) || exp.subcategoryColor
            : exp.subcategoryColor;
        if (
          nextCat !== curCat ||
          nextSub !== curSub ||
          nextDesc !== exp.description ||
          nextColor !== exp.subcategoryColor
        ) {
          const updatedExp: FlexibleExpense = {
            ...exp,
            category: nextCat,
            subcategory: nextSub || exp.subcategory,
            description: nextDesc,
            subcategoryColor: nextColor,
          };
          changedExpenses.push(updatedExp);
          return updatedExp;
        }
        return exp;
      });

      changedIncomes = [];
      nextIncomes = incomes.map((inc) => {
        if (!Array.isArray(inc.allocatedDeductions)) return inc;
        let changed = false;
        const nextDeds = inc.allocatedDeductions.map((d) => {
          const curCat = (d.expenseCategory || '').trim();
          const curSub = (d.expenseSubcategory || '').trim();
          const curCatKey = normalizeLabelKey(curCat);
          const curSubKey = normalizeLabelKey(curSub);
          const matchesCat = Boolean(oldCatKey) && curCatKey === oldCatKey;
          const ownedSubOrphanCat =
            categoryChanged &&
            Boolean(curSubKey) &&
            targetUniqueSubKeys.has(curSubKey) &&
            (!curCatKey ||
              curCatKey === 'uncategorized' ||
              !otherCategoryKeys.has(curCatKey));
          const mappedSub = subRenameLookup.get(curSubKey);
          const subMatchesScope =
            Boolean(mappedSub) &&
            (matchesCat ||
              ownedSubOrphanCat ||
              curCatKey === newCatKey ||
              !curCatKey ||
              !subNamesInOtherCats.has(curSubKey));
          if (!matchesCat && !ownedSubOrphanCat && !subMatchesScope) return d;
          const nextCat =
            matchesCat || ownedSubOrphanCat ? cleanNewCat : curCat || cleanNewCat;
          const nextSub = subMatchesScope && mappedSub ? mappedSub : curSub;
          if (nextCat !== curCat || nextSub !== curSub) {
            changed = true;
            return {
              ...d,
              expenseCategory: nextCat,
              expenseSubcategory: nextSub,
            };
          }
          return d;
        });
        if (changed) {
          const updatedInc: IncomeReceipt = {
            ...inc,
            allocatedDeductions: nextDeds,
            updatedAt: nowIso,
          };
          changedIncomes.push(updatedInc);
          return updatedInc;
        }
        return inc;
      });

      changedBudgets = [];
      nextBudgets = budgets.map((b) => {
        let bChanged = false;
        const nextSubs = dedupeList(
          (b.subcategories || []).map((s) => {
            const mapped = subRenameLookup.get(normalizeLabelKey(s));
            if (mapped && mapped !== s) {
              bChanged = true;
              return mapped;
            }
            return s;
          })
        );
        const nextCats = dedupeList(
          (b.categories || []).map((c) => {
            if (categoryChanged && normalizeLabelKey(c) === oldCatKey) {
              bChanged = true;
              return cleanNewCat;
            }
            return c;
          })
        );
        if (bChanged) {
          const updatedBudget: FinancialBudget = {
            ...b,
            subcategories: nextSubs,
            categories: nextCats.length > 0 ? nextCats : b.categories,
            updatedAt: nowIso,
          };
          changedBudgets.push(updatedBudget);
          return updatedBudget;
        }
        return b;
      });

      summary = {
        expensesUpdated: changedExpenses.length,
        incomesUpdated: changedIncomes.length,
        budgetsUpdated: changedBudgets.length,
        deductionRulesUpdated,
        totalRecordsUpdated:
          changedExpenses.length +
          changedIncomes.length +
          changedBudgets.length +
          deductionRulesUpdated,
      };
    }

    // 3. Atomically update React state and local storage so UI immediately reflects new names everywhere
    setSettings(updatedSettings);
    setExpenses(nextExpenses);
    setIncomes(nextIncomes);
    setBudgets(nextBudgets);

    setLocalData('settings', updatedSettings, effectiveUserId);
    setLocalData('expenses', nextExpenses, effectiveUserId);
    setLocalData('incomes', nextIncomes, effectiveUserId);
    setLocalData('budgets', nextBudgets, effectiveUserId);

    // 4. Persist affected records before settings so Firestore listeners never pair
    // updated categories with stale expense records
    if (currentUser) {
      const uid = currentUser.uid;
      syncAuthenticatedCloudSnapshotToBackend(uid, {
        settings: updatedSettings,
        expenses: nextExpenses,
        incomes: nextIncomes,
        budgets: nextBudgets,
      });
      try {
        const chunkSize = 10;
        for (let i = 0; i < changedExpenses.length; i += chunkSize) {
          await Promise.all(
            changedExpenses
              .slice(i, i + chunkSize)
              .map((exp) => saveFlexibleExpense(uid, exp))
          );
        }
        for (let i = 0; i < changedIncomes.length; i += chunkSize) {
          await Promise.all(
            changedIncomes
              .slice(i, i + chunkSize)
              .map((inc) => saveIncomeReceipt(uid, inc))
          );
        }
        for (let i = 0; i < changedBudgets.length; i += chunkSize) {
          await Promise.all(
            changedBudgets
              .slice(i, i + chunkSize)
              .map((bgt) => saveFinancialBudget(uid, bgt))
          );
        }
        await saveUserSettings(uid, updatedSettings!);
      } catch (err) {
        console.error('Category edit cascade persistence error:', err);
      }
    }

    return {
      settings: updatedSettings,
      summary,
    };
  };

  const handleDeleteExpense = async (expenseId: string) => {
    // Support deleting income deduction expense transactions (exp_ded_<incId>_<dedId>)
    if (expenseId.startsWith('exp_ded_')) {
      const parentIncome = incomes.find((inc) =>
        expenseId.startsWith(`exp_ded_${inc.id}_`)
      );
      if (parentIncome) {
        const prefix = `exp_ded_${parentIncome.id}_`;
        const dedId = expenseId.slice(prefix.length);
        const currentDeds = Array.isArray(parentIncome.allocatedDeductions)
          ? parentIncome.allocatedDeductions
          : getEffectiveIncomeDeductions(parentIncome, settings, expenses);
        const nextDeductions = currentDeds.filter((d) => d.id !== dedId);
        const totalDedAmt = nextDeductions.reduce(
          (sum, d) => sum + (Number(d.amount) || 0),
          0
        );
        const gross = Number(
          parentIncome.originalGrossAmount ?? parentIncome.grossAmount ?? 0
        );
        const nextSavingsRate =
          gross > 0
            ? Math.min(100, Math.round(((totalDedAmt / gross) * 100) * 100) / 100)
            : 0;

        const updatedIncome: IncomeReceipt = {
          ...parentIncome,
          allocatedDeductions: nextDeductions,
          savingsRate: nextSavingsRate,
          updatedAt: new Date().toISOString(),
        };

        const nextIncomes = incomes.map((inc) =>
          inc.id === updatedIncome.id ? updatedIncome : inc
        );
        setIncomes(nextIncomes);
        setLocalData('incomes', nextIncomes, effectiveUserId);

        fetch('/api/expenses/delete-deduction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expenseId,
            incomeReceipt: parentIncome,
          }),
        }).catch(() => {});

        (async () => {
          try {
            if (currentUser) {
              await saveIncomeReceipt(currentUser.uid, updatedIncome);
            }
          } catch (err) {
            console.error('Income deduction expense delete error:', err);
          }
        })();
        return;
      }
    }

    const nextExpenses = expenses.filter((e) => e.id !== expenseId);
    setExpenses(nextExpenses);
    setLocalData('expenses', nextExpenses, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await deleteFlexibleExpense(currentUser.uid, expenseId);
        }
      } catch (err) {
        console.error('Expense delete error:', err);
      }
    })();
  };

  const handleAddAccount = async (
    accountData: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    const newAcc: FinancialAccount = {
      ...accountData,
      id: `acc_${Date.now()}`,
      userId: effectiveUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const prevAccounts = accounts;
    const nextAccounts = accountData.isDefaultDeposit
      ? [...accounts.map((a) => ({ ...a, isDefaultDeposit: false })), newAcc]
      : [...accounts, newAcc];

    setAccounts(nextAccounts);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          if (accountData.isDefaultDeposit) {
            for (const a of prevAccounts) {
              if (a.isDefaultDeposit) {
                await saveFinancialAccount(effectiveUserId, {
                  ...a,
                  isDefaultDeposit: false,
                });
              }
            }
          }
          await saveFinancialAccount(effectiveUserId, newAcc);
        }
      } catch (err) {
        console.error('Account create persistence error:', err);
      }
    })();
  };

  const handleUpdateAccount = async (updatedAcc: FinancialAccount) => {
    const nextAccounts = accounts.map((a) => {
      if (a.id === updatedAcc.id) return updatedAcc;
      if (updatedAcc.isDefaultDeposit) return { ...a, isDefaultDeposit: false };
      return a;
    });
    setAccounts(nextAccounts);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveFinancialAccount(effectiveUserId, updatedAcc);
        }
      } catch (err) {
        console.error('Account update persistence error:', err);
      }
    })();
  };

  const handleDeleteAccount = async (id: string) => {
    const nextAccounts = accounts.filter((a) => a.id !== id);
    setAccounts(nextAccounts);
    setLocalData('accounts', nextAccounts, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await deleteFinancialAccount(effectiveUserId, id);
        }
      } catch (err) {
        console.error('Account delete persistence error:', err);
      }
    })();
  };

  const handleAddTransfer = async (
    transferData: Omit<AccountTransfer, 'id' | 'createdAt'>
  ) => {
    const newTransfer: AccountTransfer = {
      ...transferData,
      id: `trans_${Date.now()}`,
      userId: effectiveUserId,
      createdAt: new Date().toISOString(),
    };
    const nextTransfers = [newTransfer, ...transfers];
    setTransfers(nextTransfers);
    setLocalData('transfers', nextTransfers, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveAccountTransfer(effectiveUserId, newTransfer);
        }
      } catch (err) {
        console.error('Transfer save error:', err);
      }
    })();
  };

  const handleAddTransfers = async (
    transfersData: Omit<AccountTransfer, 'id' | 'createdAt'>[]
  ) => {
    if (transfersData.length === 0) return;
    const nowMs = Date.now();
    const newRecords: AccountTransfer[] = transfersData.map((t, index) => ({
      ...t,
      id: `trans_${nowMs}_${index}`,
      userId: effectiveUserId,
      createdAt: new Date(nowMs + index).toISOString(),
    }));
    const nextTransfers = [...newRecords, ...transfers];
    setTransfers(nextTransfers);
    setLocalData('transfers', nextTransfers, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          for (const rec of newRecords) {
            await saveAccountTransfer(effectiveUserId, rec);
          }
        }
      } catch (err) {
        console.error('Batch transfer save error:', err);
      }
    })();
  };

  const handleDeleteTransfer = async (id: string) => {
    const nextTransfers = transfers.filter((t) => t.id !== id);
    setTransfers(nextTransfers);
    setLocalData('transfers', nextTransfers, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await deleteAccountTransfer(effectiveUserId, id);
        }
      } catch (err) {
        console.error('Transfer delete error:', err);
      }
    })();
  };

  // Automatically reconcile budgets and goals when their active period elapses
  useEffect(() => {
    if (budgets.length === 0) return;
    const { nextBudgets, changedBudgets, hasChanges } =
      reconcileRecurringBudgets(budgets);
    if (!hasChanges) return;

    setBudgets(nextBudgets);
    setLocalData('budgets', nextBudgets, effectiveUserId);

    if (currentUser) {
      const uid = currentUser.uid;
      for (const cb of changedBudgets) {
        saveFinancialBudget(uid, cb).catch((err) =>
          console.error('Recurring budget rollover save error:', err)
        );
      }
    }
  }, [budgets, effectiveUserId, currentUser]);

  const handleSaveBudget = async (
    budgetData: Omit<FinancialBudget, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & {
      id?: string;
      createdAt?: string;
    }
  ) => {
    const nowIso = new Date().toISOString();
    const todayYmd = nowIso.split('T')[0];
    let activePeriodStart = budgetData.activePeriodStart;
    let activePeriodEnd = budgetData.activePeriodEnd;

    if (budgetData.periodType !== 'custom') {
      if (!activePeriodStart || !activePeriodEnd) {
        const bounds = computeRecurringPeriodBounds(budgetData.periodType);
        activePeriodStart = bounds.startYmd;
        activePeriodEnd = bounds.endYmd;
      }
    } else {
      activePeriodStart = budgetData.customStartDate || activePeriodStart;
      activePeriodEnd = budgetData.customEndDate || activePeriodEnd;
    }

    const isExpiredNow = Boolean(activePeriodEnd && todayYmd > activePeriodEnd);
    const shouldAutoRecreate = Boolean(budgetData.autoRecreate);

    const budgetWithUser: FinancialBudget = {
      ...budgetData,
      id: budgetData.id || `bgt_${Date.now()}`,
      userId: effectiveUserId,
      purposeType: budgetData.purposeType === 'goal' ? 'goal' : 'budget',
      activePeriodStart,
      activePeriodEnd,
      autoRecreate: shouldAutoRecreate,
      recreateDays:
        budgetData.recreateDays !== undefined && Number(budgetData.recreateDays) > 0
          ? Math.max(1, Math.round(Number(budgetData.recreateDays)))
          : undefined,
      isArchivedPeriod: false,
      isExpiredDisabled: isExpiredNow && !shouldAutoRecreate,
      createdAt: budgetData.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const exists = budgets.some((b) => b.id === budgetWithUser.id);
    const rawNextBudgets = exists
      ? budgets.map((b) => (b.id === budgetWithUser.id ? budgetWithUser : b))
      : [budgetWithUser, ...budgets];

    const reconciled = reconcileRecurringBudgets(rawNextBudgets);
    const finalBudgets = reconciled.hasChanges
      ? reconciled.nextBudgets
      : rawNextBudgets;

    setBudgets(finalBudgets);
    setLocalData('budgets', finalBudgets, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveFinancialBudget(effectiveUserId, budgetWithUser);
          if (reconciled.hasChanges) {
            for (const cb of reconciled.changedBudgets) {
              await saveFinancialBudget(effectiveUserId, cb);
            }
          }
        }
      } catch (err) {
        console.error('Budget save error:', err);
      }
    })();
  };

  const handleDeleteBudget = async (budgetId: string) => {
    const nextBudgets = budgets.filter((b) => b.id !== budgetId);
    setBudgets(nextBudgets);
    setLocalData('budgets', nextBudgets, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await deleteFinancialBudget(effectiveUserId, budgetId);
        }
      } catch (err) {
        console.error('Budget delete error:', err);
      }
    })();
  };

  const handleImportRecords = async (payload: {
    incomes: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>[];
    expenses: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[];
    accounts: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt'>[];
    transfers: Omit<AccountTransfer, 'id' | 'createdAt'>[];
  }) => {
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();

    const newAccounts: FinancialAccount[] = (payload.accounts || []).map(
      (acc, i) => ({
        ...acc,
        id: `acc_imp_${nowMs}_${i}`,
        userId: effectiveUserId,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    );

    const newIncomes: IncomeReceipt[] = (payload.incomes || []).map((inc, i) => {
      const deds =
        inc.allocatedDeductions && inc.allocatedDeductions.length > 0
          ? inc.allocatedDeductions
          : buildDefaultDeductionsForIncome(
              inc.grossAmount,
              settings,
              expenses,
              inc.date
            );
      const totalDed = deds.reduce((s, d) => s + d.amount, 0);
      const computedRate =
        inc.grossAmount > 0
          ? Math.min(100, Math.round(((totalDed / inc.grossAmount) * 100) * 10) / 10)
          : 0;
      return {
        ...inc,
        id: `inc_imp_${nowMs}_${i}`,
        userId: effectiveUserId,
        allocatedDeductions: deds,
        savingsRate: inc.savingsRate || computedRate,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    });

    const newExpenses: FlexibleExpense[] = (payload.expenses || []).map(
      (exp, i) => {
        const subColor = exp.subcategory
          ? resolveIntuitiveSubcategoryColor(
              exp.subcategory,
              exp.category,
              settings,
              expenses
            )
          : undefined;
        return {
          ...exp,
          id: `exp_imp_${nowMs}_${i}`,
          userId: effectiveUserId,
          subcategoryColor: exp.subcategoryColor || subColor,
          createdAt: nowIso,
        };
      }
    );

    const newTransfers: AccountTransfer[] = (payload.transfers || []).map(
      (tr, i) => ({
        ...tr,
        id: `trans_imp_${nowMs}_${i}`,
        userId: effectiveUserId,
        createdAt: nowIso,
      })
    );

    if (newAccounts.length > 0) {
      const nextAccounts = [...accounts, ...newAccounts];
      setAccounts(nextAccounts);
      setLocalData('accounts', nextAccounts, effectiveUserId);
    }
    if (newIncomes.length > 0) {
      const nextIncomes = [...newIncomes, ...incomes];
      setIncomes(nextIncomes);
      setLocalData('incomes', nextIncomes, effectiveUserId);
    }
    if (newExpenses.length > 0) {
      const nextExpenses = [...newExpenses, ...expenses];
      setExpenses(nextExpenses);
      setLocalData('expenses', nextExpenses, effectiveUserId);
    }
    if (newTransfers.length > 0) {
      const nextTransfers = [...newTransfers, ...transfers];
      setTransfers(nextTransfers);
      setLocalData('transfers', nextTransfers, effectiveUserId);
    }

    if (currentUser) {
      const uid = currentUser.uid;
      const runInChunks = async <T,>(
        items: T[],
        worker: (item: T) => Promise<void>,
        chunkSize = 25
      ) => {
        for (let i = 0; i < items.length; i += chunkSize) {
          await Promise.all(items.slice(i, i + chunkSize).map(worker));
        }
      };
      await runInChunks(newAccounts, (acc) => saveFinancialAccount(uid, acc));
      await runInChunks(newIncomes, (inc) => saveIncomeReceipt(uid, inc));
      await runInChunks(newExpenses, (exp) => saveFlexibleExpense(uid, exp));
      await runInChunks(newTransfers, (tr) => saveAccountTransfer(uid, tr));
    }
  };

  const handleApplyDriveAlignment = async (
    payload: DriveAlignmentApprovalPayload
  ): Promise<{ addedCount: number; updatedCount: number }> => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const rand = Math.random().toString(36).slice(2, 6);

    const newIncomes: IncomeReceipt[] = (payload.additions.incomes || []).map(
      (inc, idx) => {
        const deds =
          inc.allocatedDeductions && inc.allocatedDeductions.length > 0
            ? inc.allocatedDeductions
            : buildDefaultDeductionsForIncome(
                inc.grossAmount,
                settings,
                expenses,
                inc.date
              );
        const totalDed = deds.reduce((s, d) => s + d.amount, 0);
        const computedRate =
          inc.grossAmount > 0
            ? Math.min(100, Math.round(((totalDed / inc.grossAmount) * 100) * 10) / 10)
            : 0;
        return buildStampedIncomeReceipt(
          {
            ...inc,
            allocatedDeductions: deds,
            savingsRate: inc.savingsRate || computedRate,
          },
          nowMs,
          idx
        );
      }
    );

    const newExpenses: FlexibleExpense[] = (payload.additions.expenses || []).map(
      (exp, idx) => {
        const subColor = exp.subcategory
          ? resolveIntuitiveSubcategoryColor(
              exp.subcategory,
              exp.category,
              settings,
              expenses
            )
          : undefined;
        return {
          ...exp,
          id: `exp_drv_${nowMs}_${idx}_${rand}`,
          userId: effectiveUserId,
          subcategoryColor: exp.subcategoryColor || subColor,
          createdAt: new Date(nowMs + idx).toISOString(),
        };
      }
    );

    const newTransfers: AccountTransfer[] = (payload.additions.transfers || []).map(
      (tr, idx) => ({
        ...tr,
        id: `trans_drv_${nowMs}_${idx}_${rand}`,
        userId: effectiveUserId,
        createdAt: new Date(nowMs + idx).toISOString(),
      })
    );

    const incomeUpdateMap = new Map(
      (payload.updates.incomes || []).map((u) => [u.id, u.patch])
    );
    const expenseUpdateMap = new Map(
      (payload.updates.expenses || []).map((u) => [u.id, u.patch])
    );
    const transferUpdateMap = new Map(
      (payload.updates.transfers || []).map((u) => [u.id, u.patch])
    );

    const updatedIncomesToPersist: IncomeReceipt[] = [];
    const updatedExpensesToPersist: FlexibleExpense[] = [];
    const updatedTransfersToPersist: AccountTransfer[] = [];

    const nextIncomesList: IncomeReceipt[] =
      newIncomes.length > 0 || incomeUpdateMap.size > 0
        ? [
            ...newIncomes,
            ...incomes.map((inc) => {
              const patch = incomeUpdateMap.get(inc.id);
              if (!patch) return inc;
              const nextRec: IncomeReceipt = {
                ...inc,
                ...patch,
                id: inc.id,
                userId: inc.userId || effectiveUserId,
                createdAt: inc.createdAt,
                updatedAt: nowIso,
              };
              updatedIncomesToPersist.push(nextRec);
              return nextRec;
            }),
          ]
        : incomes;

    const nextExpensesList: FlexibleExpense[] =
      newExpenses.length > 0 || expenseUpdateMap.size > 0
        ? [
            ...newExpenses,
            ...expenses.map((exp) => {
              const patch = expenseUpdateMap.get(exp.id);
              if (!patch) return exp;
              const nextCat = patch.category ?? exp.category;
              const nextSub =
                patch.subcategory !== undefined ? patch.subcategory : exp.subcategory;
              const subColor = nextSub
                ? resolveIntuitiveSubcategoryColor(nextSub, nextCat, settings, expenses)
                : undefined;
              const nextRec: FlexibleExpense = {
                ...exp,
                ...patch,
                id: exp.id,
                userId: exp.userId || effectiveUserId,
                subcategoryColor: subColor || exp.subcategoryColor,
                createdAt: exp.createdAt,
              };
              updatedExpensesToPersist.push(nextRec);
              return nextRec;
            }),
          ]
        : expenses;

    const nextTransfersList: AccountTransfer[] =
      newTransfers.length > 0 || transferUpdateMap.size > 0
        ? [
            ...newTransfers,
            ...transfers.map((tr) => {
              const patch = transferUpdateMap.get(tr.id);
              if (!patch) return tr;
              const nextRec: AccountTransfer = {
                ...tr,
                ...patch,
                id: tr.id,
                userId: tr.userId || effectiveUserId,
                createdAt: tr.createdAt,
              };
              updatedTransfersToPersist.push(nextRec);
              return nextRec;
            }),
          ]
        : transfers;

    const updatedIncomesById = new Map(
      updatedIncomesToPersist.map((rec) => [rec.id, rec])
    );
    const updatedExpensesById = new Map(
      updatedExpensesToPersist.map((rec) => [rec.id, rec])
    );
    const updatedTransfersById = new Map(
      updatedTransfersToPersist.map((rec) => [rec.id, rec])
    );

    if (newIncomes.length > 0 || updatedIncomesById.size > 0) {
      setIncomes((prev) => {
        const merged = [
          ...newIncomes,
          ...prev.map((inc) => updatedIncomesById.get(inc.id) || inc),
        ];
        setLocalData('incomes', merged, effectiveUserId);
        return merged;
      });
    }

    if (newExpenses.length > 0 || updatedExpensesById.size > 0) {
      setExpenses((prev) => {
        const merged = [
          ...newExpenses,
          ...prev.map((exp) => updatedExpensesById.get(exp.id) || exp),
        ];
        setLocalData('expenses', merged, effectiveUserId);
        return merged;
      });
    }

    if (newTransfers.length > 0 || updatedTransfersById.size > 0) {
      setTransfers((prev) => {
        const merged = [
          ...newTransfers,
          ...prev.map((tr) => updatedTransfersById.get(tr.id) || tr),
        ];
        setLocalData('transfers', merged, effectiveUserId);
        return merged;
      });
    }

    if (currentUser) {
      const uid = currentUser.uid;
      await Promise.all([
        ...newIncomes.map((inc) => saveIncomeReceipt(uid, inc)),
        ...updatedIncomesToPersist.map((inc) => saveIncomeReceipt(uid, inc)),
        ...newExpenses.map((exp) => saveFlexibleExpense(uid, exp)),
        ...updatedExpensesToPersist.map((exp) => saveFlexibleExpense(uid, exp)),
        ...newTransfers.map((tr) => saveAccountTransfer(uid, tr)),
        ...updatedTransfersToPersist.map((tr) => saveAccountTransfer(uid, tr)),
      ]);

      syncAuthenticatedCloudSnapshotToBackend(uid, {
        ...(newIncomes.length > 0 || updatedIncomesToPersist.length > 0
          ? { incomes: nextIncomesList }
          : {}),
        ...(newExpenses.length > 0 || updatedExpensesToPersist.length > 0
          ? { expenses: nextExpensesList }
          : {}),
        ...(newTransfers.length > 0 || updatedTransfersToPersist.length > 0
          ? { transfers: nextTransfersList }
          : {}),
      });
    }

    return {
      addedCount: newIncomes.length + newExpenses.length + newTransfers.length,
      updatedCount:
        updatedIncomesToPersist.length +
        updatedExpensesToPersist.length +
        updatedTransfersToPersist.length,
    };
  };

  // Detect records imported specifically on 24/11/2026 (Drive Alignment or File Import)
  const nov24Imported = useMemo(
    () => findNov24ImportedTransactions({ incomes, expenses, transfers }),
    [incomes, expenses, transfers]
  );

  const handleRestoreToNov23 = useCallback(async () => {
    const detected = findNov24ImportedTransactions({
      incomes,
      expenses,
      transfers,
    });
    if (detected.totalCount === 0) {
      return {
        removedIncomes: 0,
        removedExpenses: 0,
        removedTransfers: 0,
        totalRemoved: 0,
      };
    }

    setIsRestoringNov23(true);
    try {
      const incomeIdSet = new Set(detected.incomeIds);
      const expenseIdSet = new Set(detected.expenseIds);
      const transferIdSet = new Set(detected.transferIds);

      const nextIncomes = incomes.filter((rec) => !incomeIdSet.has(rec.id));
      const nextExpenses = expenses.filter((rec) => !expenseIdSet.has(rec.id));
      const nextTransfers = transfers.filter((rec) => !transferIdSet.has(rec.id));

      if (currentUser) {
        await batchDeleteTransactions(currentUser.uid, {
          incomeIds: detected.incomeIds,
          expenseIds: detected.expenseIds,
          transferIds: detected.transferIds,
        });
      }

      setIncomes(nextIncomes);
      setExpenses(nextExpenses);
      setTransfers(nextTransfers);

      setLocalData('incomes', nextIncomes, effectiveUserId);
      setLocalData('expenses', nextExpenses, effectiveUserId);
      setLocalData('transfers', nextTransfers, effectiveUserId);

      clearWorkflowState('drive_alignment', effectiveUserId);
      clearWorkflowState('settings_import', effectiveUserId);

      if (currentUser) {
        await syncAuthenticatedCloudSnapshotToBackend(
          currentUser.uid,
          {
            incomes: nextIncomes,
            expenses: nextExpenses,
            transfers: nextTransfers,
          },
          true
        );
      }

      setNov24ConfirmBanner(false);
      setNov24RestoreNotice(
        `Restored transactions to ${RESTORE_TARGET_DATE_LABEL}. Removed ${detected.totalCount} ${
          detected.totalCount === 1 ? 'record' : 'records'
        } imported on ${IMPORT_PURGE_DATE_LABEL}.`
      );

      return {
        removedIncomes: detected.incomeIds.length,
        removedExpenses: detected.expenseIds.length,
        removedTransfers: detected.transferIds.length,
        totalRemoved: detected.totalCount,
      };
    } finally {
      setIsRestoringNov23(false);
    }
  }, [incomes, expenses, transfers, currentUser, effectiveUserId]);

  // Filtered collections corresponding to the active date selection
  const filteredIncomes = useMemo(() => {
    if (timeRange === 'all') return incomes;
    return incomes.filter((inc) =>
      isDateInPreset(inc.date, timeRange, undefined, customDateRange)
    );
  }, [incomes, timeRange, customDateRange]);

  const filteredExpenses = useMemo(() => {
    if (timeRange === 'all') return expenses;
    return expenses.filter((exp) =>
      isDateInPreset(exp.date, timeRange, undefined, customDateRange)
    );
  }, [expenses, timeRange, customDateRange]);

  const filteredTransfers = useMemo(() => {
    if (timeRange === 'all') return transfers;
    return transfers.filter((t) =>
      isDateInPreset(t.date, timeRange, undefined, customDateRange)
    );
  }, [transfers, timeRange, customDateRange]);

  // Active accounts combining operating accounts + active savings vaults from settings
  const activeAccounts = useMemo(() => {
    const effectivePillars = getEffectiveSavingsPillars(settings);
    const activeVaultIds = new Set(effectivePillars.map((p) => p.accountId));
    const rawOperatingList = accounts.filter(
      (a) => !isSavingsVaultAccount(a, settings) && !activeVaultIds.has(a.id)
    );
    const operatingList =
      rawOperatingList.length > 0
        ? rawOperatingList
        : [
            {
              ...DEFAULT_FINANCIAL_ACCOUNTS[0],
              userId: effectiveUserId,
            },
          ];
    const defaultOpId =
      operatingList.find((a) => !a.isVirtual && a.isDefaultDeposit)?.id ||
      operatingList.find((a) => !a.isVirtual)?.id ||
      operatingList.find((a) => a.isDefaultDeposit)?.id ||
      operatingList[0]?.id ||
      'acc-main-op';

    const vaultList: FinancialAccount[] = effectivePillars.map((pillar) => {
      const existing = accounts.find((a) => a.id === pillar.accountId);
      const custodianId =
        settings.vaultCustodianAccounts?.[pillar.accountId] ||
        pillar.custodianAccountId ||
        existing?.custodianAccountId ||
        defaultOpId;
      return existing
        ? {
            ...existing,
            name: pillar.name,
            type: 'Savings',
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
          }
        : {
            id: pillar.accountId,
            userId: effectiveUserId,
            name: pillar.name,
            type: 'Savings',
            institution: 'Savings Vault',
            initialBalance: 0,
            color: pillar.color,
            description: `${pillar.percentage}% savings allocation vault`,
            isDefaultDeposit: false,
            isVirtual: pillar.isVirtual,
            linkedSavingsBucketId: pillar.bucketId,
            custodianAccountId: custodianId,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          };
    });

    return [...operatingList, ...vaultList];
  }, [accounts, settings, effectiveUserId]);

  // Accounts adjusted for date range selection
  const filteredAccounts = useMemo(() => {
    if (timeRange === 'all') return activeAccounts;
    return activeAccounts.map((acc) => ({
      ...acc,
      initialBalance: isDateInPreset(acc.createdAt, timeRange, undefined, customDateRange)
        ? acc.initialBalance
        : 0,
    }));
  }, [activeAccounts, timeRange, customDateRange]);

  const budgetAlertsCount = useMemo(() => {
    const evaluations = evaluateAllBudgets(
      budgets,
      expenses,
      incomes,
      activeAccounts,
      settings,
      undefined,
      new Date(),
      false,
      transfers
    );
    return evaluations.filter(
      (ev) =>
        !ev.isDisabledFromReach &&
        ev.purposeType !== 'goal' &&
        (ev.status === 'exceeded' ||
          ev.status === 'at_limit' ||
          ev.status === 'warning')
    ).length;
  }, [budgets, expenses, incomes, activeAccounts, settings, transfers]);

  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeAbortedRef = useRef(false);

  const activeNavIndex = useMemo(
    () => BOTTOM_NAV_ITEMS.findIndex((item) => item.id === activeTab),
    [activeTab]
  );

  const navUserId = currentUser?.uid || 'guest_user';

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    timeRangeRef.current = timeRange;
  }, [timeRange]);

  useEffect(() => {
    customDateRangeRef.current = customDateRange;
  }, [customDateRange]);

  useEffect(() => {
    driveOpenRef.current = isDriveAlignmentOpen;
  }, [isDriveAlignmentOpen]);

  const flushNavigationState = useCallback(
    (
      tabOverride?: ActiveTab,
      rangeOverride?: TimeRangePreset,
      driveOpenOverride?: boolean,
      customRangeOverride?: CustomDateRange
    ) => {
      if (mainScrollRef.current) {
        scrollByTabRef.current[activeTabRef.current] =
          mainScrollRef.current.scrollTop;
      }
      const nextTab = tabOverride ?? activeTabRef.current;
      const nextRange = rangeOverride ?? timeRangeRef.current;
      const nextCustomRange = customRangeOverride ?? customDateRangeRef.current;
      const nextDriveOpen =
        driveOpenOverride !== undefined
          ? driveOpenOverride
          : driveOpenRef.current;
      savePersistedNavigationState(navUserId, {
        activeTab: nextTab,
        timeRange: nextRange,
        customDateRange: nextCustomRange,
        isDriveAlignmentOpen: nextTab === 'settings' && nextDriveOpen,
        scrollByTab: { ...scrollByTabRef.current },
        updatedAt: Date.now(),
      });
    },
    [navUserId]
  );

  // Seed browser history entry on initial mount and restore state cleanly on Back/Forward navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!parseHistoryStateSnapshot(window.history.state)) {
      try {
        window.history.replaceState(
          buildHistoryStateSnapshot(
            activeTabRef.current,
            timeRangeRef.current,
            driveOpenRef.current,
            customDateRangeRef.current
          ),
          ''
        );
      } catch {
        // Ignore restricted history API contexts
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      const snap = parseHistoryStateSnapshot(event.state);
      if (!snap) return;
      if (mainScrollRef.current) {
        scrollByTabRef.current[activeTabRef.current] =
          mainScrollRef.current.scrollTop;
      }
      const nextCustomRange = snap.customDateRange || {
        startDate: '',
        endDate: '',
      };
      startTransition(() => {
        setActiveTab(snap.activeTab);
        setTimeRange(snap.timeRange);
        setCustomDateRange(nextCustomRange);
        setIsDriveAlignmentOpen(
          snap.activeTab === 'settings' && Boolean(snap.isDriveAlignmentOpen)
        );
      });
      setIsMenuOpen(false);
      setIsMobileDateFilterOpen(false);
      savePersistedNavigationState(navUserId, {
        activeTab: snap.activeTab,
        timeRange: snap.timeRange,
        customDateRange: nextCustomRange,
        isDriveAlignmentOpen:
          snap.activeTab === 'settings' && Boolean(snap.isDriveAlignmentOpen),
        scrollByTab: { ...scrollByTabRef.current },
        updatedAt: Date.now(),
      });
    };

    const handleVisibilityOrHide = () => {
      if (
        document.visibilityState === 'hidden' ||
        document.visibilityState === undefined
      ) {
        flushNavigationState();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pagehide', handleVisibilityOrHide);
    document.addEventListener('visibilitychange', handleVisibilityOrHide);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pagehide', handleVisibilityOrHide);
      document.removeEventListener('visibilitychange', handleVisibilityOrHide);
    };
  }, [navUserId, flushNavigationState]);

  const navigateToTab = useCallback(
    (nextTab: ActiveTab) => {
      if (mainScrollRef.current) {
        scrollByTabRef.current[activeTabRef.current] =
          mainScrollRef.current.scrollTop;
      }
      const nextDriveOpen = nextTab === 'settings' ? driveOpenRef.current : false;
      const changed =
        nextTab !== activeTabRef.current ||
        nextDriveOpen !== driveOpenRef.current;

      startTransition(() => {
        setActiveTab(nextTab);
        if (nextTab !== 'settings') {
          setIsDriveAlignmentOpen(false);
        }
      });

      if (changed && typeof window !== 'undefined') {
        try {
          window.history.pushState(
            buildHistoryStateSnapshot(
              nextTab,
              timeRangeRef.current,
              nextDriveOpen,
              customDateRangeRef.current
            ),
            ''
          );
        } catch {
          // Ignore restricted history contexts
        }
      }
      flushNavigationState(
        nextTab,
        timeRangeRef.current,
        nextDriveOpen,
        customDateRangeRef.current
      );
    },
    [flushNavigationState]
  );

  const selectTimeRange = useCallback(
    (nextRange: TimeRangePreset) => {
      const changed = nextRange !== timeRangeRef.current;
      let nextCustomRange = customDateRangeRef.current;
      if (
        nextRange === 'custom' &&
        !nextCustomRange.startDate &&
        !nextCustomRange.endDate
      ) {
        const today = new Date().toISOString().substring(0, 10);
        nextCustomRange = {
          startDate: `${today.slice(0, 8)}01`,
          endDate: today,
        };
      }
      startTransition(() => {
        setTimeRange(nextRange);
        if (nextRange === 'custom') {
          setCustomDateRange(nextCustomRange);
        }
      });
      if (changed && typeof window !== 'undefined') {
        try {
          window.history.pushState(
            buildHistoryStateSnapshot(
              activeTabRef.current,
              nextRange,
              driveOpenRef.current,
              nextCustomRange
            ),
            ''
          );
        } catch {
          // Ignore restricted history contexts
        }
      }
      flushNavigationState(
        activeTabRef.current,
        nextRange,
        driveOpenRef.current,
        nextCustomRange
      );
    },
    [flushNavigationState]
  );

  const handleCustomDateRangeChange = useCallback(
    (nextRange: CustomDateRange) => {
      startTransition(() => {
        setCustomDateRange(nextRange);
        if (timeRangeRef.current !== 'custom') {
          setTimeRange('custom');
        }
      });
      if (typeof window !== 'undefined') {
        try {
          window.history.replaceState(
            buildHistoryStateSnapshot(
              activeTabRef.current,
              'custom',
              driveOpenRef.current,
              nextRange
            ),
            ''
          );
        } catch {
          // Ignore restricted history contexts
        }
      }
      flushNavigationState(
        activeTabRef.current,
        'custom',
        driveOpenRef.current,
        nextRange
      );
    },
    [flushNavigationState]
  );

  const handleDriveAlignmentOpenChange = useCallback(
    (open: boolean) => {
      const changed = open !== driveOpenRef.current;
      setIsDriveAlignmentOpen(open);
      if (changed && typeof window !== 'undefined') {
        try {
          window.history.pushState(
            buildHistoryStateSnapshot(
              activeTabRef.current,
              timeRangeRef.current,
              open,
              customDateRangeRef.current
            ),
            ''
          );
        } catch {
          // Ignore restricted history contexts
        }
      }
      flushNavigationState(
        activeTabRef.current,
        timeRangeRef.current,
        open,
        customDateRangeRef.current
      );
    },
    [flushNavigationState]
  );

  // Restore saved scroll position when returning to a previously visited view
  useEffect(() => {
    const savedScroll = scrollByTabRef.current[activeTab] ?? 0;
    const rafId = requestAnimationFrame(() => {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTop = savedScroll;
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeTab]);

  const handleWorkspaceScroll = useCallback(() => {
    if (!mainScrollRef.current) return;
    scrollByTabRef.current[activeTabRef.current] = mainScrollRef.current.scrollTop;
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = window.setTimeout(() => {
      flushNavigationState();
      scrollSaveTimerRef.current = null;
    }, 250);
  }, [flushNavigationState]);

  const shouldIgnoreWorkspaceSwipe = (
    target: EventTarget | null
  ): boolean => {
    // Ignore swipes when any pop-up modal or drawer is open
    if (
      isMenuOpen ||
      Boolean(editingExpense) ||
      isDeductionAgentOpen ||
      isCleanSheetModalOpen ||
      isDriveAlignmentOpen
    ) {
      return true;
    }
    if (!(target instanceof HTMLElement)) return false;
    if (
      target.closest(
        'button, a, input, textarea, select, label, [contenteditable="true"], [role="dialog"], .fixed.inset-0, [data-no-swipe]'
      )
    ) {
      return true;
    }
    let el: HTMLElement | null = target;
    while (el && el !== mainScrollRef.current) {
      const style = window.getComputedStyle(el);
      const overflowX = style.overflowX;
      if (
        (overflowX === 'auto' || overflowX === 'scroll') &&
        el.scrollWidth > el.clientWidth + 6
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  const handleWorkspaceTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || shouldIgnoreWorkspaceSwipe(e.target)) {
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
      swipeAbortedRef.current = true;
      return;
    }
    swipeStartXRef.current = e.touches[0].clientX;
    swipeStartYRef.current = e.touches[0].clientY;
    swipeAbortedRef.current = false;
  };

  const handleWorkspaceTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (
      swipeAbortedRef.current ||
      swipeStartXRef.current === null ||
      swipeStartYRef.current === null ||
      e.touches.length !== 1
    ) {
      return;
    }
    const dx = e.touches[0].clientX - swipeStartXRef.current;
    const dy = e.touches[0].clientY - swipeStartYRef.current;

    // If user is scrolling vertically, immediately abort horizontal swipe tracking for rock-solid vertical scroll
    if (Math.abs(dy) > 18 && Math.abs(dy) >= Math.abs(dx) * 0.75) {
      swipeAbortedRef.current = true;
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
    }
  };

  const handleWorkspaceTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (
      swipeAbortedRef.current ||
      swipeStartXRef.current === null ||
      swipeStartYRef.current === null ||
      e.changedTouches.length === 0
    ) {
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
      swipeAbortedRef.current = false;
      return;
    }
    const dx = e.changedTouches[0].clientX - swipeStartXRef.current;
    const dy = e.changedTouches[0].clientY - swipeStartYRef.current;

    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeAbortedRef.current = false;

    // Require an intentional, predominantly horizontal swipe and clamp strictly at BOTTOM_NAV_ITEMS boundaries
    if (Math.abs(dx) >= 75 && Math.abs(dy) < 48 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (activeNavIndex >= 0 && dx < 0 && activeNavIndex < BOTTOM_NAV_ITEMS.length - 1) {
        // Slide left -> next bottom menu option (skips Sidebar-only Budgets/Settings)
        navigateToTab(BOTTOM_NAV_ITEMS[activeNavIndex + 1].id);
      } else if (dx > 0 && activeNavIndex > 0) {
        // Slide right -> previous bottom menu option (skips Sidebar-only Budgets/Settings)
        navigateToTab(BOTTOM_NAV_ITEMS[activeNavIndex - 1].id);
      }
    }
  };

  const handleWorkspaceTouchCancel = () => {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeAbortedRef.current = false;
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-500 font-mono text-xs">
        Loading...
      </div>
    );
  }

  if (isAppLocked) {
    return (
      <BiometricLockScreen
        onUnlocked={() => setIsAppLocked(false)}
        userDisplayName={
          currentUser?.displayName || currentUser?.email || undefined
        }
      />
    );
  }

  return (
    <div className="h-screen w-full max-w-full overflow-hidden bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Static Top Header & Collapsible Mobile Date Filter (Locked at Top of Viewport) */}
      <div className="shrink-0 z-40 bg-white/95 backdrop-blur-md shadow-2xs">
        <div
          className="h-1 w-full transition-colors duration-200"
          style={{ backgroundColor: 'var(--app-accent)' }}
        />
        <Header
          activeTab={activeTab}
          onSelectTab={navigateToTab}
          isSidebarOpen={isMenuOpen}
          onToggleSidebar={() => setIsMenuOpen((prev) => !prev)}
          timeRange={timeRange}
          customDateRange={customDateRange}
          onSelectTimeRange={selectTimeRange}
          isMobileDateFilterOpen={isMobileDateFilterOpen}
          onToggleMobileDateFilter={() =>
            setIsMobileDateFilterOpen((prev) => !prev)
          }
        />

        <Navigation
          timeRange={timeRange}
          customDateRange={customDateRange}
          onSelectTimeRange={(range) => {
            selectTimeRange(range);
            setIsMobileDateFilterOpen(false);
          }}
          onCustomDateRangeChange={handleCustomDateRangeChange}
          recordCounts={{
            incomes: filteredIncomes.length,
            expenses: filteredExpenses.length,
            transfers: filteredTransfers.length,
          }}
          isOpenOnMobile={isMobileDateFilterOpen}
        />
      </div>

      {/* Collapsible Top-Right Menu Drawer */}
      <Sidebar
        isOpen={isMenuOpen}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          navigateToTab(tab);
          setIsMenuOpen(false);
        }}
        onClose={() => setIsMenuOpen(false)}
        themeMode={settings.themeMode || getPersistedThemeMode()}
        onThemeModeChange={handleThemeModeChange}
        colorTheme={settings.colorTheme || getPersistedColorTheme()}
        onColorThemeChange={handleColorThemeChange}
        timeRange={timeRange}
        customDateRange={customDateRange}
        onSelectTimeRange={selectTimeRange}
        onCustomDateRangeChange={handleCustomDateRangeChange}
        accountsCount={activeAccounts.length}
        budgetsCount={
          budgets.filter((b) => !b.isArchivedPeriod && !b.isExpiredDisabled)
            .length
        }
        budgetAlertsCount={budgetAlertsCount}
        onReset={() => setIsCleanSheetModalOpen(true)}
      />

      {/* Scrollable Main Workspace In-Between Static Top Header and Static Bottom Menu Bar */}
      <div
        ref={mainScrollRef}
        onScroll={handleWorkspaceScroll}
        onTouchStart={handleWorkspaceTouchStart}
        onTouchMove={handleWorkspaceTouchMove}
        onTouchEnd={handleWorkspaceTouchEnd}
        onTouchCancel={handleWorkspaceTouchCancel}
        className="flex-1 w-full overflow-y-auto overflow-x-hidden overscroll-y-contain scroll-smooth"
      >
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <main className="w-full min-w-0">
            {nov24RestoreNotice && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                <span className="font-medium">{nov24RestoreNotice}</span>
                <button
                  type="button"
                  onClick={() => setNov24RestoreNotice(null)}
                  className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            )}

            {nov24Imported.totalCount > 0 && !nov24BannerDismissed && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-950">
                <div className="min-w-0">
                  <span className="font-semibold">
                    {nov24Imported.totalCount}{' '}
                    {nov24Imported.totalCount === 1 ? 'record' : 'records'} imported on{' '}
                    {IMPORT_PURGE_DATE_LABEL}
                  </span>{' '}
                  <span className="text-amber-800">
                    ({nov24Imported.incomeIds.length} income ·{' '}
                    {nov24Imported.expenseIds.length} expenses ·{' '}
                    {nov24Imported.transferIds.length} transfers). Restore transactions to{' '}
                    {RESTORE_TARGET_DATE_LABEL} without affecting manual entries.
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {nov24ConfirmBanner ? (
                    <>
                      <button
                        type="button"
                        disabled={isRestoringNov23}
                        onClick={() => {
                          void handleRestoreToNov23();
                        }}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        {isRestoringNov23 ? 'Restoring...' : 'Confirm Remove'}
                      </button>
                      <button
                        type="button"
                        disabled={isRestoringNov23}
                        onClick={() => setNov24ConfirmBanner(false)}
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setNov24ConfirmBanner(true)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                      >
                        Restore to {RESTORE_TARGET_DATE_LABEL}
                      </button>
                      {activeTab !== 'settings' && (
                        <button
                          type="button"
                          onClick={() => navigateToTab('settings')}
                          className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                        >
                          Review
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setNov24BannerDismissed(true)}
                        className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'dashboard' && (
              <DashboardView
                incomes={filteredIncomes}
                expenses={filteredExpenses}
                accounts={filteredAccounts}
                transfers={filteredTransfers}
                settings={settings}
                currency={settings.currency}
                timeRange={timeRange}
                onSelectTimeRange={selectTimeRange}
                onNavigateToTab={navigateToTab}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onDeleteExpense={handleDeleteExpense}
                onDeleteIncome={handleDeleteIncome}
              />
            )}

            {activeTab === 'income_log' && (
              <IncomeLogView
                incomes={filteredIncomes}
                expenses={expenses}
                transfers={filteredTransfers}
                settings={settings}
                accounts={filteredAccounts}
                currency={settings.currency}
                timeRange={timeRange}
                customDateRange={customDateRange}
                onResetTimeRange={() => selectTimeRange('all')}
                onOpenCustomDateFilter={() => selectTimeRange('custom')}
                onAddIncome={handleAddIncome}
                onAddIncomes={handleAddIncomes}
                onUpdateIncome={handleUpdateIncome}
                onDeleteIncome={handleDeleteIncome}
                onAddExpenses={handleAddExpenses}
                onAddAccount={handleAddAccount}
                onSaveSettings={handleSaveSettings}
                onNavigateToSettings={() => navigateToTab('settings')}
                onOpenDeductionAgent={() => setIsDeductionAgentOpen(true)}
                expandFormTrigger={expandIncomeTrigger}
              />
            )}

            {activeTab === 'flexible_expenses' && (
              <FlexibleExpensesView
                expenses={filteredExpenses}
                incomes={filteredIncomes}
                transfers={filteredTransfers}
                settings={settings}
                accounts={filteredAccounts}
                budgets={budgets}
                currency={settings.currency}
                timeRange={timeRange}
                customDateRange={customDateRange}
                onResetTimeRange={() => selectTimeRange('all')}
                onOpenCustomDateFilter={() => selectTimeRange('custom')}
                onAddExpenses={handleAddExpenses}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onMoveSubcategory={handleMoveSubcategory}
                onNavigateToTab={navigateToTab}
                expandFormTrigger={expandExpenseTrigger}
              />
            )}

            {activeTab === 'budgets' && (
              <BudgetsView
                budgets={budgets}
                expenses={expenses}
                incomes={incomes}
                transfers={transfers}
                accounts={activeAccounts}
                settings={settings}
                currency={settings.currency}
                onSaveBudget={handleSaveBudget}
                onDeleteBudget={handleDeleteBudget}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onDeleteExpense={handleDeleteExpense}
                onNavigateToTab={navigateToTab}
              />
            )}

            {activeTab === 'accounts' && (
              <AccountsView
                accounts={filteredAccounts}
                transfers={filteredTransfers}
                incomes={filteredIncomes}
                expenses={filteredExpenses}
                settings={settings}
                currency={settings.currency}
                onAddAccount={handleAddAccount}
                onUpdateAccount={handleUpdateAccount}
                onDeleteAccount={handleDeleteAccount}
                onAddTransfer={handleAddTransfer}
                onAddTransfers={handleAddTransfers}
                onDeleteTransfer={handleDeleteTransfer}
                onUpdateIncome={handleUpdateIncome}
                onAddExpenses={handleAddExpenses}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onSaveSettings={handleSaveSettings}
                onNavigateToTab={navigateToTab}
                openTransferTrigger={openTransferTrigger}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsView
                incomes={filteredIncomes}
                expenses={filteredExpenses}
                accounts={filteredAccounts}
                transfers={filteredTransfers}
                budgets={budgets}
                settings={settings}
                currency={settings.currency}
                timeRange={timeRange}
                customDateRange={customDateRange}
                onNavigateToTab={navigateToTab}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onDeleteExpense={handleDeleteExpense}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                accounts={accounts}
                incomes={incomes}
                expenses={expenses}
                transfers={transfers}
                currentUser={currentUser}
                onSaveSettings={handleSaveSettings}
                onUpdateSavingsVaultRates={handleUpdateSavingsVaultRates}
                onLockAppNow={() => setIsAppLocked(true)}
                onMoveSubcategory={handleMoveSubcategory}
                onEditCategoryOrSubcategory={handleEditCategoryOrSubcategory}
                isSaving={isSaving}
                onAddSavingsStructure={handleAddSavingsStructure}
                onImportRecords={handleImportRecords}
                onApplyDriveAlignment={handleApplyDriveAlignment}
                isDriveAlignmentOpen={isDriveAlignmentOpen}
                onDriveAlignmentOpenChange={handleDriveAlignmentOpenChange}
                nov24Imported={nov24Imported}
                onRestoreToNov23={handleRestoreToNov23}
              />
            )}
          </main>
        </div>
      </div>

      {/* Static Horizontal Menu Options Icon Bar Beneath (Locked at Bottom of Viewport) */}
      <BottomMenuBar
        activeTab={activeTab}
        onSelectTab={navigateToTab}
      />

      {/* Floating Bottom-Right + Quick Actions (Transfer Fund, Income, Expense) */}
      <FloatingQuickActions
        incomes={incomes}
        expenses={expenses}
        accounts={activeAccounts}
        budgets={budgets}
        transfers={transfers}
        settings={settings}
        currency={settings.currency}
        onAddIncome={handleAddIncome}
        onAddExpenses={handleAddExpenses}
        onAddTransfer={handleAddTransfer}
        onAddTransfers={handleAddTransfers}
        onSaveSettings={handleSaveSettings}
        onOpenDeductionAgent={() => setIsDeductionAgentOpen(true)}
        onNavigateToExpandedForm={(tab, formType) => {
          navigateToTab(tab);
          if (formType === 'income') {
            setExpandIncomeTrigger((prev) => prev + 1);
          } else if (formType === 'expense') {
            setExpandExpenseTrigger((prev) => prev + 1);
          } else if (formType === 'transfer') {
            setOpenTransferTrigger((prev) => prev + 1);
          }
        }}
      />

      {/* Global Edit Expense Modal across All Boards */}
      <EditExpenseModal
        isOpen={Boolean(editingExpense)}
        expense={editingExpense}
        expenses={expenses}
        accounts={activeAccounts}
        settings={settings}
        currency={settings.currency}
        onClose={() => setEditingExpense(null)}
        onSaveExpense={handleUpdateExpense}
        onMoveSubcategory={handleMoveSubcategory}
      />

      {/* Deduction & Record Intelligence Assistant Modal */}
      <DeductionAgentModal
        isOpen={isDeductionAgentOpen}
        onClose={() => setIsDeductionAgentOpen(false)}
        incomes={incomes}
        expenses={expenses}
        accounts={activeAccounts}
        settings={settings}
        currency={settings.currency}
        onSaveSettings={handleSaveSettings}
        onAddIncome={handleAddIncome}
        onAddExpenses={handleAddExpenses}
      />

      {/* Reset Data Modal */}
      <CleanSheetModal
        isOpen={Boolean(isCleanSheetModalOpen)}
        isClearing={isClearingSheet}
        onClose={() => setIsCleanSheetModalOpen(false)}
        onConfirm={handleConfirmCleanSheet}
      />

      {/* Offline Mode Connectivity Banner */}
      <OfflineIndicator />
    </div>
  );
}
