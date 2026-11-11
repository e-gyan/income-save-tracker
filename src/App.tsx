/**
 * Save N Know — Main Application Orchestrator
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  auth,
  onAuthStateChanged,
  User,
} from './lib/firebase.ts';
import {
  UserSettings,
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  SavingsBucket,
  ThemeMode,
  AppColorTheme,
} from './types/finance.ts';
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_FINANCIAL_ACCOUNTS,
  LEGACY_AUTO_ACCOUNT_IDS,
  LEGACY_SEEDED_CUT_IDS,
  getEffectiveSavingsPillars,
  isSavingsVaultAccount,
  buildDefaultDeductionsForIncome,
  resolveIntuitiveSubcategoryColor,
} from './lib/calculations.ts';
import {
  applyColorThemeToDocument,
  getPersistedColorTheme,
  setPersistedColorTheme,
  getPersistedThemeMode,
  setPersistedThemeMode,
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
  clearAllTransactionsAndTransfers,
  getLocalData,
  setLocalData,
  clearUnassignedLocalData,
} from './lib/firestoreService.ts';

import { Header } from './components/Header.tsx';
import { Navigation, ActiveTab } from './components/Navigation.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { IncomeLogView } from './components/IncomeLogView.tsx';
import { FlexibleExpensesView } from './components/FlexibleExpensesView.tsx';
import { AccountsView } from './components/AccountsView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { CleanSheetModal } from './components/CleanSheetModal.tsx';
import { FloatingQuickActions } from './components/FloatingQuickActions.tsx';
import { DeductionAgentModal } from './components/DeductionAgentModal.tsx';
import { TimeRangePreset, isDateInPreset } from './lib/dateFilters.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('income_log');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRangePreset>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeductionAgentOpen, setIsDeductionAgentOpen] = useState(false);
  const [expandIncomeTrigger, setExpandIncomeTrigger] = useState(0);
  const [expandExpenseTrigger, setExpandExpenseTrigger] = useState(0);
  const [openTransferTrigger, setOpenTransferTrigger] = useState(0);

  // Core Data States (Strictly attached to the signed-in account)
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [accounts, setAccounts] = useState<FinancialAccount[]>(DEFAULT_FINANCIAL_ACCOUNTS);
  const [transfers, setTransfers] = useState<AccountTransfer[]>([]);
  const [incomes, setIncomes] = useState<IncomeReceipt[]>([]);
  const [expenses, setExpenses] = useState<FlexibleExpense[]>([]);

  const effectiveUserId = currentUser?.uid || 'guest_user';

  // Apply Theme Mode (light / dark / system) & Functional Color Theme to documentElement
  useEffect(() => {
    const mode: ThemeMode = settings.themeMode || getPersistedThemeMode();
    const colorTheme: AppColorTheme =
      settings.colorTheme || getPersistedColorTheme();
    const root = document.documentElement;

    setPersistedThemeMode(mode);
    setPersistedColorTheme(colorTheme);

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
  }, [settings.themeMode, settings.colorTheme]);

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
            },
            uid
          );
          const cleanedCachedSettings: UserSettings = {
            ...cachedSettings,
            colorTheme: cachedSettings.colorTheme || getPersistedColorTheme(),
            themeMode: cachedSettings.themeMode || getPersistedThemeMode(),
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

          const guestIncomes = getLocalData<IncomeReceipt[]>('incomes', [], 'guest_user');
          if (guestIncomes.length > 0 && cachedIncomes.length === 0) {
            const migrated = guestIncomes.map((inc) => ({ ...inc, userId: uid }));
            setIncomes(migrated);
            setLocalData('incomes', migrated, uid);
            for (const m of migrated) {
              saveIncomeReceipt(uid, m).catch(() => {});
            }
          }
          clearUnassignedLocalData();

          try {
            const userSettings = await fetchUserSettings(uid);
            setSettings(userSettings);
            setLocalData('settings', userSettings, uid);
          } catch (err) {
            console.warn('Using user settings cache:', err);
          }

          const unsubIncomes = subscribeToIncomes(
            uid,
            (items) => {
              setIncomes(items);
              setLocalData('incomes', items, uid);
            },
            (err) => console.warn('Incomes subscription fallback to user cache:', err)
          );
          unsubs.push(unsubIncomes);

          const unsubExpenses = subscribeToFlexibleExpenses(uid, (items) => {
            setExpenses(items);
            setLocalData('expenses', items, uid);
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
          });
          unsubs.push(unsubTransfers);
        } else {
          // Signed Out: Keep all records attached to the signed-in account and clear signed-out view
          clearUnassignedLocalData();
          setIncomes([]);
          setExpenses([]);
          setTransfers([]);
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

      setLocalData('incomes', [], effectiveUserId);
      setLocalData('expenses', [], effectiveUserId);
      setLocalData('transfers', [], effectiveUserId);

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
    const newRecords: FlexibleExpense[] = items.map((item, index) => ({
      ...item,
      id: `exp_${nowMs}_${index}`,
      userId: effectiveUserId,
      createdAt: new Date().toISOString(),
    }));

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

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-500 font-mono text-xs">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen w-full max-w-full overflow-hidden bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Static Top Header & Sub-Header (Locked at Top of Viewport) */}
      <div className="shrink-0 z-40 bg-white/95 backdrop-blur-md shadow-2xs">
        <div
          className="h-1 w-full transition-colors duration-200"
          style={{ backgroundColor: 'var(--app-accent)' }}
        />
        <Header
          currentUser={currentUser}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          themeMode={settings.themeMode || 'light'}
          onThemeModeChange={handleThemeModeChange}
          colorTheme={settings.colorTheme || 'emerald'}
          onColorThemeChange={handleColorThemeChange}
        />

        <Navigation
          activeTab={activeTab}
          timeRange={timeRange}
          onSelectTimeRange={setTimeRange}
          onCleanSheet={() => setIsCleanSheetModalOpen(true)}
          isMenuOpen={isMenuOpen}
          onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
          recordsCount={filteredIncomes.length}
        />
      </div>

      {/* Collapsible Auto-Closing Left Menu Drawer */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        accountsCount={activeAccounts.length}
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
                currency={settings.currency}
                onAddExpenses={handleAddExpenses}
                onDeleteExpense={handleDeleteExpense}
                onNavigateToTab={setActiveTab}
                expandFormTrigger={expandExpenseTrigger}
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
                onDeleteExpense={handleDeleteExpense}
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
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                accounts={accounts}
                expenses={expenses}
                currentUser={currentUser}
                onSaveSettings={handleSaveSettings}
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
        settings={settings}
        currency={settings.currency}
        onAddIncome={handleAddIncome}
        onAddExpenses={handleAddExpenses}
        onAddTransfer={handleAddTransfer}
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
    </div>
  );
}
