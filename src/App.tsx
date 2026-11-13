/**
 * Save N Know — Main Application Orchestrator
 */

import React, { useState, useEffect, useMemo } from 'react';
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
  isSavingsVaultAccount,
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
  getLocalData,
  setLocalData,
  clearUnassignedLocalData,
  syncAuthenticatedCloudSnapshotToBackend,
  hydrateAuthenticatedCloudSnapshotFromBackend,
} from './lib/firestoreService.ts';

import { Header } from './components/Header.tsx';
import { Navigation, ActiveTab } from './components/Navigation.tsx';
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
import { TimeRangePreset, isDateInPreset } from './lib/dateFilters.ts';

export default function App() {
  // Synchronously hydrate the signed-in user and their cloud-cached records on frame 0
  // so refreshing or opening the app renders data immediately without waiting.
  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    getPersistedAuthUser()
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileDateFilterOpen, setIsMobileDateFilterOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeductionAgentOpen, setIsDeductionAgentOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<FlexibleExpense | null>(null);
  const [expandIncomeTrigger, setExpandIncomeTrigger] = useState(0);
  const [expandExpenseTrigger, setExpandExpenseTrigger] = useState(0);
  const [openTransferTrigger, setOpenTransferTrigger] = useState(0);

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

  // Apply Theme Mode (light / dark / system), Functional Color Theme & Accounting Figure Colors to documentElement
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
        root.classList.add('dark');
      } else if (mode === 'light') {
        isDark = false;
        root.classList.remove('dark');
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', isDark);
      }
      applyColorThemeToDocument(colorTheme, isDark);
    };

    applyThemeAndColors();

    if (mode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyThemeAndColors();
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
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

  const handleAddIncome = async (
    receiptData: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ) => {
    const newReceipt: IncomeReceipt = {
      ...receiptData,
      id: `inc_${Date.now()}`,
      userId: effectiveUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextIncomes = [newReceipt, ...incomes];
    setIncomes(nextIncomes);
    setLocalData('incomes', nextIncomes, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveIncomeReceipt(currentUser.uid, newReceipt);
        }
      } catch (err) {
        console.error('Background income save error:', err);
      }
    })();
  };

  const handleUpdateIncome = async (updatedReceipt: IncomeReceipt) => {
    const nextIncomes = incomes.map((i) =>
      i.id === updatedReceipt.id ? updatedReceipt : i
    );
    setIncomes(nextIncomes);
    setLocalData('incomes', nextIncomes, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          await saveIncomeReceipt(currentUser.uid, updatedReceipt);
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

      // Automate debit from Savings Vault as expenses come in by learning from past vault-debit expenses
      let resolvedAccountId = item.accountId;
      let resolvedVaultAction = item.vaultAction;

      if (!alreadyVault && item.vaultAction !== 'credit') {
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

      return {
        ...item,
        id: `exp_${nowMs}_${index}`,
        userId: effectiveUserId,
        accountId: resolvedAccountId,
        vaultAction: resolvedVaultAction,
        subcategoryColor: subColor,
        createdAt: new Date(nowMs + index).toISOString(),
      };
    });

    const nextExpenses = [...newRecords, ...expenses];
    setExpenses(nextExpenses);
    setLocalData('expenses', nextExpenses, effectiveUserId);

    (async () => {
      try {
        if (currentUser) {
          for (const rec of newRecords) {
            await saveFlexibleExpense(currentUser.uid, rec);
          }
        }
      } catch (err) {
        console.error('Expense save error:', err);
      }
    })();
  };

  const handleUpdateExpense = async (updatedExpense: FlexibleExpense) => {
    // Support editing deduction-derived expenses (exp_ded_<incId>_<dedId>) as well as standalone expenses
    if (updatedExpense.id.startsWith('exp_ded_') && updatedExpense.incomeReceiptId) {
      const parentIncome = incomes.find(
        (inc) => inc.id === updatedExpense.incomeReceiptId
      );
      if (parentIncome && Array.isArray(parentIncome.allocatedDeductions)) {
        const prefix = `exp_ded_${parentIncome.id}_`;
        const dedId = updatedExpense.id.startsWith(prefix)
          ? updatedExpense.id.slice(prefix.length)
          : '';
        const nextDeductions = parentIncome.allocatedDeductions.map((ded) => {
          if (
            ded.id === dedId ||
            ded.name.trim().toLowerCase() ===
              (updatedExpense.recipient || '').trim().toLowerCase()
          ) {
            const newAmt = Number(
              updatedExpense.originalAmount ?? updatedExpense.amount ?? ded.amount
            );
            return {
              ...ded,
              name: updatedExpense.recipient || ded.name,
              type: 'fixed' as const,
              value: newAmt,
              amount: newAmt,
              expenseCategory: updatedExpense.category,
              expenseSubcategory: updatedExpense.subcategory,
            };
          }
          return ded;
        });
        await handleUpdateIncome({
          ...parentIncome,
          date: updatedExpense.date || parentIncome.date,
          accountId: updatedExpense.accountId || parentIncome.accountId,
          allocatedDeductions: nextDeductions,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
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

    (async () => {
      try {
        if (currentUser) {
          const uid = currentUser.uid;
          await saveUserSettings(uid, updatedSettings);
          for (const exp of changedExpenses) {
            await saveFlexibleExpense(uid, exp);
          }
          for (const inc of changedIncomes) {
            await saveIncomeReceipt(uid, inc);
          }
          for (const bgt of changedBudgets) {
            await saveFinancialBudget(uid, bgt);
          }
        }
      } catch (err) {
        console.error('Move subcategory persistence error:', err);
      }
    })();
  };

  const handleDeleteExpense = async (expenseId: string) => {
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
      for (const acc of newAccounts) {
        await saveFinancialAccount(uid, acc);
      }
      for (const inc of newIncomes) {
        await saveIncomeReceipt(uid, inc);
      }
      for (const exp of newExpenses) {
        await saveFlexibleExpense(uid, exp);
      }
      for (const tr of newTransfers) {
        await saveAccountTransfer(uid, tr);
      }
    }
  };

  // Filtered collections corresponding to the active date selection
  const filteredIncomes = useMemo(() => {
    return incomes.filter((inc) => isDateInPreset(inc.date, timeRange));
  }, [incomes, timeRange]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => isDateInPreset(exp.date, timeRange));
  }, [expenses, timeRange]);

  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => isDateInPreset(t.date, timeRange));
  }, [transfers, timeRange]);

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
      initialBalance: isDateInPreset(acc.createdAt, timeRange)
        ? acc.initialBalance
        : 0,
    }));
  }, [activeAccounts, timeRange]);

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

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-500 font-mono text-xs">
        Loading...
      </div>
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
          isSidebarOpen={isMenuOpen}
          onToggleSidebar={() => setIsMenuOpen((prev) => !prev)}
          timeRange={timeRange}
          onSelectTimeRange={setTimeRange}
          isMobileDateFilterOpen={isMobileDateFilterOpen}
          onToggleMobileDateFilter={() =>
            setIsMobileDateFilterOpen((prev) => !prev)
          }
        />

        <Navigation
          timeRange={timeRange}
          onSelectTimeRange={(range) => {
            setTimeRange(range);
            setIsMobileDateFilterOpen(false);
          }}
          isOpenOnMobile={isMobileDateFilterOpen}
        />
      </div>

      {/* Collapsible Top-Right Menu Drawer */}
      <Sidebar
        isOpen={isMenuOpen}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setIsMenuOpen(false);
        }}
        onClose={() => setIsMenuOpen(false)}
        themeMode={settings.themeMode || 'light'}
        onThemeModeChange={handleThemeModeChange}
        colorTheme={settings.colorTheme || 'emerald'}
        onColorThemeChange={handleColorThemeChange}
        timeRange={timeRange}
        onSelectTimeRange={setTimeRange}
        accountsCount={activeAccounts.length}
        budgetsCount={
          budgets.filter((b) => !b.isArchivedPeriod && !b.isExpiredDisabled)
            .length
        }
        budgetAlertsCount={budgetAlertsCount}
        onReset={() => setIsCleanSheetModalOpen(true)}
      />

      {/* Scrollable Main Workspace */}
      <div className="flex-1 w-full overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <main className="w-full min-w-0">
            {activeTab === 'dashboard' && (
              <DashboardView
                incomes={filteredIncomes}
                expenses={filteredExpenses}
                accounts={filteredAccounts}
                transfers={filteredTransfers}
                settings={settings}
                currency={settings.currency}
                timeRange={timeRange}
                onSelectTimeRange={setTimeRange}
                onNavigateToTab={setActiveTab}
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
                onAddIncome={handleAddIncome}
                onUpdateIncome={handleUpdateIncome}
                onDeleteIncome={handleDeleteIncome}
                onAddAccount={handleAddAccount}
                onSaveSettings={handleSaveSettings}
                onNavigateToSettings={() => setActiveTab('settings')}
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
                onAddExpenses={handleAddExpenses}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onMoveSubcategory={handleMoveSubcategory}
                onNavigateToTab={setActiveTab}
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
                onNavigateToTab={setActiveTab}
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
                onDeleteTransfer={handleDeleteTransfer}
                onUpdateIncome={handleUpdateIncome}
                onAddExpenses={handleAddExpenses}
                onUpdateExpense={handleUpdateExpense}
                onDeleteExpense={handleDeleteExpense}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onSaveSettings={handleSaveSettings}
                onNavigateToTab={setActiveTab}
                openTransferTrigger={openTransferTrigger}
              />
            )}

            {activeTab === 'analytics' && (
              <AnalyticsView
                incomes={filteredIncomes}
                expenses={filteredExpenses}
                accounts={filteredAccounts}
                transfers={filteredTransfers}
                settings={settings}
                currency={settings.currency}
                timeRange={timeRange}
                onNavigateToTab={setActiveTab}
                onEditExpense={(exp) => setEditingExpense(exp)}
                onDeleteExpense={handleDeleteExpense}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                accounts={accounts}
                expenses={expenses}
                currentUser={currentUser}
                onSaveSettings={handleSaveSettings}
                onMoveSubcategory={handleMoveSubcategory}
                isSaving={isSaving}
                onAddSavingsStructure={handleAddSavingsStructure}
                onImportRecords={handleImportRecords}
              />
            )}
          </main>
        </div>
      </div>

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
        onSaveSettings={handleSaveSettings}
        onOpenDeductionAgent={() => setIsDeductionAgentOpen(true)}
        onNavigateToExpandedForm={(tab, formType) => {
          setActiveTab(tab);
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
