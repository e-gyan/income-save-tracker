/**
 * Firestore Data Access Layer with Real-Time Subscriptions,
 * Audit Revision Logging, and Error Handling.
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, isFirestoreOffline, OperationType } from './firebase.ts';
import {
  UserSettings,
  IncomeReceipt,
  IncomeDeductionItem,
  FlexibleExpense,
  RevisionEntry,
  FinancialAccount,
  AccountTransfer,
  FinancialBudget,
} from '../types/finance.ts';
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_FINANCIAL_ACCOUNTS,
  LEGACY_SEEDED_CUT_IDS,
  LEGACY_PREDEFINED_ACCOUNT_TYPES,
  LEGACY_PREDEFINED_INCOME_SOURCES,
  LEGACY_PREDEFINED_INCOME_ORIGINS,
  LEGACY_PREDEFINED_INCOME_CATEGORIES,
  resolveIntuitiveSubcategoryColor,
} from './calculations.ts';
import {
  getPersistedColorTheme,
  setPersistedColorTheme,
  getPersistedThemeMode,
  setPersistedThemeMode,
} from './colorThemes.ts';
import { sortRecordsByArrivalTime } from './dateFilters.ts';

function stripLegacyPredefinedList(
  rawList: unknown,
  legacySet: Set<string>
): string[] {
  if (!Array.isArray(rawList)) return [];
  const cleaned = rawList
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  // If every item in the stored array came from the old predefined seed list, clear it
  if (cleaned.length > 0 && cleaned.every((item) => legacySet.has(item))) {
    return [];
  }
  return cleaned.filter((item) => !legacySet.has(item));
}

const LOCAL_STORAGE_KEY_PREFIX = 'iaft_local_';

/**
 * User-scoped local storage helpers so signed-in user data remains attached to their account
 * and is never leaked when signed out.
 */
export function getLocalData<T>(key: string, defaultValue: T, userId = 'guest_user'): T {
  try {
    const scopedKey = `${LOCAL_STORAGE_KEY_PREFIX}${userId}_${key}`;
    const raw = localStorage.getItem(scopedKey);
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export function setLocalData<T>(key: string, value: T, userId = 'guest_user'): void {
  try {
    const scopedKey = `${LOCAL_STORAGE_KEY_PREFIX}${userId}_${key}`;
    localStorage.setItem(scopedKey, JSON.stringify(value));
  } catch (err) {
    console.error('Local storage write failed:', err);
  }
}

/**
 * Clears guest / unscoped local data on sign-out so all records remain attached only to signed-in accounts.
 */
export function clearUnassignedLocalData(): void {
  try {
    const keysToRemove = [
      'incomes',
      'expenses',
      'transfers',
      'revisions',
      'accounts',
      'budgets',
      'settings',
    ];
    for (const k of keysToRemove) {
      localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${k}`);
      localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}guest_user_${k}`);
    }
  } catch {
    // ignore storage errors
  }
}

// ==================== SETTINGS ====================

export async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const path = `users/${userId}/settings/config`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'config'));
    if (snap.exists()) {
      const data = snap.data();
      const resolvedThemeMode = data.themeMode || getPersistedThemeMode();
      const resolvedColorTheme = data.colorTheme || getPersistedColorTheme();
      setPersistedThemeMode(resolvedThemeMode);
      setPersistedColorTheme(resolvedColorTheme);

      const rawCuts = data.customCuts ? JSON.parse(data.customCuts) : [];
      const userDefinedCuts = Array.isArray(rawCuts)
        ? rawCuts.filter((c: any) => c && !LEGACY_SEEDED_CUT_IDS.has(c.id))
        : [];

      const parsedIncomeCategories = data.incomeCategories
        ? stripLegacyPredefinedList(
            JSON.parse(data.incomeCategories),
            LEGACY_PREDEFINED_INCOME_CATEGORIES
          )
        : [];
      const parsedIncomeSources = data.incomeSources
        ? stripLegacyPredefinedList(
            JSON.parse(data.incomeSources),
            LEGACY_PREDEFINED_INCOME_SOURCES
          )
        : [];
      const parsedIncomeOrigins = data.incomeOrigins
        ? stripLegacyPredefinedList(
            JSON.parse(data.incomeOrigins),
            LEGACY_PREDEFINED_INCOME_ORIGINS
          )
        : [];
      const parsedAccountTypes = data.accountTypes
        ? stripLegacyPredefinedList(
            JSON.parse(data.accountTypes),
            LEGACY_PREDEFINED_ACCOUNT_TYPES
          )
        : [];

      return {
        userId,
        currency: data.currency || 'GHS',
        totalsCurrencyMode: data.totalsCurrencyMode === 'original' ? 'original' : 'base',
        themeMode: resolvedThemeMode,
        colorTheme: resolvedColorTheme,
        subscriptionFee: Number(data.subscriptionFee ?? 0),
        dataBundleFee: Number(data.dataBundleFee ?? 0),
        projectBuildingsRate: Number(data.projectBuildingsRate ?? 0),
        customCuts: userDefinedCuts,
        savingsBuckets: data.savingsBuckets ? JSON.parse(data.savingsBuckets) : DEFAULT_USER_SETTINGS.savingsBuckets,
        quarterlyRates: data.quarterlyRates ? JSON.parse(data.quarterlyRates) : DEFAULT_USER_SETTINGS.quarterlyRates,
        incomeCategories: parsedIncomeCategories,
        incomeSources: parsedIncomeSources,
        incomeOrigins: parsedIncomeOrigins,
        expenseCategories: data.expenseCategories ? JSON.parse(data.expenseCategories) : [],
        expenseCategoryPreferences: data.expenseCategoryPreferences ? JSON.parse(data.expenseCategoryPreferences) : [],
        vaultCustodianAccounts: data.vaultCustodianAccounts ? JSON.parse(data.vaultCustodianAccounts) : {},
        accountTypes: parsedAccountTypes,
        defaultAccountId: data.defaultAccountId || DEFAULT_USER_SETTINGS.defaultAccountId,
        askNetIncomeTransfer:
          data.askNetIncomeTransfer !== undefined
            ? Boolean(data.askNetIncomeTransfer)
            : DEFAULT_USER_SETTINGS.askNetIncomeTransfer,
        defaultNetIncomeAccountId:
          data.defaultNetIncomeAccountId !== undefined
            ? String(data.defaultNetIncomeAccountId)
            : DEFAULT_USER_SETTINGS.defaultNetIncomeAccountId,
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }
    return {
      ...DEFAULT_USER_SETTINGS,
      userId,
      themeMode: getPersistedThemeMode(),
      colorTheme: getPersistedColorTheme(),
      customCuts: [],
    };
  } catch (error: any) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore getDoc offline/unreachable on ${path}, falling back to local settings:`, error?.message || error);
      const local = getLocalData<UserSettings>(
        'settings',
        {
          ...DEFAULT_USER_SETTINGS,
          userId,
          themeMode: getPersistedThemeMode(),
          colorTheme: getPersistedColorTheme(),
          customCuts: [],
        },
        userId
      );
      return {
        ...local,
        totalsCurrencyMode: local.totalsCurrencyMode === 'original' ? 'original' : 'base',
        themeMode: local.themeMode || getPersistedThemeMode(),
        colorTheme: local.colorTheme || getPersistedColorTheme(),
        incomeCategories: stripLegacyPredefinedList(
          local.incomeCategories,
          LEGACY_PREDEFINED_INCOME_CATEGORIES
        ),
        incomeSources: stripLegacyPredefinedList(
          local.incomeSources,
          LEGACY_PREDEFINED_INCOME_SOURCES
        ),
        incomeOrigins: stripLegacyPredefinedList(
          local.incomeOrigins,
          LEGACY_PREDEFINED_INCOME_ORIGINS
        ),
        accountTypes: stripLegacyPredefinedList(
          local.accountTypes,
          LEGACY_PREDEFINED_ACCOUNT_TYPES
        ),
        customCuts: (local.customCuts || []).filter(
          (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
        ),
      };
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  const path = `users/${userId}/settings/config`;
  const resolvedThemeMode = settings.themeMode || getPersistedThemeMode();
  const resolvedColorTheme = settings.colorTheme || getPersistedColorTheme();
  setPersistedThemeMode(resolvedThemeMode);
  setPersistedColorTheme(resolvedColorTheme);

  const cleanedCuts = (settings.customCuts || []).filter(
    (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
  );

  try {
    const docData: any = {
      userId,
      currency: settings.currency,
      totalsCurrencyMode: settings.totalsCurrencyMode === 'original' ? 'original' : 'base',
      themeMode: resolvedThemeMode,
      colorTheme: resolvedColorTheme,
      subscriptionFee: settings.subscriptionFee ?? 0,
      dataBundleFee: settings.dataBundleFee ?? 0,
      projectBuildingsRate: settings.projectBuildingsRate ?? 0,
      customCuts: JSON.stringify(cleanedCuts),
      savingsBuckets: JSON.stringify(settings.savingsBuckets || []),
      quarterlyRates: JSON.stringify(settings.quarterlyRates || {}),
      incomeCategories: JSON.stringify(settings.incomeCategories ?? DEFAULT_USER_SETTINGS.incomeCategories ?? []),
      incomeSources: JSON.stringify(settings.incomeSources ?? DEFAULT_USER_SETTINGS.incomeSources ?? []),
      incomeOrigins: JSON.stringify(settings.incomeOrigins ?? DEFAULT_USER_SETTINGS.incomeOrigins ?? []),
      expenseCategories: JSON.stringify(settings.expenseCategories ?? []),
      expenseCategoryPreferences: JSON.stringify(settings.expenseCategoryPreferences ?? []),
      vaultCustodianAccounts: JSON.stringify(settings.vaultCustodianAccounts ?? {}),
      accountTypes: JSON.stringify(settings.accountTypes ?? DEFAULT_USER_SETTINGS.accountTypes ?? []),
      askNetIncomeTransfer: settings.askNetIncomeTransfer !== false,
      defaultNetIncomeAccountId: String(settings.defaultNetIncomeAccountId || '').slice(0, 128),
      updatedAt: new Date().toISOString(),
    };
    if (settings.defaultAccountId) {
      docData.defaultAccountId = settings.defaultAccountId;
    }
    await setDoc(doc(db, 'users', userId, 'settings', 'config'), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore saveUserSettings offline on ${path}, saved locally:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== INCOMES ====================

export function subscribeToIncomes(
  userId: string,
  onData: (incomes: IncomeReceipt[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${userId}/incomes`;
  const q = query(collection(db, 'users', userId, 'incomes'), orderBy('date', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: IncomeReceipt[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        let parsedDeductions: IncomeDeductionItem[] | undefined = undefined;
        if (item.allocatedDeductionsJson) {
          try {
            parsedDeductions = JSON.parse(item.allocatedDeductionsJson);
          } catch {
            parsedDeductions = undefined;
          }
        }
        items.push({
          id: d.id,
          userId,
          date: item.date,
          clientOrSource: item.clientOrSource,
          category: item.category || 'General',
          currency: item.currency || undefined,
          originalGrossAmount:
            item.originalGrossAmount !== undefined
              ? Math.round(Number(item.originalGrossAmount || 0) * 100) / 100
              : undefined,
          exchangeRate:
            item.exchangeRate !== undefined
              ? Math.round(Number(item.exchangeRate || 1) * 100) / 100
              : undefined,
          grossAmount: Math.round(Number(item.grossAmount || 0) * 100) / 100,
          quarter: item.quarter || 'Q1',
          savingsRate: item.savingsRate !== undefined ? Number(item.savingsRate) : 0,
          accountId: item.accountId || '',
          netTransferredToAccountId: item.netTransferredToAccountId || undefined,
          receiptId: item.receiptId || '',
          notes: item.notes || '',
          allocatedDeductions: parsedDeductions,
          allowSubscription: item.allowSubscription !== undefined ? Boolean(item.allowSubscription) : false,
          allowData: item.allowData !== undefined ? Boolean(item.allowData) : false,
          allowProjects: item.allowProjects !== undefined ? Boolean(item.allowProjects) : false,
          allowPartnership: item.allowPartnership !== undefined ? Boolean(item.allowPartnership) : true,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        });
      });
      onData(sortRecordsByArrivalTime(items));
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        if (onError) onError(error);
        return;
      }
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveIncomeReceipt(userId: string, receipt: IncomeReceipt): Promise<void> {
  const path = `users/${userId}/incomes/${receipt.id}`;
  try {
    const docData: any = {
      userId,
      date: String(receipt.date || '').slice(0, 30),
      clientOrSource: String(receipt.clientOrSource || '').slice(0, 200),
      category: String(receipt.category || 'General').slice(0, 100),
      grossAmount: Math.round(Number(receipt.grossAmount || 0) * 100) / 100,
      receiptId: String(receipt.receiptId || '').slice(0, 100),
      notes: String(receipt.notes || '').slice(0, 1000),
      quarter: String(receipt.quarter || 'Q1').slice(0, 10),
      savingsRate: Math.min(100, Math.max(0, Number(receipt.savingsRate ?? 0))),
      accountId: String(receipt.accountId || '').slice(0, 128),
      allocatedDeductionsJson: JSON.stringify(receipt.allocatedDeductions || []).slice(0, 49000),
      createdAt: receipt.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (receipt.currency) {
      docData.currency = String(receipt.currency).slice(0, 10);
    }
    if (receipt.originalGrossAmount !== undefined) {
      docData.originalGrossAmount =
        Math.round(Number(receipt.originalGrossAmount || 0) * 100) / 100;
    }
    if (receipt.exchangeRate !== undefined) {
      docData.exchangeRate =
        Math.round(Number(receipt.exchangeRate || 1) * 100) / 100;
    }
    if (receipt.netTransferredToAccountId) {
      docData.netTransferredToAccountId = String(receipt.netTransferredToAccountId).slice(0, 128);
    }

    await setDoc(doc(db, 'users', userId, 'incomes', receipt.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteIncomeReceipt(userId: string, receiptId: string): Promise<void> {
  const path = `users/${userId}/incomes/${receiptId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'incomes', receiptId));
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore delete offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== FLEXIBLE EXPENSES ====================

export function subscribeToFlexibleExpenses(
  userId: string,
  onData: (expenses: FlexibleExpense[]) => void
) {
  const path = `users/${userId}/flexible_expenses`;
  const q = query(collection(db, 'users', userId, 'flexible_expenses'), orderBy('date', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: FlexibleExpense[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        items.push({
          id: d.id,
          userId,
          date: item.date,
          batchId: item.batchId || undefined,
          incomeReceiptId: item.incomeReceiptId || '',
          accountId: item.accountId || '',
          recipient: item.recipient || '',
          category: item.category || 'Uncategorized',
          subcategory: item.subcategory || '',
          subcategoryColor:
            item.subcategoryColor ||
            resolveIntuitiveSubcategoryColor(item.subcategory, item.category),
          description: item.description || '',
          notes: item.notes || item.description || '',
          currency: item.currency || undefined,
          originalAmount:
            item.originalAmount !== undefined
              ? Math.round(Number(item.originalAmount || 0) * 100) / 100
              : undefined,
          exchangeRate:
            item.exchangeRate !== undefined
              ? Math.round(Number(item.exchangeRate || 1) * 100) / 100
              : undefined,
          amount: Math.round(Number(item.amount || 0) * 100) / 100,
          vaultAction:
            item.vaultAction === 'credit'
              ? 'credit'
              : item.vaultAction === 'debit'
              ? 'debit'
              : undefined,
          linkedExpenseId: item.linkedExpenseId || undefined,
          createdAt: item.createdAt || new Date().toISOString(),
        });
      });
      onData(sortRecordsByArrivalTime(items));
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveFlexibleExpense(userId: string, expense: FlexibleExpense): Promise<void> {
  const path = `users/${userId}/flexible_expenses/${expense.id}`;
  try {
    const docData: any = {
      userId,
      date: String(expense.date || '').slice(0, 30),
      category: String(expense.category || 'Uncategorized').slice(0, 100),
      amount: Math.max(0, Number(expense.amount || 0)),
      createdAt: expense.createdAt || new Date().toISOString(),
    };
    const descVal = expense.notes || expense.description || expense.recipient || '';
    if (descVal) docData.description = String(descVal).slice(0, 250);
    if (expense.notes) docData.notes = String(expense.notes).slice(0, 250);
    if (expense.recipient) docData.recipient = String(expense.recipient).slice(0, 150);
    if (expense.subcategory) {
      docData.subcategory = String(expense.subcategory).slice(0, 100);
      const resolvedSubColor =
        expense.subcategoryColor ||
        resolveIntuitiveSubcategoryColor(expense.subcategory, expense.category);
      if (resolvedSubColor) {
        docData.subcategoryColor = String(resolvedSubColor).slice(0, 30);
      }
    } else if (expense.subcategoryColor) {
      docData.subcategoryColor = String(expense.subcategoryColor).slice(0, 30);
    }
    if (expense.currency) {
      docData.currency = String(expense.currency).slice(0, 10);
    }
    if (expense.originalAmount !== undefined) {
      docData.originalAmount =
        Math.round(Number(expense.originalAmount || 0) * 100) / 100;
    }
    if (expense.exchangeRate !== undefined) {
      docData.exchangeRate =
        Math.round(Number(expense.exchangeRate || 1) * 100) / 100;
    }
    if (expense.batchId) docData.batchId = String(expense.batchId).slice(0, 128);
    if (expense.incomeReceiptId) docData.incomeReceiptId = String(expense.incomeReceiptId).slice(0, 128);
    if (expense.accountId) docData.accountId = String(expense.accountId).slice(0, 128);
    if (expense.vaultAction === 'debit' || expense.vaultAction === 'credit') {
      docData.vaultAction = expense.vaultAction;
    }
    if (expense.linkedExpenseId) {
      docData.linkedExpenseId = String(expense.linkedExpenseId).slice(0, 128);
    }

    await setDoc(doc(db, 'users', userId, 'flexible_expenses', expense.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFlexibleExpense(userId: string, expenseId: string): Promise<void> {
  const path = `users/${userId}/flexible_expenses/${expenseId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'flexible_expenses', expenseId));
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore delete offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== FINANCIAL ACCOUNTS ====================

export function subscribeToAccounts(
  userId: string,
  onData: (accounts: FinancialAccount[]) => void
) {
  const path = `users/${userId}/accounts`;
  const q = query(collection(db, 'users', userId, 'accounts'));

  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        onData(DEFAULT_FINANCIAL_ACCOUNTS);
        (async () => {
          try {
            for (const acc of DEFAULT_FINANCIAL_ACCOUNTS) {
              await saveFinancialAccount(userId, { ...acc, userId });
            }
          } catch (err) {
            console.warn('Initial accounts seeding note:', err);
          }
        })();
        return;
      }
      const items: FinancialAccount[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        items.push({
          id: d.id,
          userId,
          name: item.name,
          type: item.type,
          institution: item.institution || '',
          accountNumber: item.accountNumber || '',
          currency: item.currency || undefined,
          originalInitialBalance:
            item.originalInitialBalance !== undefined
              ? Math.round(Number(item.originalInitialBalance || 0) * 100) / 100
              : undefined,
          exchangeRate:
            item.exchangeRate !== undefined
              ? Math.round(Number(item.exchangeRate || 1) * 100) / 100
              : undefined,
          isDefaultDeposit: Boolean(item.isDefaultDeposit),
          isVirtual: item.isVirtual !== undefined ? Boolean(item.isVirtual) : undefined,
          initialBalance: Math.round(Number(item.initialBalance || 0) * 100) / 100,
          color: item.color || '#0f172a',
          description: item.description || '',
          linkedSavingsBucketId: item.linkedSavingsBucketId || undefined,
          custodianAccountId: item.custodianAccountId || undefined,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        });
      });
      onData(items);
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveFinancialAccount(userId: string, account: FinancialAccount): Promise<void> {
  const path = `users/${userId}/accounts/${account.id}`;
  try {
    const docData: any = {
      userId,
      name: String(account.name || '').slice(0, 100),
      type: String(account.type || 'Operating').slice(0, 100),
      initialBalance: Math.round(Number(account.initialBalance || 0) * 100) / 100,
      createdAt: account.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (account.currency) docData.currency = String(account.currency).slice(0, 10);
    if (account.originalInitialBalance !== undefined) {
      docData.originalInitialBalance =
        Math.round(Number(account.originalInitialBalance || 0) * 100) / 100;
    }
    if (account.exchangeRate !== undefined) {
      docData.exchangeRate =
        Math.round(Number(account.exchangeRate || 1) * 100) / 100;
    }
    if (account.institution) docData.institution = String(account.institution).slice(0, 100);
    if (account.accountNumber) docData.accountNumber = String(account.accountNumber).slice(0, 50);
    if (account.isDefaultDeposit !== undefined) docData.isDefaultDeposit = Boolean(account.isDefaultDeposit);
    if (account.isVirtual !== undefined) docData.isVirtual = Boolean(account.isVirtual);
    if (account.color) docData.color = String(account.color).slice(0, 30);
    if (account.description) docData.description = String(account.description).slice(0, 500);
    if (account.linkedSavingsBucketId) docData.linkedSavingsBucketId = String(account.linkedSavingsBucketId).slice(0, 128);
    if (account.custodianAccountId) docData.custodianAccountId = String(account.custodianAccountId).slice(0, 128);

    await setDoc(doc(db, 'users', userId, 'accounts', account.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFinancialAccount(userId: string, accountId: string): Promise<void> {
  const path = `users/${userId}/accounts/${accountId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'accounts', accountId));
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore delete offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== ACCOUNT TRANSFERS ====================

export function subscribeToTransfers(
  userId: string,
  onData: (transfers: AccountTransfer[]) => void
) {
  const path = `users/${userId}/transfers`;
  const q = query(collection(db, 'users', userId, 'transfers'), orderBy('date', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AccountTransfer[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        items.push({
          id: d.id,
          userId,
          date: item.date,
          sourceAccountId: item.sourceAccountId,
          destinationAccountId: item.destinationAccountId,
          amount: Math.round(Number(item.amount || 0) * 100) / 100,
          sourceCurrency: item.sourceCurrency || undefined,
          sourceAmount:
            item.sourceAmount !== undefined
              ? Math.round(Number(item.sourceAmount || 0) * 100) / 100
              : undefined,
          destinationCurrency: item.destinationCurrency || undefined,
          destinationAmount:
            item.destinationAmount !== undefined
              ? Math.round(Number(item.destinationAmount || 0) * 100) / 100
              : undefined,
          exchangeRate:
            item.exchangeRate !== undefined
              ? Math.round(Number(item.exchangeRate || 1) * 100) / 100
              : undefined,
          description: item.description || '',
          transferType: item.transferType,
          linkedIncomeId: item.linkedIncomeId || undefined,
          linkedDeductionId: item.linkedDeductionId || undefined,
          createdAt: item.createdAt || new Date().toISOString(),
        });
      });
      onData(sortRecordsByArrivalTime(items));
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveAccountTransfer(userId: string, transfer: AccountTransfer): Promise<void> {
  const path = `users/${userId}/transfers/${transfer.id}`;
  try {
    const docData: any = {
      userId,
      date: transfer.date,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      amount: Math.round(Number(transfer.amount || 0) * 100) / 100,
      transferType: transfer.transferType,
      createdAt: transfer.createdAt || new Date().toISOString(),
    };
    if (transfer.sourceCurrency) {
      docData.sourceCurrency = String(transfer.sourceCurrency).slice(0, 10);
    }
    if (transfer.sourceAmount !== undefined) {
      docData.sourceAmount = Math.round(Number(transfer.sourceAmount || 0) * 100) / 100;
    }
    if (transfer.destinationCurrency) {
      docData.destinationCurrency = String(transfer.destinationCurrency).slice(0, 10);
    }
    if (transfer.destinationAmount !== undefined) {
      docData.destinationAmount =
        Math.round(Number(transfer.destinationAmount || 0) * 100) / 100;
    }
    if (transfer.exchangeRate !== undefined) {
      docData.exchangeRate = Math.round(Number(transfer.exchangeRate || 1) * 100) / 100;
    }
    if (transfer.description) docData.description = String(transfer.description).slice(0, 250);
    if (transfer.linkedIncomeId) docData.linkedIncomeId = transfer.linkedIncomeId;
    if (transfer.linkedDeductionId) docData.linkedDeductionId = transfer.linkedDeductionId;

    await setDoc(doc(db, 'users', userId, 'transfers', transfer.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAccountTransfer(userId: string, transferId: string): Promise<void> {
  const path = `users/${userId}/transfers/${transferId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'transfers', transferId));
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore delete offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== REVISIONS (PROGRESSIVE VERSION CONTROL) ====================

export function subscribeToRevisions(
  userId: string,
  onData: (revisions: RevisionEntry[]) => void
) {
  const path = `users/${userId}/revisions`;
  const q = query(collection(db, 'users', userId, 'revisions'), orderBy('versionNumber', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: RevisionEntry[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        let parsedSemver: string | undefined = item.semanticVersion;
        if (!parsedSemver && item.snapshotData) {
          try {
            const parsed = JSON.parse(item.snapshotData);
            if (parsed && typeof parsed.semanticVersion === 'string') {
              parsedSemver = parsed.semanticVersion;
            }
          } catch {
            // ignore non-json snapshotData
          }
        }
        items.push({
          id: d.id,
          userId,
          versionNumber: Number(item.versionNumber || 1),
          semanticVersion: parsedSemver,
          timestamp: item.timestamp || new Date().toISOString(),
          actionType: item.actionType,
          summary: item.summary,
          snapshotData: item.snapshotData,
        });
      });
      onData(items);
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function recordRevision(userId: string, revision: RevisionEntry): Promise<void> {
  const path = `users/${userId}/revisions/${revision.id}`;
  try {
    const payloadSnapshot = revision.snapshotData || JSON.stringify({
      semanticVersion: revision.semanticVersion || `1.0.${Math.max(0, (revision.versionNumber || 1) - 1)}`,
    });
    const docData = {
      userId,
      versionNumber: Number(revision.versionNumber || 1),
      actionType: String(revision.actionType || 'update').slice(0, 50),
      summary: String(revision.summary || '').slice(0, 300),
      snapshotData: String(payloadSnapshot).slice(0, 490000),
      timestamp: revision.timestamp || new Date().toISOString(),
    };
    await setDoc(doc(db, 'users', userId, 'revisions', revision.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== FINANCIAL BUDGETS ====================

export function subscribeToBudgets(
  userId: string,
  onData: (budgets: FinancialBudget[]) => void
) {
  const path = `users/${userId}/budgets`;
  const q = query(collection(db, 'users', userId, 'budgets'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: FinancialBudget[] = [];
      snapshot.forEach((d) => {
        const item = d.data();
        let parsedSubs: string[] = [];
        let parsedCats: string[] = [];
        if (item.subcategoriesJson) {
          try {
            const arr = JSON.parse(item.subcategoriesJson);
            if (Array.isArray(arr)) parsedSubs = arr.map(String).filter(Boolean);
          } catch {
            parsedSubs = [];
          }
        } else if (Array.isArray(item.subcategories)) {
          parsedSubs = item.subcategories.map(String).filter(Boolean);
        }
        if (item.categoriesJson) {
          try {
            const arr = JSON.parse(item.categoriesJson);
            if (Array.isArray(arr)) parsedCats = arr.map(String).filter(Boolean);
          } catch {
            parsedCats = [];
          }
        }
        items.push({
          id: d.id,
          userId,
          name: item.name || 'Budget',
          periodType:
            item.periodType === 'weekly' ||
            item.periodType === 'yearly' ||
            item.periodType === 'custom'
              ? item.periodType
              : 'monthly',
          customStartDate: item.customStartDate || undefined,
          customEndDate: item.customEndDate || undefined,
          activePeriodStart: item.activePeriodStart || undefined,
          activePeriodEnd: item.activePeriodEnd || undefined,
          parentRecurringBudgetId: item.parentRecurringBudgetId || undefined,
          isArchivedPeriod:
            item.isArchivedPeriod !== undefined
              ? Boolean(item.isArchivedPeriod)
              : undefined,
          scopeType: item.scopeType === 'multiple' ? 'multiple' : 'single',
          subcategories: parsedSubs,
          categories: parsedCats.length > 0 ? parsedCats : undefined,
          accountId: item.accountId || undefined,
          currency: item.currency || 'GHS',
          amount: Math.round(Number(item.amount || 0) * 100) / 100,
          alertThresholdPercent:
            item.alertThresholdPercent !== undefined
              ? Math.min(100, Math.max(1, Number(item.alertThresholdPercent)))
              : 80,
          color: item.color || undefined,
          notes: item.notes || undefined,
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString(),
        });
      });
      onData(items);
    },
    (error) => {
      if (isFirestoreOffline(error)) {
        console.warn(`Firestore subscription offline on ${path}:`, error?.message || error);
        return;
      }
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveFinancialBudget(
  userId: string,
  budget: FinancialBudget
): Promise<void> {
  const path = `users/${userId}/budgets/${budget.id}`;
  try {
    const docData: any = {
      userId,
      name: String(budget.name || 'Budget').slice(0, 150),
      periodType:
        budget.periodType === 'weekly' ||
        budget.periodType === 'yearly' ||
        budget.periodType === 'custom'
          ? budget.periodType
          : 'monthly',
      scopeType: budget.scopeType === 'multiple' ? 'multiple' : 'single',
      subcategoriesJson: JSON.stringify(budget.subcategories || []).slice(0, 9500),
      currency: String(budget.currency || 'GHS').slice(0, 10),
      amount: Math.max(0, Math.round(Number(budget.amount || 0) * 100) / 100),
      alertThresholdPercent: Math.min(
        100,
        Math.max(1, Number(budget.alertThresholdPercent ?? 80))
      ),
      createdAt: budget.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (budget.customStartDate) {
      docData.customStartDate = String(budget.customStartDate).slice(0, 30);
    }
    if (budget.customEndDate) {
      docData.customEndDate = String(budget.customEndDate).slice(0, 30);
    }
    if (budget.activePeriodStart) {
      docData.activePeriodStart = String(budget.activePeriodStart).slice(0, 30);
    }
    if (budget.activePeriodEnd) {
      docData.activePeriodEnd = String(budget.activePeriodEnd).slice(0, 30);
    }
    if (budget.parentRecurringBudgetId) {
      docData.parentRecurringBudgetId = String(budget.parentRecurringBudgetId).slice(0, 128);
    }
    if (budget.isArchivedPeriod !== undefined) {
      docData.isArchivedPeriod = Boolean(budget.isArchivedPeriod);
    }
    if (budget.categories && budget.categories.length > 0) {
      docData.categoriesJson = JSON.stringify(budget.categories).slice(0, 4800);
    }
    if (budget.accountId) {
      docData.accountId = String(budget.accountId).slice(0, 128);
    }
    if (budget.color) {
      docData.color = String(budget.color).slice(0, 30);
    }
    if (budget.notes) {
      docData.notes = String(budget.notes).slice(0, 500);
    }

    await setDoc(doc(db, 'users', userId, 'budgets', budget.id), docData);
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore write offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFinancialBudget(
  userId: string,
  budgetId: string
): Promise<void> {
  const path = `users/${userId}/budgets/${budgetId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'budgets', budgetId));
  } catch (error) {
    if (isFirestoreOffline(error)) {
      console.warn(`Firestore delete offline on ${path}:`, (error as any)?.message || error);
      return;
    }
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==================== CLEAN SHEET WIPE ====================

export async function clearAllTransactionsAndTransfers(userId: string): Promise<void> {
  setLocalData('incomes', [], userId);
  setLocalData('expenses', [], userId);
  setLocalData('transfers', [], userId);
  setLocalData('budgets', [], userId);
  setLocalData('revisions', [], userId);

  const localAccounts = getLocalData<FinancialAccount[]>('accounts', DEFAULT_FINANCIAL_ACCOUNTS, userId);
  const zeroedAccounts = localAccounts.map((a) => ({ ...a, initialBalance: 0 }));
  setLocalData('accounts', zeroedAccounts, userId);
  clearUnassignedLocalData();

  if (!userId || userId === 'guest_user') return;

  try {
    const incSnap = await getDocs(collection(db, 'users', userId, 'incomes'));
    for (const d of incSnap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }

    const expSnap = await getDocs(collection(db, 'users', userId, 'flexible_expenses'));
    for (const d of expSnap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }

    const transSnap = await getDocs(collection(db, 'users', userId, 'transfers'));
    for (const d of transSnap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }

    const budSnap = await getDocs(collection(db, 'users', userId, 'budgets'));
    for (const d of budSnap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }

    const accSnap = await getDocs(collection(db, 'users', userId, 'accounts'));
    for (const d of accSnap.docs) {
      const data = d.data();
      if (data.initialBalance !== 0) {
        await setDoc(
          d.ref,
          { ...data, initialBalance: 0, updatedAt: new Date().toISOString() },
          { merge: true }
        ).catch(() => {});
      }
    }

    const revSnap = await getDocs(collection(db, 'users', userId, 'revisions'));
    for (const d of revSnap.docs) {
      await deleteDoc(d.ref).catch(() => {});
    }
  } catch (error) {
    console.warn('Error during Firestore clean sheet wipe:', error);
  }
}
