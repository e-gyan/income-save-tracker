import React, { useState, useEffect, useMemo } from 'react';
import {
  UserSettings,
  CustomDeduction,
  SavingsBucket,
  FinancialAccount,
  FlexibleExpense,
  IncomeReceipt,
  AccountTransfer,
  ThemeMode,
  TotalsCurrencyMode,
  AppColorTheme,
  ExpenseCategoryPreference,
} from '../types/finance.ts';
import {
  formatAmount,
  DEFAULT_SAVINGS_BUCKETS,
  isSavingsVaultAccount,
  getNonVirtualOperatingAccounts,
  getVaultCleanName,
  LEGACY_SEEDED_CUT_IDS,
  getEffectiveSavingsPillars,
  formatSavingsCutRatesSummary,
  getEffectiveExpenseCategoryPreferences,
  resolveDeductionExpenseMapping,
  EXPENSE_SUBCATEGORY_COLOR_PALETTE,
  resolveIntuitiveSubcategoryColor,
  getSubcategoryBadgeStyle,
  APP_VERSION,
  VERSION_RELEASE_LOG,
} from '../lib/calculations.ts';
import { APP_COLOR_THEMES, getColorThemeConfig } from '../lib/colorThemes.ts';
import { User } from '../lib/firebase.ts';
import { WrapSelect } from './WrapSelect.tsx';

interface ParsedImportPayload {
  incomes: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>[];
  expenses: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[];
  accounts: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt'>[];
  transfers: Omit<AccountTransfer, 'id' | 'createdAt'>[];
}

interface SettingsViewProps {
  settings: UserSettings;
  accounts: FinancialAccount[];
  expenses?: FlexibleExpense[];
  currentUser: User | null;
  onSaveSettings: (settings: UserSettings) => Promise<void>;
  isSaving: boolean;
  onAddSavingsStructure?: (
    structureData: Omit<SavingsBucket, 'id'>,
    accountDetails?: { institution?: string; color?: string; initialBalance?: number }
  ) => Promise<void>;
  onImportRecords?: (payload: ParsedImportPayload) => Promise<void>;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'GHS', 'NGN', 'KES', 'ZAR', 'CAD', 'AUD'];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  accounts,
  expenses = [],
  currentUser,
  onSaveSettings,
  isSaving,
  onImportRecords,
}) => {
  const [currency, setCurrency] = useState(settings.currency || 'USD');
  const [totalsCurrencyMode, setTotalsCurrencyMode] =
    useState<TotalsCurrencyMode>(settings.totalsCurrencyMode || 'base');
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode || 'light');
  const [colorTheme, setColorTheme] = useState<AppColorTheme>(
    settings.colorTheme || 'emerald'
  );
  const [customCuts, setCustomCuts] = useState<CustomDeduction[]>(
    (settings.customCuts || []).filter((c) => !LEGACY_SEEDED_CUT_IDS.has(c.id))
  );
  const [expensePrefs, setExpensePrefs] = useState<ExpenseCategoryPreference[]>(
    settings.expenseCategoryPreferences || []
  );
  const [vaultCustodians, setVaultCustodians] = useState<Record<string, string>>(
    settings.vaultCustodianAccounts || {}
  );
  const [savingsBuckets, setSavingsBuckets] = useState<SavingsBucket[]>(
    settings.savingsBuckets && Array.isArray(settings.savingsBuckets)
      ? settings.savingsBuckets
      : DEFAULT_SAVINGS_BUCKETS
  );
  const [askNetIncomeTransfer, setAskNetIncomeTransfer] = useState<boolean>(
    settings.askNetIncomeTransfer !== false
  );
  const [defaultNetIncomeAccountId, setDefaultNetIncomeAccountId] = useState<string>(
    settings.defaultNetIncomeAccountId || ''
  );

  // All expandable forms and sections start collapsed by default
  const [isColorsCollapsed, setIsColorsCollapsed] = useState(true);
  const [isExpensePrefsCollapsed, setIsExpensePrefsCollapsed] = useState(true);
  const [isVaultCustodianCollapsed, setIsVaultCustodianCollapsed] = useState(true);
  const [isNetRoutingCollapsed, setIsNetRoutingCollapsed] = useState(true);
  const [isNewRuleCollapsed, setIsNewRuleCollapsed] = useState(true);
  const [isRulesListCollapsed, setIsRulesListCollapsed] = useState(true);
  const [isImportCollapsed, setIsImportCollapsed] = useState(true);
  const [isVersionLogCollapsed, setIsVersionLogCollapsed] = useState(true);

  // Backend File Import State
  const [importFileName, setImportFileName] = useState('');
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [isSavingImport, setIsSavingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [parsedImport, setParsedImport] = useState<ParsedImportPayload | null>(null);

  // New Savings Vault Form State (Settings is the exclusive place to add/modify vaults & rates)
  const [newVaultName, setNewVaultName] = useState('');
  const [newVaultRate, setNewVaultRate] = useState('');
  const [newVaultIsVirtual, setNewVaultIsVirtual] = useState(true);
  const [newVaultCustodianId, setNewVaultCustodianId] = useState('');
  const [confirmDeleteVaultId, setConfirmDeleteVaultId] = useState<string | null>(null);

  // Expense Category & Subcategory state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSubcategoryMap, setNewSubcategoryMap] = useState<Record<string, string>>({});
  const [newSubcategoryColorMap, setNewSubcategoryColorMap] = useState<Record<string, string>>({});
  const [activeSubColorPicker, setActiveSubColorPicker] = useState<{
    catId: string;
    subName: string;
  } | null>(null);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);

  // New Deduction Rule Form State
  const [newCutName, setNewCutName] = useState('');
  const [newCutType, setNewCutType] = useState<'percentage' | 'fixed'>('percentage');
  const [newCutAmount, setNewCutAmount] = useState('');
  const [newCutQ1, setNewCutQ1] = useState('10');
  const [newCutQ2, setNewCutQ2] = useState('15');
  const [newCutQ3, setNewCutQ3] = useState('20');
  const [newCutQ4, setNewCutQ4] = useState('25');
  const [newCutRouteMode, setNewCutRouteMode] = useState<'expense' | 'savings_split'>(
    'expense'
  );
  const [newCutExpenseCategory, setNewCutExpenseCategory] = useState('');
  const [newCutExpenseSubcategory, setNewCutExpenseSubcategory] = useState('');

  // Inline Edit Deduction Rule State
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editCutName, setEditCutName] = useState('');
  const [editCutType, setEditCutType] = useState<'percentage' | 'fixed'>('percentage');
  const [editCutAmount, setEditCutAmount] = useState('');
  const [editCutQ1, setEditCutQ1] = useState('10');
  const [editCutQ2, setEditCutQ2] = useState('15');
  const [editCutQ3, setEditCutQ3] = useState('20');
  const [editCutQ4, setEditCutQ4] = useState('25');
  const [editCutRouteMode, setEditCutRouteMode] = useState<'expense' | 'savings_split'>(
    'expense'
  );
  const [editCutExpenseCategory, setEditCutExpenseCategory] = useState('');
  const [editCutExpenseSubcategory, setEditCutExpenseSubcategory] = useState('');
  const [confirmDeleteCutId, setConfirmDeleteCutId] = useState<string | null>(null);

  const [savedNotice, setSavedNotice] = useState(false);

  // Effective Expense Categories (including learned categories from expenses & "Giving and Speaking" -> "Givings")
  const effectiveExpensePrefs = useMemo(
    () =>
      getEffectiveExpenseCategoryPreferences(
        {
          ...settings,
          expenseCategoryPreferences: expensePrefs,
        },
        expenses
      ),
    [settings, expensePrefs, expenses]
  );

  // Sync local state when settings change
  useEffect(() => {
    setCurrency(settings.currency || 'USD');
    setTotalsCurrencyMode(settings.totalsCurrencyMode || 'base');
    setThemeMode(settings.themeMode || 'light');
    setColorTheme(settings.colorTheme || 'emerald');
    setCustomCuts(
      (settings.customCuts || []).filter((c) => !LEGACY_SEEDED_CUT_IDS.has(c.id))
    );
    setExpensePrefs(settings.expenseCategoryPreferences || []);
    setVaultCustodians(settings.vaultCustodianAccounts || {});
    setSavingsBuckets(
      settings.savingsBuckets && Array.isArray(settings.savingsBuckets)
        ? settings.savingsBuckets
        : DEFAULT_SAVINGS_BUCKETS
    );
    setAskNetIncomeTransfer(settings.askNetIncomeTransfer !== false);
    setDefaultNetIncomeAccountId(settings.defaultNetIncomeAccountId || '');
  }, [settings]);

  const effectiveSavingsPillars = useMemo(
    () =>
      getEffectiveSavingsPillars({
        ...settings,
        savingsBuckets,
      }),
    [settings, savingsBuckets]
  );

  const totalVaultRateSum = useMemo(
    () =>
      Math.round(
        effectiveSavingsPillars.reduce((sum, p) => sum + p.percentage, 0) * 100
      ) / 100,
    [effectiveSavingsPillars]
  );

  // Auto-resolve expense category & subcategory as user types newCutName
  const handleNewCutNameChange = (val: string) => {
    setNewCutName(val);
    const lower = val.trim().toLowerCase();
    if (lower === 'savings' || lower.includes('saving')) {
      setNewCutRouteMode('savings_split');
    } else if (val.trim()) {
      const resolved = resolveDeductionExpenseMapping(
        { name: val },
        { ...settings, expenseCategoryPreferences: expensePrefs },
        expenses
      );
      setNewCutExpenseCategory(resolved.category);
      setNewCutExpenseSubcategory(resolved.subcategory);
    }
  };

  const operatingAccounts = accounts.filter(
    (a) => !isSavingsVaultAccount(a, { ...settings, savingsBuckets })
  );

  const nonVirtualMainAccounts = useMemo(
    () => getNonVirtualOperatingAccounts(accounts, { ...settings, savingsBuckets }),
    [accounts, settings, savingsBuckets]
  );

  const persistUpdates = async (overrides: Partial<UserSettings>) => {
    const nextSettings: UserSettings = {
      ...settings,
      currency,
      totalsCurrencyMode,
      themeMode,
      colorTheme,
      customCuts,
      savingsBuckets,
      expenseCategoryPreferences: expensePrefs,
      vaultCustodianAccounts: vaultCustodians,
      askNetIncomeTransfer,
      defaultNetIncomeAccountId,
      ...overrides,
      updatedAt: new Date().toISOString(),
    };
    await onSaveSettings(nextSettings);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleThemeChange = async (nextMode: ThemeMode) => {
    setThemeMode(nextMode);
    await persistUpdates({ themeMode: nextMode });
  };

  const handleColorThemeSelect = async (nextColor: AppColorTheme) => {
    setColorTheme(nextColor);
    await persistUpdates({ colorTheme: nextColor });
  };

  const handleCurrencySelect = async (nextCurr: string) => {
    setCurrency(nextCurr);
    await persistUpdates({ currency: nextCurr });
  };

  const handleTotalsCurrencyModeChange = async (nextMode: TotalsCurrencyMode) => {
    setTotalsCurrencyMode(nextMode);
    await persistUpdates({ totalsCurrencyMode: nextMode });
  };

  const handleDownloadSampleCsv = () => {
    const sampleCsv = [
      'type,date,source_or_recipient,category,subcategory,currency,amount,account,notes',
      `income,${new Date().toISOString().slice(0, 10)},Monthly Salary,Salary,,${currency},5000,${operatingAccounts[0]?.name || 'Main Operating Account'},Primary Employer`,
      `expense,${new Date().toISOString().slice(0, 10)},Electricity Grid,Utilities,Electricity,${currency},250,${operatingAccounts[0]?.name || 'Main Operating Account'},Monthly bill`,
      `account,${new Date().toISOString().slice(0, 10)},USD Treasury Account,Operating Account,,USD,1200,Ecobank,Foreign currency account`,
    ].join('\n');

    const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'SaveNKnow_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileImportSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportSuccessMsg(null);
    setIsParsingImport(true);

    try {
      const lowerName = file.name.toLowerCase();
      let content = '';
      let base64Data = '';

      if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
        const arrayBuf = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64Data = btoa(binary);
      } else if (lowerName.endsWith('.bak')) {
        content = await file.text();
        const arrayBuf = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64Data = btoa(binary);
      } else {
        content = await file.text();
      }

      const response = await fetch('/api/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'text/plain',
          content,
          base64Data: base64Data || undefined,
          isBase64: Boolean(base64Data),
          baseCurrency: currency,
          accounts: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            currency: a.currency || currency,
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to parse file on backend');
      }

      const data = await response.json();
      const defaultAccId =
        operatingAccounts.find((a) => a.isDefaultDeposit)?.id ||
        operatingAccounts[0]?.id ||
        accounts[0]?.id ||
        'acc-main-op';

      const mappedIncomes: Omit<
        IncomeReceipt,
        'id' | 'createdAt' | 'updatedAt' | 'userId'
      >[] = (data.incomes || []).map((inc: Record<string, unknown>) => ({
        date: String(inc.date || new Date().toISOString().slice(0, 10)),
        quarter: (inc.quarter as IncomeReceipt['quarter']) || 'Q1',
        clientOrSource: String(inc.clientOrSource || 'Imported Income'),
        category: String(inc.category || 'General'),
        accountId: String(inc.accountId || defaultAccId),
        currency: String(inc.currency || currency).toUpperCase(),
        originalGrossAmount: Number(inc.originalGrossAmount ?? inc.grossAmount ?? 0),
        exchangeRate: Number(inc.exchangeRate ?? 1),
        grossAmount: Number(inc.grossAmount ?? 0),
        savingsRate: Number(inc.savingsRate ?? 0),
        receiptId: String(
          inc.receiptId || `IMP-${Date.now().toString().slice(-5)}`
        ),
        notes: String(inc.notes || ''),
      }));

      const mappedExpenses: Omit<
        FlexibleExpense,
        'id' | 'createdAt' | 'userId'
      >[] = (data.expenses || []).map((exp: Record<string, unknown>) => ({
        date: String(exp.date || new Date().toISOString().slice(0, 10)),
        accountId: String(exp.accountId || defaultAccId),
        recipient: exp.recipient ? String(exp.recipient) : undefined,
        category: String(exp.category || 'General'),
        subcategory: exp.subcategory ? String(exp.subcategory) : undefined,
        notes: exp.notes ? String(exp.notes) : undefined,
        description: String(
          exp.description || exp.recipient || exp.category || 'Imported Expense'
        ),
        currency: String(exp.currency || currency).toUpperCase(),
        originalAmount: Number(exp.originalAmount ?? exp.amount ?? 0),
        exchangeRate: Number(exp.exchangeRate ?? 1),
        amount: Number(exp.amount ?? 0),
      }));

      const mappedAccounts: Omit<
        FinancialAccount,
        'id' | 'createdAt' | 'updatedAt'
      >[] = (data.accounts || []).map((acc: Record<string, unknown>) => ({
        name: String(acc.name || 'Imported Account'),
        institution: String(acc.institution || 'Financial Institution'),
        type: String(acc.type || 'Operating Account'),
        currency: String(acc.currency || currency).toUpperCase(),
        originalInitialBalance: Number(
          acc.originalInitialBalance ?? acc.initialBalance ?? 0
        ),
        exchangeRate: Number(acc.exchangeRate ?? 1),
        initialBalance: Number(acc.initialBalance ?? 0),
        description: String(acc.description || 'Imported account'),
        color: '#059669',
        isDefaultDeposit: false,
        isVirtual: Boolean(acc.isVirtual),
      }));

      const mappedTransfers: Omit<AccountTransfer, 'id' | 'createdAt'>[] = (
        data.transfers || []
      ).map((tr: Record<string, unknown>) => ({
        date: String(tr.date || new Date().toISOString().slice(0, 10)),
        sourceAccountId: String(tr.sourceAccountId || defaultAccId),
        destinationAccountId: String(
          tr.destinationAccountId ||
            accounts.find((a) => a.id !== defaultAccId)?.id ||
            defaultAccId
        ),
        sourceCurrency: String(tr.sourceCurrency || currency).toUpperCase(),
        sourceAmount: Number(tr.sourceAmount ?? tr.amount ?? 0),
        destinationCurrency: String(
          tr.destinationCurrency || currency
        ).toUpperCase(),
        destinationAmount: Number(tr.destinationAmount ?? tr.amount ?? 0),
        exchangeRate: Number(tr.exchangeRate ?? 1),
        amount: Number(tr.amount ?? 0),
        transferType: 'general',
        description: String(tr.description || 'Imported transfer'),
      }));

      const totalFound =
        mappedIncomes.length +
        mappedExpenses.length +
        mappedAccounts.length +
        mappedTransfers.length;

      if (totalFound === 0) {
        setImportError(
          'No valid records found. Check the file format or download the sample template.'
        );
        setParsedImport(null);
      } else {
        setParsedImport({
          incomes: mappedIncomes,
          expenses: mappedExpenses,
          accounts: mappedAccounts,
          transfers: mappedTransfers,
        });
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Unable to parse selected file'
      );
      setParsedImport(null);
    } finally {
      setIsParsingImport(false);
      e.target.value = '';
    }
  };

  const handleConfirmSaveImport = async () => {
    if (!parsedImport || !onImportRecords) return;
    setIsSavingImport(true);
    setImportError(null);
    try {
      await onImportRecords(parsedImport);
      const count =
        parsedImport.incomes.length +
        parsedImport.expenses.length +
        parsedImport.accounts.length +
        parsedImport.transfers.length;
      setImportSuccessMsg(
        `Saved ${count} imported ${count === 1 ? 'record' : 'records'} to database.`
      );
      setParsedImport(null);
      setImportFileName('');
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to save imported records'
      );
    } finally {
      setIsSavingImport(false);
    }
  };

  // Expense Category & Subcategory Handlers
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (expensePrefs.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewCategoryName('');
      return;
    }
    const nextPrefs: ExpenseCategoryPreference[] = [
      ...expensePrefs,
      {
        id: `exp_cat_${Date.now()}`,
        name: trimmed,
        subcategories: [],
      },
    ];
    setExpensePrefs(nextPrefs);
    setNewCategoryName('');
    await persistUpdates({
      expenseCategoryPreferences: nextPrefs,
      expenseCategories: nextPrefs.map((c) => c.name),
    });
  };

  const handleSaveRenameCategory = async (catId: string) => {
    const trimmed = editingCatName.trim();
    if (!trimmed) return;
    const nextPrefs = expensePrefs.map((c) =>
      c.id === catId ? { ...c, name: trimmed } : c
    );
    setExpensePrefs(nextPrefs);
    setEditingCatId(null);
    setEditingCatName('');
    await persistUpdates({
      expenseCategoryPreferences: nextPrefs,
      expenseCategories: nextPrefs.map((c) => c.name),
    });
  };

  const handleDeleteCategory = async (catId: string) => {
    const nextPrefs = expensePrefs.filter((c) => c.id !== catId);
    setExpensePrefs(nextPrefs);
    setConfirmDeleteCatId(null);
    await persistUpdates({
      expenseCategoryPreferences: nextPrefs,
      expenseCategories: nextPrefs.map((c) => c.name),
    });
  };

  const handleAddSubcategory = async (catId: string) => {
    const raw = (newSubcategoryMap[catId] || '').trim();
    if (!raw) return;
    const nextPrefs = expensePrefs.map((c) => {
      if (c.id !== catId) return c;
      if (c.subcategories.some((s) => s.toLowerCase() === raw.toLowerCase())) return c;
      const resolvedColor =
        newSubcategoryColorMap[catId] ||
        resolveIntuitiveSubcategoryColor(raw, c.name, settings, expenses);
      return {
        ...c,
        subcategories: [...c.subcategories, raw],
        subcategoryColors: {
          ...(c.subcategoryColors || {}),
          [raw]: resolvedColor,
        },
      };
    });
    setExpensePrefs(nextPrefs);
    setNewSubcategoryMap((prev) => ({ ...prev, [catId]: '' }));
    setNewSubcategoryColorMap((prev) => {
      const next = { ...prev };
      delete next[catId];
      return next;
    });
    await persistUpdates({ expenseCategoryPreferences: nextPrefs });
  };

  const handleUpdateSubcategoryColor = async (
    catId: string,
    subName: string,
    hexColor: string
  ) => {
    const nextPrefs = expensePrefs.map((c) => {
      if (c.id !== catId) return c;
      return {
        ...c,
        subcategoryColors: {
          ...(c.subcategoryColors || {}),
          [subName]: hexColor,
        },
      };
    });
    setExpensePrefs(nextPrefs);
    setActiveSubColorPicker(null);
    await persistUpdates({ expenseCategoryPreferences: nextPrefs });
  };

  const handleRemoveSubcategory = async (catId: string, subName: string) => {
    const nextPrefs = expensePrefs.map((c) => {
      if (c.id !== catId) return c;
      const nextColors = { ...(c.subcategoryColors || {}) };
      delete nextColors[subName];
      return {
        ...c,
        subcategories: c.subcategories.filter((s) => s !== subName),
        subcategoryColors: nextColors,
      };
    });
    setExpensePrefs(nextPrefs);
    if (
      activeSubColorPicker?.catId === catId &&
      activeSubColorPicker?.subName === subName
    ) {
      setActiveSubColorPicker(null);
    }
    await persistUpdates({ expenseCategoryPreferences: nextPrefs });
  };

  // Vault Custodian Account & Savings Vault CRUD Handlers (Add, Rename, Rate, Virtual, Delete)
  const handleVaultCustodianChange = async (
    vaultAccountId: string,
    custodianAccountId: string
  ) => {
    const nextMap = { ...vaultCustodians };
    if (custodianAccountId) {
      nextMap[vaultAccountId] = custodianAccountId;
    } else {
      delete nextMap[vaultAccountId];
    }
    const nextBuckets = savingsBuckets.map((b) =>
      b.accountId === vaultAccountId
        ? { ...b, custodianAccountId: custodianAccountId || undefined }
        : b
    );
    setVaultCustodians(nextMap);
    setSavingsBuckets(nextBuckets);
    await persistUpdates({
      savingsBuckets: nextBuckets,
      vaultCustodianAccounts: nextMap,
    });
  };

  const handleVaultVirtualToggle = async (
    bucketId: string,
    vaultAccountId: string,
    nextIsVirtual: boolean
  ) => {
    const defaultMainId =
      vaultCustodians[vaultAccountId] ||
      nonVirtualMainAccounts[0]?.id ||
      operatingAccounts[0]?.id ||
      '';
    const nextMap = { ...vaultCustodians };
    if (nextIsVirtual && defaultMainId) {
      nextMap[vaultAccountId] = defaultMainId;
    } else if (!nextIsVirtual) {
      delete nextMap[vaultAccountId];
    }
    const nextBuckets = savingsBuckets.map((b) =>
      b.id === bucketId || b.accountId === vaultAccountId
        ? {
            ...b,
            isVirtual: nextIsVirtual,
            custodianAccountId: nextIsVirtual ? defaultMainId : undefined,
          }
        : b
    );
    setVaultCustodians(nextMap);
    setSavingsBuckets(nextBuckets);
    await persistUpdates({
      savingsBuckets: nextBuckets,
      vaultCustodianAccounts: nextMap,
    });
  };

  const handleVaultNameChange = (bucketId: string, rawName: string) => {
    const cleanBase = getVaultCleanName(rawName);
    const nextBuckets: SavingsBucket[] = savingsBuckets.map((b) => {
      if (b.id !== bucketId) return b;
      const pct = typeof b.percentage === 'number' ? b.percentage : 0;
      return {
        ...b,
        name: cleanBase ? `${cleanBase} (${pct}%)` : ` (${pct}%)`,
      };
    });
    setSavingsBuckets(nextBuckets);
  };

  const handleVaultRateChange = (bucketId: string, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    const cleanPct =
      rawVal.trim() === '' || isNaN(parsed)
        ? 0
        : Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));

    const nextBuckets: SavingsBucket[] = savingsBuckets.map((b) => {
      if (b.id !== bucketId) return b;
      const baseName = getVaultCleanName(b.name) || 'Savings Vault';
      return {
        ...b,
        name: `${baseName} (${cleanPct}%)`,
        percentage: cleanPct,
        description: `${cleanPct}% savings share`,
      };
    });

    setSavingsBuckets(nextBuckets);
  };

  const handleAddVault = async (e: React.FormEvent) => {
    e.preventDefault();
    const baseName = getVaultCleanName(newVaultName);
    if (!baseName) return;
    const parsedRate = parseFloat(newVaultRate);
    const cleanPct =
      newVaultRate.trim() === '' || isNaN(parsedRate)
        ? 0
        : Math.max(0, Math.min(100, Math.round(parsedRate * 100) / 100));

    const nowId = Date.now();
    const bucketId = `bucket_${nowId}`;
    const accountId = `acc_sav_${nowId}`;
    const resolvedCustodianId = newVaultIsVirtual
      ? newVaultCustodianId ||
        nonVirtualMainAccounts[0]?.id ||
        operatingAccounts[0]?.id ||
        ''
      : '';

    const newBucket: SavingsBucket = {
      id: bucketId,
      accountId,
      name: `${baseName} (${cleanPct}%)`,
      percentage: cleanPct,
      description: `${cleanPct}% savings share`,
      isVirtual: newVaultIsVirtual,
      custodianAccountId: resolvedCustodianId || undefined,
    };

    const nextBuckets = [...savingsBuckets, newBucket];
    const nextCustodians = { ...vaultCustodians };
    if (newVaultIsVirtual && resolvedCustodianId) {
      nextCustodians[accountId] = resolvedCustodianId;
    }

    setSavingsBuckets(nextBuckets);
    setVaultCustodians(nextCustodians);
    setNewVaultName('');
    setNewVaultRate('');
    setNewVaultIsVirtual(true);
    setNewVaultCustodianId('');
    await persistUpdates({
      savingsBuckets: nextBuckets,
      vaultCustodianAccounts: nextCustodians,
    });
  };

  const handleDeleteVault = async (bucketId: string, accountId: string) => {
    const nextBuckets = savingsBuckets.filter(
      (b) => b.id !== bucketId && b.accountId !== accountId
    );
    const nextCustodians = { ...vaultCustodians };
    delete nextCustodians[accountId];
    setSavingsBuckets(nextBuckets);
    setVaultCustodians(nextCustodians);
    setConfirmDeleteVaultId(null);
    await persistUpdates({
      savingsBuckets: nextBuckets,
      vaultCustodianAccounts: nextCustodians,
    });
  };

  const handleSaveVaultRates = async () => {
    const normalizedBuckets = savingsBuckets.map((b) => {
      const baseName = getVaultCleanName(b.name) || 'Savings Vault';
      const pct = typeof b.percentage === 'number' ? b.percentage : 0;
      return {
        ...b,
        name: `${baseName} (${pct}%)`,
      };
    });
    setSavingsBuckets(normalizedBuckets);
    await persistUpdates({ savingsBuckets: normalizedBuckets });
  };

  const handleResetDefaultVaultRates = async () => {
    setSavingsBuckets(DEFAULT_SAVINGS_BUCKETS);
    await persistUpdates({ savingsBuckets: DEFAULT_SAVINGS_BUCKETS });
  };

  // Deduction Rule Handlers
  const handleAddCut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCutName.trim()) return;

    const isSavings =
      newCutRouteMode === 'savings_split' ||
      newCutName.trim().toLowerCase() === 'savings' ||
      newCutName.trim().toLowerCase().includes('saving');

    let baseAmount = parseFloat(newCutAmount);
    let quarterlyRatesObj:
      | { Q1: number; Q2: number; Q3: number; Q4: number }
      | undefined;

    if (isSavings) {
      const q1 = Math.max(0.01, parseFloat(newCutQ1) || parseFloat(newCutAmount) || 10);
      const q2 = Math.max(0.01, parseFloat(newCutQ2) || q1);
      const q3 = Math.max(0.01, parseFloat(newCutQ3) || q2);
      const q4 = Math.max(0.01, parseFloat(newCutQ4) || q3);
      baseAmount = q1;
      quarterlyRatesObj = { Q1: q1, Q2: q2, Q3: q3, Q4: q4 };
    } else {
      if (isNaN(baseAmount) || baseAmount <= 0) return;
    }

    const resolved = !isSavings
      ? resolveDeductionExpenseMapping(
          {
            name: newCutName.trim(),
            expenseCategory: newCutExpenseCategory,
            expenseSubcategory: newCutExpenseSubcategory,
          },
          { ...settings, expenseCategoryPreferences: expensePrefs },
          expenses
        )
      : undefined;

    const newCut: CustomDeduction = {
      id: `cut_${Date.now()}`,
      name: newCutName.trim(),
      type: newCutType,
      amount: baseAmount,
      quarterlyRates: quarterlyRatesObj,
      enabled: true,
      isSavingsSplit: isSavings,
      expenseCategory: resolved?.category,
      expenseSubcategory: resolved?.subcategory,
    };

    const nextCuts = [...customCuts, newCut];
    setCustomCuts(nextCuts);
    setNewCutName('');
    setNewCutAmount('');
    setNewCutQ1('10');
    setNewCutQ2('15');
    setNewCutQ3('20');
    setNewCutQ4('25');
    setNewCutRouteMode('expense');
    setNewCutExpenseCategory('');
    setNewCutExpenseSubcategory('');
    await persistUpdates({ customCuts: nextCuts });
  };

  const handleStartEditCut = (cut: CustomDeduction) => {
    setEditingCutId(cut.id);
    setEditCutName(cut.name);
    setEditCutType(cut.type);
    setEditCutAmount(String(cut.amount));
    const isSav =
      Boolean(cut.isSavingsSplit) ||
      cut.name.trim().toLowerCase() === 'savings' ||
      cut.name.trim().toLowerCase().includes('saving');
    setEditCutRouteMode(isSav ? 'savings_split' : 'expense');
    setEditCutQ1(String(cut.quarterlyRates?.Q1 ?? cut.amount ?? 10));
    setEditCutQ2(String(cut.quarterlyRates?.Q2 ?? cut.amount ?? 15));
    setEditCutQ3(String(cut.quarterlyRates?.Q3 ?? cut.amount ?? 20));
    setEditCutQ4(String(cut.quarterlyRates?.Q4 ?? cut.amount ?? 25));

    const resolved = !isSav
      ? resolveDeductionExpenseMapping(
          cut,
          {
            ...settings,
            expenseCategoryPreferences: expensePrefs,
          },
          expenses
        )
      : { category: '', subcategory: '' };
    setEditCutExpenseCategory(resolved.category);
    setEditCutExpenseSubcategory(resolved.subcategory);
  };

  const handleSaveEditCut = async (cutId: string) => {
    if (!editCutName.trim()) return;

    const isSavings =
      editCutRouteMode === 'savings_split' ||
      editCutName.trim().toLowerCase() === 'savings' ||
      editCutName.trim().toLowerCase().includes('saving');

    let baseAmount = parseFloat(editCutAmount);
    let quarterlyRatesObj:
      | { Q1: number; Q2: number; Q3: number; Q4: number }
      | undefined;

    if (isSavings) {
      const q1 = Math.max(0.01, parseFloat(editCutQ1) || parseFloat(editCutAmount) || 10);
      const q2 = Math.max(0.01, parseFloat(editCutQ2) || q1);
      const q3 = Math.max(0.01, parseFloat(editCutQ3) || q2);
      const q4 = Math.max(0.01, parseFloat(editCutQ4) || q3);
      baseAmount = q1;
      quarterlyRatesObj = { Q1: q1, Q2: q2, Q3: q3, Q4: q4 };
    } else {
      if (isNaN(baseAmount) || baseAmount <= 0) return;
    }

    const resolved = !isSavings
      ? resolveDeductionExpenseMapping(
          {
            name: editCutName.trim(),
            expenseCategory: editCutExpenseCategory,
            expenseSubcategory: editCutExpenseSubcategory,
          },
          { ...settings, expenseCategoryPreferences: expensePrefs },
          expenses
        )
      : undefined;

    const nextCuts = customCuts.map((c) =>
      c.id === cutId
        ? {
            ...c,
            name: editCutName.trim(),
            type: editCutType,
            amount: baseAmount,
            quarterlyRates: quarterlyRatesObj,
            isSavingsSplit: isSavings,
            destinationAccountId: undefined,
            expenseCategory: resolved?.category,
            expenseSubcategory: resolved?.subcategory,
          }
        : c
    );
    setCustomCuts(nextCuts);
    setEditingCutId(null);
    await persistUpdates({ customCuts: nextCuts });
  };

  const handleToggleCut = async (cutId: string) => {
    const nextCuts = customCuts.map((c) =>
      c.id === cutId ? { ...c, enabled: !c.enabled } : c
    );
    setCustomCuts(nextCuts);
    await persistUpdates({ customCuts: nextCuts });
  };

  const handleDeleteCut = async (cutId: string) => {
    const nextCuts = customCuts.filter((c) => c.id !== cutId);
    setCustomCuts(nextCuts);
    setConfirmDeleteCutId(null);
    await persistUpdates({ customCuts: nextCuts });
  };

  const activeColorConfig = getColorThemeConfig(colorTheme);

  const selectedNewPref =
    effectiveExpensePrefs.find((p) => p.name === newCutExpenseCategory) ||
    effectiveExpensePrefs[0];

  const selectedEditPref =
    effectiveExpensePrefs.find((p) => p.name === editCutExpenseCategory) ||
    effectiveExpensePrefs[0];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 break-words">
              Settings
            </h1>
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
              Save N Know · v{APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 break-words">
            {currentUser?.email
              ? `Synced to ${currentUser.email}`
              : 'Preferences and defined deductions'}
          </p>
        </div>

        {savedNotice && (
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold text-white shrink-0"
            style={{ backgroundColor: activeColorConfig.primary }}
          >
            ✓ Saved
          </span>
        )}
      </div>

      {/* Appearance & Currency Bar */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Theme Mode */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Theme Mode
            </label>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-100 p-1">
              {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleThemeChange(mode)}
                  className={`rounded-md py-1.5 px-2.5 text-xs font-semibold capitalize transition-colors ${
                    themeMode === mode
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mode === 'system' ? 'Auto' : mode}
                </button>
              ))}
            </div>
          </div>

          {/* System Base Currency */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              System Base Currency
            </label>
            <WrapSelect
              value={currency}
              onChange={(val) => handleCurrencySelect(val)}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>

          {/* Global Totals Currency Toggle */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              View Totals In
            </label>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => handleTotalsCurrencyModeChange('base')}
                className={`rounded-md py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  totalsCurrencyMode === 'base'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Base ({currency})
              </button>
              <button
                type="button"
                onClick={() => handleTotalsCurrencyModeChange('original')}
                className={`rounded-md py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  totalsCurrencyMode === 'original'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Account Currency
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {totalsCurrencyMode === 'original'
                ? 'Shows totals in each account’s original currency with real-time market conversion.'
                : `Consolidates all totals into ${currency} using real-time market rates.`}
            </p>
          </div>
        </div>

        {/* Collapsible App Color Options */}
        <div className="border-t border-slate-100 pt-4">
          <div
            onClick={() => setIsColorsCollapsed((prev) => !prev)}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="h-3.5 w-3.5 rounded-full shrink-0"
                style={{ backgroundColor: activeColorConfig.primary }}
              />
              <div className="min-w-0">
                <div className="font-display text-sm font-semibold text-slate-900 break-words">
                  App Color Palette
                </div>
                <div className="text-xs text-slate-500 break-words">
                  {activeColorConfig.name} · {activeColorConfig.functionLabel}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsColorsCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isColorsCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isColorsCollapsed ? '' : 'rotate-180'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {!isColorsCollapsed && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {APP_COLOR_THEMES.map((theme) => {
                const isSelected = theme.id === colorTheme;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => handleColorThemeSelect(theme.id)}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900/10'
                        : 'border-slate-200/80 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="mt-0.5 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: theme.primary }}
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-xs font-semibold text-slate-900 break-words">
                        {theme.name}
                      </div>
                      <div className="text-[11px] font-medium text-slate-600 mt-0.5 break-words">
                        {theme.functionLabel}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 break-words">
                        {theme.uxInsight}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Expense Categories & Subcategories Preference (Collapsible) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsExpensePrefsCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isExpensePrefsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Expense Categories & Subcategories ({expensePrefs.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Define categories and subcategories used by Expenses and Income Deduction Expenses
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpensePrefsCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isExpensePrefsCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isExpensePrefsCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!isExpensePrefsCollapsed && (
          <div className="space-y-4">
            <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New expense category name (e.g. Giving and Speaking)..."
                className="w-full sm:flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSaving || !newCategoryName.trim()}
                className="w-full sm:w-auto rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
              >
                + Add Category
              </button>
            </form>

            {expensePrefs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                No custom expense categories defined yet. Add your categories above.
              </div>
            ) : (
              <div className="space-y-3">
                {expensePrefs.map((cat) => {
                  const isEditingCat = editingCatId === cat.id;
                  const isConfirmingDel = confirmDeleteCatId === cat.id;

                  return (
                    <div
                      key={cat.id}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        {isEditingCat ? (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 w-full">
                            <input
                              type="text"
                              value={editingCatName}
                              onChange={(e) => setEditingCatName(e.target.value)}
                              className="w-full sm:flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 sm:py-1 text-xs text-slate-900"
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => handleSaveRenameCategory(cat.id)}
                                className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCatId(null)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="font-display text-xs font-semibold text-slate-900 break-words">
                              {cat.name}
                            </span>
                            <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 shrink-0">
                              {cat.subcategories.length} subcategories
                            </span>
                          </div>
                        )}

                        {!isEditingCat && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isConfirmingDel ? (
                              <div className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5">
                                <span className="text-[11px] font-medium text-rose-800">
                                  Delete?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCategory(cat.id)}
                                  className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCatId(null)}
                                  className="rounded bg-white px-2 py-0.5 text-[11px] text-slate-600"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCatId(cat.id);
                                    setEditingCatName(cat.name);
                                  }}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCatId(cat.id)}
                                  className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-100"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {cat.subcategories.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {cat.subcategories.map((sub) => {
                              const resolvedHex = resolveIntuitiveSubcategoryColor(
                                sub,
                                cat.name,
                                { expenseCategoryPreferences: expensePrefs },
                                expenses
                              );
                              const badgeStyle = getSubcategoryBadgeStyle(resolvedHex);
                              const isPickerOpen =
                                activeSubColorPicker?.catId === cat.id &&
                                activeSubColorPicker?.subName === sub;

                              return (
                                <span
                                  key={sub}
                                  style={{
                                    backgroundColor: badgeStyle.backgroundColor,
                                    borderColor: badgeStyle.borderColor,
                                    color: badgeStyle.color,
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium break-words"
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveSubColorPicker(
                                        isPickerOpen
                                          ? null
                                          : { catId: cat.id, subName: sub }
                                      )
                                    }
                                    title="Customize subcategory color"
                                    className="h-3 w-3 rounded-full shrink-0 ring-1 ring-black/15 hover:scale-110 transition-transform"
                                    style={{ backgroundColor: resolvedHex }}
                                  />
                                  <span>{sub}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSubcategory(cat.id, sub)}
                                    className="opacity-60 hover:opacity-100 hover:text-rose-600"
                                    title="Remove Subcategory"
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                          </div>

                          {activeSubColorPicker?.catId === cat.id && (
                            <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="font-semibold text-slate-700">
                                  Color for "{activeSubColorPicker.subName}"
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveSubColorPicker(null)}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  Close
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {EXPENSE_SUBCATEGORY_COLOR_PALETTE.map((swatch) => {
                                  const currentHex = resolveIntuitiveSubcategoryColor(
                                    activeSubColorPicker.subName,
                                    cat.name,
                                    { expenseCategoryPreferences: expensePrefs },
                                    expenses
                                  );
                                  const isSelected =
                                    currentHex.toLowerCase() === swatch.hex.toLowerCase();
                                  return (
                                    <button
                                      key={swatch.id}
                                      type="button"
                                      onClick={() =>
                                        handleUpdateSubcategoryColor(
                                          cat.id,
                                          activeSubColorPicker.subName,
                                          swatch.hex
                                        )
                                      }
                                      title={swatch.label}
                                      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all ${
                                        isSelected
                                          ? 'border-slate-900 bg-slate-900 text-white'
                                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      <span
                                        className="h-2.5 w-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: swatch.hex }}
                                      />
                                      <span>{swatch.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {(() => {
                            const draftSub = (newSubcategoryMap[cat.id] || '').trim();
                            const previewColor =
                              newSubcategoryColorMap[cat.id] ||
                              resolveIntuitiveSubcategoryColor(
                                draftSub || cat.name,
                                cat.name,
                                { expenseCategoryPreferences: expensePrefs },
                                expenses
                              );
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  const curIdx = EXPENSE_SUBCATEGORY_COLOR_PALETTE.findIndex(
                                    (p) =>
                                      p.hex.toLowerCase() === previewColor.toLowerCase()
                                  );
                                  const nextSwatch =
                                    EXPENSE_SUBCATEGORY_COLOR_PALETTE[
                                      (curIdx + 1) %
                                        EXPENSE_SUBCATEGORY_COLOR_PALETTE.length
                                    ];
                                  setNewSubcategoryColorMap((prev) => ({
                                    ...prev,
                                    [cat.id]: nextSwatch.hex,
                                  }));
                                }}
                                title="Intuitive subcategory color (tap to cycle)"
                                className="flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-lg border border-slate-200 bg-white shrink-0 hover:bg-slate-50"
                              >
                                <span
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{ backgroundColor: previewColor }}
                                />
                              </button>
                            );
                          })()}
                          <input
                            type="text"
                            value={newSubcategoryMap[cat.id] || ''}
                            onChange={(e) =>
                              setNewSubcategoryMap((prev) => ({
                                ...prev,
                                [cat.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddSubcategory(cat.id);
                              }
                            }}
                            placeholder={`Add subcategory to ${cat.name}...`}
                            className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddSubcategory(cat.id)}
                          className="w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0 text-center"
                        >
                          + Subcategory
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Savings Vaults & Rates (Collapsible — Exclusive Management in Settings) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsVaultCustodianCollapsed((prev) => !prev)}
          className={`flex flex-wrap items-start justify-between gap-3 cursor-pointer select-none ${
            isVaultCustodianCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Savings Vaults & Rates
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums break-words">
                {effectiveSavingsPillars.length} Vaults
              </span>
            </div>
            <p className="text-xs text-slate-500 break-words leading-relaxed">
              Add new savings vaults, rename vaults, edit rates (%), assign holding accounts, or remove vaults
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsVaultCustodianCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isVaultCustodianCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isVaultCustodianCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!isVaultCustodianCollapsed && (
          <div className="space-y-4">
            {/* Add New Savings Vault Form */}
            <form
              onSubmit={handleAddVault}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3.5"
            >
              <div className="text-xs font-semibold text-slate-900">
                Add New Savings Vault
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Vault Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newVaultName}
                    onChange={(e) => setNewVaultName(e.target.value)}
                    placeholder="e.g. Education Vault, Real Estate"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Allocation Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    required
                    value={newVaultRate}
                    onChange={(e) => setNewVaultRate(e.target.value)}
                    placeholder="10"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 mb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newVaultIsVirtual}
                      onChange={(e) => setNewVaultIsVirtual(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                    />
                    <span>Virtual Vault (Attached to Main Account)</span>
                  </label>
                  {newVaultIsVirtual ? (
                    <WrapSelect
                      value={
                        newVaultCustodianId ||
                        nonVirtualMainAccounts[0]?.id ||
                        operatingAccounts[0]?.id ||
                        ''
                      }
                      onChange={(val) => setNewVaultCustodianId(val)}
                      options={(nonVirtualMainAccounts.length > 0
                        ? nonVirtualMainAccounts
                        : operatingAccounts
                      ).map((op) => ({
                        value: op.id,
                        label: `Attached to Main: ${op.name}`,
                      }))}
                    />
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      Standalone non-virtual savings vault
                    </div>
                  )}
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={isSaving || !newVaultName.trim()}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    + Add Vault
                  </button>
                </div>
              </div>
            </form>

            {/* Total Allocation Bar & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">
                  Total Vault Allocation:
                </span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    Math.abs(totalVaultRateSum - 100) < 0.01
                      ? 'text-emerald-700'
                      : 'text-amber-600'
                  }`}
                >
                  {totalVaultRateSum}%
                </span>
                {Math.abs(totalVaultRateSum - 100) >= 0.01 && (
                  <span className="text-[11px] text-amber-600">
                    (Standard total is 100%)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleResetDefaultVaultRates}
                  disabled={isSaving}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 text-center"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={handleSaveVaultRates}
                  disabled={isSaving}
                  className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 text-center"
                >
                  Save Vault Changes
                </button>
              </div>
            </div>

            {/* Existing Savings Vaults Grid — Clean 2-Column Stacked Layout Without Overlap */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {effectiveSavingsPillars.map((pillar, index) => {
                const isConfirmingDelete = confirmDeleteVaultId === pillar.bucketId;
                return (
                  <div
                    key={pillar.bucketId}
                    className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5"
                  >
                    {/* Card Top Header: Title + Rate Summary + Delete */}
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-sm font-semibold text-slate-900 break-words leading-snug">
                          {String(index + 1).padStart(2, '0')}. {pillar.baseName || 'Savings Vault'}
                        </div>
                        <div className="font-mono text-xs text-slate-500 tabular-nums mt-0.5">
                          Allocation share: {pillar.percentage}%
                        </div>
                      </div>

                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1.5 shrink-0 text-xs">
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteVault(pillar.bucketId, pillar.accountId)
                            }
                            className="rounded-md bg-slate-900 px-2.5 py-1 font-semibold text-white hover:bg-slate-800"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteVaultId(null)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteVaultId(pillar.bucketId)}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 shrink-0"
                          title="Delete Savings Vault"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {/* Row 1: Vault Name & Rate (%) */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-8">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Vault Name
                        </label>
                        <input
                          type="text"
                          value={pillar.baseName}
                          onChange={(e) =>
                            handleVaultNameChange(pillar.bucketId, e.target.value)
                          }
                          onBlur={handleSaveVaultRates}
                          placeholder="Vault Name"
                          aria-label="Savings vault name"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Rate (%)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={pillar.percentage}
                            onChange={(e) =>
                              handleVaultRateChange(pillar.bucketId, e.target.value)
                            }
                            onBlur={handleSaveVaultRates}
                            aria-label={`${pillar.baseName} rate percentage`}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                          />
                          <span className="font-mono text-xs font-semibold text-slate-500 shrink-0">
                            %
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Virtual Vault Checkbox & Attached Main Account */}
                    <div className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50/60 p-2.5">
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pillar.isVirtual !== false}
                          onChange={(e) =>
                            handleVaultVirtualToggle(
                              pillar.bucketId,
                              pillar.accountId,
                              e.target.checked
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                        />
                        <span>Virtual Vault (Attached to Main Account)</span>
                      </label>

                      {pillar.isVirtual !== false && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Attached Main Account
                          </label>
                          <WrapSelect
                            value={
                              vaultCustodians[pillar.accountId] ||
                              pillar.custodianAccountId ||
                              nonVirtualMainAccounts[0]?.id ||
                              operatingAccounts[0]?.id ||
                              ''
                            }
                            onChange={(val) =>
                              handleVaultCustodianChange(pillar.accountId, val)
                            }
                            options={[
                              { value: '', label: 'Select Main Account...' },
                              ...(nonVirtualMainAccounts.length > 0
                                ? nonVirtualMainAccounts
                                : operatingAccounts
                              ).map((op) => ({
                                value: op.id,
                                label: `Attached to Main: ${op.name}`,
                              })),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Defined Deductions Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: Add New Deduction Rule (Collapsible) */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
          <div
            onClick={() => setIsNewRuleCollapsed((prev) => !prev)}
            className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
              isNewRuleCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
            }`}
          >
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                New Deduction Rule
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 break-words">
                Define expenses or savings transfers for income records
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsNewRuleCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isNewRuleCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isNewRuleCollapsed ? '' : 'rotate-180'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {!isNewRuleCollapsed && (
            <form onSubmit={handleAddCut} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Deduction Name
                </label>
                <input
                  type="text"
                  required
                  value={newCutName}
                  onChange={(e) => handleNewCutNameChange(e.target.value)}
                  placeholder="e.g. Others to support, Savings, Operations"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Designation
                </label>
                <WrapSelect
                  value={newCutRouteMode}
                  onChange={(val) =>
                    setNewCutRouteMode(val as 'expense' | 'savings_split')
                  }
                  options={[
                    {
                      value: 'expense',
                      label: 'Expense (Deducted from Account)',
                    },
                    {
                      value: 'savings_split',
                      label: 'Transfer → Savings Splits',
                    },
                  ]}
                />
              </div>

              {newCutRouteMode === 'savings_split' ||
              newCutName.trim().toLowerCase() === 'savings' ||
              newCutName.trim().toLowerCase().includes('saving') ? (
                <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Quarterly Savings Rates (Auto-applied by Income Date)
                    </span>
                    <WrapSelect
                      value={newCutType}
                      onChange={(val) =>
                        setNewCutType(val as 'percentage' | 'fixed')
                      }
                      className="w-full sm:w-40"
                      triggerClassName="py-1.5 sm:py-1 px-2.5 text-[11px]"
                      options={[
                        { value: 'percentage', label: 'Percentage (%)' },
                        { value: 'fixed', label: `Fixed (${currency})` },
                      ]}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        1st Quarter (Q1)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={newCutQ1}
                        onChange={(e) => setNewCutQ1(e.target.value)}
                        placeholder="10"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        2nd Quarter (Q2)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={newCutQ2}
                        onChange={(e) => setNewCutQ2(e.target.value)}
                        placeholder="15"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        3rd Quarter (Q3)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={newCutQ3}
                        onChange={(e) => setNewCutQ3(e.target.value)}
                        placeholder="20"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        4th Quarter (Q4)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={newCutQ4}
                        onChange={(e) => setNewCutQ4(e.target.value)}
                        placeholder="25"
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Type
                      </label>
                      <WrapSelect
                        value={newCutType}
                        onChange={(val) =>
                          setNewCutType(val as 'percentage' | 'fixed')
                        }
                        options={[
                          { value: 'percentage', label: 'Percentage (%)' },
                          { value: 'fixed', label: `Fixed (${currency})` },
                        ]}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        {newCutType === 'percentage' ? 'Rate (%)' : `Amount (${currency})`}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={newCutAmount}
                        onChange={(e) => setNewCutAmount(e.target.value)}
                        placeholder={newCutType === 'percentage' ? '10' : '100'}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Expense Category
                      </label>
                      <WrapSelect
                        value={newCutExpenseCategory || selectedNewPref?.name || ''}
                        onChange={(cat) => {
                          setNewCutExpenseCategory(cat);
                          const pref = effectiveExpensePrefs.find(
                            (p) => p.name === cat
                          );
                          setNewCutExpenseSubcategory(
                            pref?.subcategories[0] || ''
                          );
                        }}
                        options={effectiveExpensePrefs.map((pref) => ({
                          value: pref.name,
                          label: pref.name,
                        }))}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Subcategory
                      </label>
                      {(selectedNewPref?.subcategories || []).length > 0 ? (
                        <WrapSelect
                          value={
                            newCutExpenseSubcategory ||
                            selectedNewPref?.subcategories[0] ||
                            ''
                          }
                          onChange={(val) => setNewCutExpenseSubcategory(val)}
                          options={[
                            ...(selectedNewPref?.subcategories || []).map(
                              (sub) => ({
                                value: sub,
                                label: sub,
                              })
                            ),
                            { value: '', label: 'None' },
                          ]}
                        />
                      ) : (
                        <input
                          type="text"
                          value={newCutExpenseSubcategory}
                          onChange={(e) =>
                            setNewCutExpenseSubcategory(e.target.value)
                          }
                          placeholder="Subcategory"
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-lg bg-slate-900 py-2.5 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                + Add Defined Deduction
              </button>
            </form>
          )}
        </div>

        {/* RIGHT: Defined Deductions List (Collapsible) */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
          <div
            onClick={() => setIsRulesListCollapsed((prev) => !prev)}
            className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
              isRulesListCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
            }`}
          >
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Defined Deductions ({customCuts.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 break-words">
                Only deductions defined here are presented on Income & Deductions
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsRulesListCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isRulesListCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isRulesListCollapsed ? '' : 'rotate-180'
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {!isRulesListCollapsed && (
            <>
              {customCuts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
                  No deductions defined yet. Add a deduction rule to use it on Income & Deductions.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {customCuts.map((cut) => {
                    const isSavings =
                      Boolean(cut.isSavingsSplit) ||
                      cut.name.trim().toLowerCase() === 'savings' ||
                      cut.name.trim().toLowerCase().includes('saving');
                    const isEditing = editingCutId === cut.id;
                    const isConfirmingDel = confirmDeleteCutId === cut.id;
                    const resolvedExp = !isSavings
                      ? resolveDeductionExpenseMapping(
                          cut,
                          {
                            ...settings,
                            expenseCategoryPreferences: expensePrefs,
                          },
                          expenses
                        )
                      : undefined;

                    const isEditSavings =
                      editCutRouteMode === 'savings_split' ||
                      editCutName.trim().toLowerCase() === 'savings' ||
                      editCutName.trim().toLowerCase().includes('saving');

                    return (
                      <div key={cut.id} className="py-3 first:pt-0 last:pb-0">
                        {isEditing ? (
                          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                  Deduction Name
                                </label>
                                <input
                                  type="text"
                                  value={editCutName}
                                  onChange={(e) => setEditCutName(e.target.value)}
                                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                  Type
                                </label>
                                <WrapSelect
                                  value={editCutType}
                                  onChange={(val) =>
                                    setEditCutType(val as 'percentage' | 'fixed')
                                  }
                                  triggerClassName="py-1.5 px-2.5 text-xs"
                                  options={[
                                    { value: 'percentage', label: 'Percentage (%)' },
                                    { value: 'fixed', label: `Fixed (${currency})` },
                                  ]}
                                />
                              </div>
                            </div>

                            {isEditSavings ? (
                              <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5">
                                <div className="text-[11px] font-semibold text-slate-800">
                                  Quarterly Savings Rates (Auto-applied by Income Date)
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      1st Quarter (Q1)
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={editCutQ1}
                                      onChange={(e) => setEditCutQ1(e.target.value)}
                                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 tabular-nums"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      2nd Quarter (Q2)
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={editCutQ2}
                                      onChange={(e) => setEditCutQ2(e.target.value)}
                                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 tabular-nums"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      3rd Quarter (Q3)
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={editCutQ3}
                                      onChange={(e) => setEditCutQ3(e.target.value)}
                                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 tabular-nums"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      4th Quarter (Q4)
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      value={editCutQ4}
                                      onChange={(e) => setEditCutQ4(e.target.value)}
                                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 tabular-nums"
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                    {editCutType === 'percentage'
                                      ? 'Rate (%)'
                                      : `Amount (${currency})`}
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={editCutAmount}
                                    onChange={(e) => setEditCutAmount(e.target.value)}
                                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                                  />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      Expense Category
                                    </label>
                                    <WrapSelect
                                      value={editCutExpenseCategory}
                                      onChange={(cat) => {
                                        setEditCutExpenseCategory(cat);
                                        const pref = effectiveExpensePrefs.find(
                                          (p) => p.name === cat
                                        );
                                        setEditCutExpenseSubcategory(
                                          pref?.subcategories[0] || ''
                                        );
                                      }}
                                      triggerClassName="py-1.5 px-2.5 text-xs"
                                      options={effectiveExpensePrefs.map((pref) => ({
                                        value: pref.name,
                                        label: pref.name,
                                      }))}
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                      Subcategory
                                    </label>
                                    {(selectedEditPref?.subcategories || []).length >
                                    0 ? (
                                      <WrapSelect
                                        value={editCutExpenseSubcategory}
                                        onChange={(val) =>
                                          setEditCutExpenseSubcategory(val)
                                        }
                                        triggerClassName="py-1.5 px-2.5 text-xs"
                                        options={[
                                          ...(selectedEditPref?.subcategories || []).map(
                                            (sub) => ({
                                              value: sub,
                                              label: sub,
                                            })
                                          ),
                                          { value: '', label: 'None' },
                                        ]}
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={editCutExpenseSubcategory}
                                        onChange={(e) =>
                                          setEditCutExpenseSubcategory(
                                            e.target.value
                                          )
                                        }
                                        placeholder="Subcategory"
                                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                                      />
                                    )}
                                  </div>
                                </div>
                              </>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <WrapSelect
                                value={editCutRouteMode}
                                onChange={(val) =>
                                  setEditCutRouteMode(
                                    val as 'expense' | 'savings_split'
                                  )
                                }
                                className="flex-1 min-w-[200px]"
                                triggerClassName="py-1.5 px-2.5 text-xs"
                                options={[
                                  {
                                    value: 'expense',
                                    label: 'Expense (Deducted from Account)',
                                  },
                                  {
                                    value: 'savings_split',
                                    label: 'Transfer → Savings Splits',
                                  },
                                ]}
                              />

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditCut(cut.id)}
                                  className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCutId(null)}
                                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={cut.enabled}
                                onChange={() => handleToggleCut(cut.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-display text-sm font-semibold text-slate-900 break-words">
                                    {cut.name}
                                  </span>
                                  <span
                                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium break-words ${
                                      isSavings
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                    }`}
                                  >
                                    {isSavings
                                      ? 'Transfer → Savings Splits'
                                      : `Expense · ${resolvedExp?.category || 'General'}${
                                          resolvedExp?.subcategory
                                            ? ` → ${resolvedExp.subcategory}`
                                            : ''
                                        }`}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="pl-6 sm:pl-0 flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                              <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-900 tabular-nums break-words">
                                {isSavings
                                  ? formatSavingsCutRatesSummary(cut, currency)
                                  : cut.type === 'percentage'
                                  ? `${cut.amount}%`
                                  : formatAmount(cut.amount, currency)}
                              </span>

                              <div className="flex items-center gap-1.5">
                                {isConfirmingDel ? (
                                  <div className="flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5">
                                    <span className="text-[11px] font-medium text-rose-800">
                                      Delete?
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCut(cut.id)}
                                      className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                                    >
                                      Yes
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCutId(null)}
                                      className="rounded bg-white px-2 py-0.5 text-[11px] text-slate-600"
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditCut(cut)}
                                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCutId(cut.id)}
                                      className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-100"
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-2.5 text-[11px] text-slate-500">
                Changes to quarterly savings rates apply to subsequent income records and do not alter past records.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Net Income After Deductions Routing */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsNetRoutingCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isNetRoutingCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Net Income After Deductions Routing
              </h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 shrink-0">
                {askNetIncomeTransfer ? 'Ask on Record' : 'Auto Route'}
              </span>
            </div>
            <p className="text-xs text-slate-500 break-words">
              Choose whether to ask where Net Income should be transferred after deductions and set a default destination account.
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsNetRoutingCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isNetRoutingCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isNetRoutingCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!isNetRoutingCollapsed && (
          <div className="space-y-4">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 cursor-pointer">
              <div className="space-y-0.5 min-w-0">
                <span className="block font-display text-xs font-semibold text-slate-900">
                  Ask where to transfer Net Income after deductions
                </span>
                <span className="block text-xs text-slate-500 break-words">
                  When recording income, prompt to choose which account receives the Net Income remaining after deductions.
                </span>
              </div>
              <input
                type="checkbox"
                checked={askNetIncomeTransfer}
                onChange={async (e) => {
                  const nextVal = e.target.checked;
                  setAskNetIncomeTransfer(nextVal);
                  await persistUpdates({ askNetIncomeTransfer: nextVal });
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 shrink-0"
              />
            </label>

            <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
              <label className="block text-xs font-semibold text-slate-800">
                Default Net Income Destination Account
              </label>
              <p className="text-xs text-slate-500">
                Pre-selected account for Net Income after deductions (you can still change this per income record).
              </p>
              <WrapSelect
                ariaLabel="Default Net Income Destination Account"
                value={defaultNetIncomeAccountId}
                onChange={async (nextAccId) => {
                  setDefaultNetIncomeAccountId(nextAccId);
                  await persistUpdates({ defaultNetIncomeAccountId: nextAccId });
                }}
                options={[
                  {
                    value: '',
                    label: 'Keep in Receiving Account (No extra transfer)',
                  },
                  ...operatingAccounts.map((acc) => ({
                    value: acc.id,
                    label: `${acc.name}${acc.institution ? ` (${acc.institution})` : ''}`,
                    group: 'Operating Accounts',
                  })),
                  ...effectiveSavingsPillars.map((pillar) => ({
                    value: pillar.accountId,
                    label: `${pillar.baseName} (${pillar.percentage}%)`,
                    group: 'Savings Vaults',
                  })),
                ]}
              />
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Backend File Import Section */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsImportCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isImportCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="space-y-0.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Import Records & Files
              </h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 shrink-0">
                CSV · JSON · TXT · PDF · BAK
              </span>
            </div>
            <p className="text-xs text-slate-500 break-words">
              Upload files to parse incomes, expenses, accounts, and transfers with automatic 2-point floating currency conversion and save to your database.
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsImportCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isImportCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isImportCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!isImportCollapsed && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
              <div className="space-y-1 min-w-0">
                <div className="text-xs font-semibold text-slate-800">
                  Select File to Parse & Import
                </div>
                <div className="text-[11px] text-slate-500">
                  Supports .csv, .tsv, .json, .txt, .md, .pdf, and .bak files. Foreign currencies convert automatically to {currency}.
                </div>
              </div>

              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadSampleCsv}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 text-center"
                >
                  CSV Template
                </button>
                <label className="cursor-pointer rounded-lg bg-slate-900 px-3.5 py-2 sm:py-1.5 text-xs font-semibold text-white hover:bg-slate-800 text-center">
                  <span>{isParsingImport ? 'Parsing File...' : 'Choose File'}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.json,.txt,.md,.pdf,.bak"
                    onChange={handleFileImportSelect}
                    disabled={isParsingImport || isSavingImport}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {importError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                {importError}
              </div>
            )}

            {importSuccessMsg && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                {importSuccessMsg}
              </div>
            )}

            {parsedImport && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 break-words">
                      Parsed Preview {importFileName ? `(${importFileName})` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Review extracted records before saving to your database
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setParsedImport(null);
                        setImportFileName('');
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 text-center"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSaveImport}
                      disabled={isSavingImport}
                      className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 text-center"
                    >
                      {isSavingImport
                        ? 'Saving...'
                        : 'Save All to Database'}
                    </button>
                  </div>
                </div>

                {/* Parsed Incomes */}
                {parsedImport.incomes.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Incomes ({parsedImport.incomes.length})
                    </div>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {parsedImport.incomes.map((inc, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900">
                              {inc.clientOrSource}
                            </span>{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              · {inc.date} ({inc.quarter})
                            </span>
                            {inc.notes && (
                              <span className="text-[11px] text-slate-500">
                                {' '}
                                · {inc.notes}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            {inc.currency &&
                              inc.currency !== currency &&
                              inc.originalGrossAmount !== undefined && (
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  {formatAmount(inc.originalGrossAmount, inc.currency)} →
                                </span>
                              )}
                            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                              +{formatAmount(inc.grossAmount, currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setParsedImport((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        incomes: prev.incomes.filter(
                                          (_, i) => i !== idx
                                        ),
                                      }
                                    : null
                                )
                              }
                              className="text-[11px] text-slate-400 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parsed Expenses */}
                {parsedImport.expenses.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Expenses ({parsedImport.expenses.length})
                    </div>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {parsedImport.expenses.map((exp, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900">
                              {exp.recipient || exp.description}
                            </span>{' '}
                            <span className="text-[11px] text-slate-500">
                              · {exp.category}
                              {exp.subcategory ? ` / ${exp.subcategory}` : ''} ·{' '}
                              <span className="font-mono">{exp.date}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            {exp.currency &&
                              exp.currency !== currency &&
                              exp.originalAmount !== undefined && (
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  {formatAmount(exp.originalAmount, exp.currency)} →
                                </span>
                              )}
                            <span className="font-mono font-semibold text-rose-600 tabular-nums">
                              -{formatAmount(exp.amount, currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setParsedImport((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        expenses: prev.expenses.filter(
                                          (_, i) => i !== idx
                                        ),
                                      }
                                    : null
                                )
                              }
                              className="text-[11px] text-slate-400 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parsed Accounts */}
                {parsedImport.accounts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Accounts ({parsedImport.accounts.length})
                    </div>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {parsedImport.accounts.map((acc, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900">
                              {acc.name}
                            </span>{' '}
                            <span className="text-[11px] text-slate-500">
                              · {acc.institution} ({acc.type})
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                              {formatAmount(
                                acc.originalInitialBalance ?? acc.initialBalance,
                                acc.currency || currency
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setParsedImport((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        accounts: prev.accounts.filter(
                                          (_, i) => i !== idx
                                        ),
                                      }
                                    : null
                                )
                              }
                              className="text-[11px] text-slate-400 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parsed Transfers */}
                {parsedImport.transfers.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Transfers ({parsedImport.transfers.length})
                    </div>
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {parsedImport.transfers.map((tr, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900">
                              {tr.description || 'Transfer'}
                            </span>{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              · {tr.date}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-mono font-semibold text-slate-900 tabular-nums">
                              {formatAmount(tr.amount, currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setParsedImport((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        transfers: prev.transfers.filter(
                                          (_, i) => i !== idx
                                        ),
                                      }
                                    : null
                                )
                              }
                              className="text-[11px] text-slate-400 hover:text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Version Control Release Log */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsVersionLogCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isVersionLogCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Version Control
            </h2>
            <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white shrink-0">
              v{APP_VERSION}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsVersionLogCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isVersionLogCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isVersionLogCollapsed ? '' : 'rotate-180'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!isVersionLogCollapsed && (
          <div className="divide-y divide-slate-100">
            {VERSION_RELEASE_LOG.map((entry, idx) => (
              <div key={entry.version} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900">
                      v{entry.version}
                    </span>
                    {idx === 0 && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: 'var(--app-accent-soft)',
                          color: 'var(--app-accent-text)',
                        }}
                      >
                        Current Release
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {entry.date}
                  </span>
                </div>
                <p className="text-xs text-slate-600 break-words">{entry.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
