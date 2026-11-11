import React, { useState, useEffect, useMemo } from 'react';
import {
  IncomeReceipt,
  IncomeDeductionItem,
  UserSettings,
  FinancialAccount,
  AccountTransfer,
  FlexibleExpense,
  CustomDeduction,
} from '../types/finance.ts';
import {
  formatAmount,
  getQuarterFromDate,
  computeDeductionAmount,
  buildDefaultDeductionsForIncome,
  getEffectiveIncomeDeductions,
  isSavingsDeduction,
  getSavingsCutRateForDate,
  computeSavingsBreakdown,
  getEffectiveExpenseCategoryPreferences,
  resolveDeductionExpenseMapping,
  isSavingsVaultAccount,
  calculateAccountSummaries,
  getEffectiveNetTransferAccountId,
  resolveValidAccountId,
  getNonVirtualOperatingAccounts,
  getIncomeNativeGross,
  LEGACY_SEEDED_CUT_IDS,
  DEFAULT_ACCOUNT_TYPES,
  DEFAULT_INCOME_SOURCES,
  DEFAULT_INCOME_ORIGINS,
} from '../lib/calculations.ts';
import {
  SUPPORTED_CURRENCIES,
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  convertCurrency2dp,
  getExchangeRate,
  roundTo2Decimals,
  format2PointFloat,
  getAccountCurrency,
  getAccountNativeBalance,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.tsx';
import { WrapSelect } from './WrapSelect.tsx';
import {
  learnDeductionSuggestions,
  suggestionToIncomeDeductionItem,
} from '../lib/deductionIntelligence.ts';

interface IncomeLogViewProps {
  incomes: IncomeReceipt[];
  expenses?: FlexibleExpense[];
  transfers?: AccountTransfer[];
  settings: UserSettings;
  accounts: FinancialAccount[];
  currency: string;
  onAddIncome: (
    receipt: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ) => Promise<void>;
  onUpdateIncome: (receipt: IncomeReceipt) => Promise<void>;
  onDeleteIncome: (id: string) => Promise<void>;
  onAddAccount?: (
    account: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onSaveSettings?: (settings: UserSettings) => Promise<void>;
  onNavigateToSettings?: () => void;
  onOpenDeductionAgent?: () => void;
  expandFormTrigger?: number;
}

const generateReceiptCode = () => {
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `INC-${datePart}-${randomDigits}`;
};

export const IncomeLogView: React.FC<IncomeLogViewProps> = ({
  incomes,
  expenses = [],
  transfers = [],
  settings,
  accounts,
  currency,
  onAddIncome,
  onUpdateIncome,
  onDeleteIncome,
  onAddAccount,
  onSaveSettings,
  onNavigateToSettings,
  onOpenDeductionAgent,
  expandFormTrigger,
}) => {
  const { summaries } = useMemo(
    () => calculateAccountSummaries(accounts, incomes, expenses, settings, transfers),
    [accounts, incomes, expenses, settings, transfers]
  );

  const accountBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of summaries) {
      map.set(s.account.id, s.currentCashBalance);
    }
    return map;
  }, [summaries]);
  const operatingAccounts = useMemo(
    () => accounts.filter((a) => !isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );
  const nonVirtualMainAccounts = useMemo(
    () => getNonVirtualOperatingAccounts(accounts, settings),
    [accounts, settings]
  );
  const savingsPillarAccounts = useMemo(
    () => accounts.filter((a) => isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const defaultAccount = useMemo(
    () =>
      operatingAccounts.find((a) => a.isDefaultDeposit) ||
      operatingAccounts.find((a) => a.id === settings.defaultAccountId) ||
      operatingAccounts[0] ||
      accounts[0],
    [operatingAccounts, accounts, settings.defaultAccountId]
  );

  // Strictly user-defined deductions from Settings
  const definedCuts = useMemo(
    () =>
      (settings.customCuts || []).filter(
        (cut) => !LEGACY_SEEDED_CUT_IDS.has(cut.id)
      ),
    [settings.customCuts]
  );

  const accountTypeOptions = useMemo(() => {
    const base =
      Array.isArray(settings.accountTypes) && settings.accountTypes.length > 0
        ? settings.accountTypes
        : DEFAULT_ACCOUNT_TYPES;
    const set = new Set<string>(base.filter((t) => t && t.trim()));
    for (const acc of accounts) {
      if (acc.type && acc.type.trim()) set.add(acc.type.trim());
    }
    return Array.from(set);
  }, [settings.accountTypes, accounts]);

  // Authoritative Income Source Options
  const [incomeSourceOptions, setIncomeSourceOptions] = useState<string[]>(() =>
    Array.isArray(settings.incomeSources)
      ? settings.incomeSources
      : DEFAULT_INCOME_SOURCES
  );
  const [isManagingSources, setIsManagingSources] = useState(false);
  const [editingSourceOriginal, setEditingSourceOriginal] = useState<string | null>(null);
  const [editingSourceValue, setEditingSourceValue] = useState('');
  const [isAddingNewSource, setIsAddingNewSource] = useState(false);
  const [newSourceDraft, setNewSourceDraft] = useState('');

  useEffect(() => {
    if (Array.isArray(settings.incomeSources)) {
      setIncomeSourceOptions(settings.incomeSources);
    }
  }, [settings.incomeSources]);

  // Authoritative Source (Where Income Comes From) Options
  const [incomeOriginOptions, setIncomeOriginOptions] = useState<string[]>(() =>
    Array.isArray(settings.incomeOrigins)
      ? settings.incomeOrigins
      : DEFAULT_INCOME_ORIGINS
  );
  const [isManagingOrigins, setIsManagingOrigins] = useState(false);
  const [editingOriginOriginal, setEditingOriginOriginal] = useState<string | null>(null);
  const [editingOriginValue, setEditingOriginValue] = useState('');
  const [isAddingNewOrigin, setIsAddingNewOrigin] = useState(false);
  const [newOriginDraft, setNewOriginDraft] = useState('');

  useEffect(() => {
    if (Array.isArray(settings.incomeOrigins)) {
      setIncomeOriginOptions(settings.incomeOrigins);
    }
  }, [settings.incomeOrigins]);

  // New Income Form State
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clientOrSource, setClientOrSource] = useState(
    () =>
      (Array.isArray(settings.incomeSources) && settings.incomeSources[0]) ||
      DEFAULT_INCOME_SOURCES[0] ||
      'Monthly Salary'
  );
  const [notes, setNotes] = useState(
    () =>
      (Array.isArray(settings.incomeOrigins) && settings.incomeOrigins[0]) ||
      DEFAULT_INCOME_ORIGINS[0] ||
      'Primary Employer'
  );
  const [category, setCategory] = useState('Consulting');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    defaultAccount?.id || ''
  );
  const [incomeCurrency, setIncomeCurrency] = useState<string>(() =>
    getAccountCurrency(defaultAccount, currency || 'GHS')
  );
  const [grossAmount, setGrossAmount] = useState<string>('');

  // Real-time Market Exchange Rates state
  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const persistIncomeSourceOption = (rawSource: string) => {
    const trimmed = rawSource.trim();
    if (!trimmed) return '';
    if (!incomeSourceOptions.includes(trimmed)) {
      const nextSources = [...incomeSourceOptions, trimmed];
      setIncomeSourceOptions(nextSources);
      if (onSaveSettings) {
        onSaveSettings({
          ...settings,
          incomeSources: nextSources,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return trimmed;
  };

  const handleRenameSavedSourceOption = (oldName: string, newNameRaw: string) => {
    const trimmed = newNameRaw.trim();
    setEditingSourceOriginal(null);
    if (!trimmed || trimmed === oldName) return;

    const nextSources = Array.from(
      new Set(incomeSourceOptions.map((s) => (s === oldName ? trimmed : s)))
    );
    setIncomeSourceOptions(nextSources);

    if (clientOrSource.trim() === oldName) {
      setClientOrSource(trimmed);
    }
    if (editSource.trim() === oldName) {
      setEditSource(trimmed);
    }

    for (const inc of incomes) {
      if (inc.clientOrSource === oldName) {
        onUpdateIncome({
          ...inc,
          clientOrSource: trimmed,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        incomeSources: nextSources,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleDeleteSavedSourceOption = (targetSource: string) => {
    const nextSources = incomeSourceOptions.filter((s) => s !== targetSource);
    setIncomeSourceOptions(nextSources);
    if (editingSourceOriginal === targetSource) {
      setEditingSourceOriginal(null);
    }
    if (clientOrSource.trim() === targetSource) {
      setClientOrSource(nextSources[0] || '');
    }
    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        incomeSources: nextSources,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const persistIncomeOriginOption = (rawOrigin: string) => {
    const trimmed = rawOrigin.trim();
    if (!trimmed) return '';
    if (!incomeOriginOptions.includes(trimmed)) {
      const nextOrigins = [...incomeOriginOptions, trimmed];
      setIncomeOriginOptions(nextOrigins);
      if (onSaveSettings) {
        onSaveSettings({
          ...settings,
          incomeOrigins: nextOrigins,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return trimmed;
  };

  const handleRenameSavedOriginOption = (oldName: string, newNameRaw: string) => {
    const trimmed = newNameRaw.trim();
    setEditingOriginOriginal(null);
    if (!trimmed || trimmed === oldName) return;

    const nextOrigins = Array.from(
      new Set(incomeOriginOptions.map((o) => (o === oldName ? trimmed : o)))
    );
    setIncomeOriginOptions(nextOrigins);

    if (notes.trim() === oldName) {
      setNotes(trimmed);
    }
    if (editNotes.trim() === oldName) {
      setEditNotes(trimmed);
    }

    for (const inc of incomes) {
      if ((inc.notes || '') === oldName) {
        onUpdateIncome({
          ...inc,
          notes: trimmed,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        incomeOrigins: nextOrigins,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleDeleteSavedOriginOption = (targetOrigin: string) => {
    const nextOrigins = incomeOriginOptions.filter((o) => o !== targetOrigin);
    setIncomeOriginOptions(nextOrigins);
    if (editingOriginOriginal === targetOrigin) {
      setEditingOriginOriginal(null);
    }
    if (notes.trim() === targetOrigin) {
      setNotes(nextOrigins[0] || '');
    }
    if (onSaveSettings) {
      onSaveSettings({
        ...settings,
        incomeOrigins: nextOrigins,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  // Delete Confirmation Modal State
  const [confirmDeleteConfig, setConfirmDeleteConfig] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  // Per-income allocated deductions strictly from user-defined deductions in Settings
  const [draftDeductions, setDraftDeductions] = useState<IncomeDeductionItem[]>(() =>
    buildDefaultDeductionsForIncome(0, settings, expenses, date)
  );
  const [draftNetTransferAccountId, setDraftNetTransferAccountId] = useState<string>(
    settings.defaultNetIncomeAccountId || ''
  );
  const [isNetTransferPromptOpen, setIsNetTransferPromptOpen] = useState(false);

  useEffect(() => {
    setDraftNetTransferAccountId(settings.defaultNetIncomeAccountId || '');
  }, [settings.defaultNetIncomeAccountId]);

  // Sync draftDeductions whenever user-defined cuts change, preserving any user-customized rates on the current draft
  useEffect(() => {
    setDraftDeductions((prev) => {
      const defaults = buildDefaultDeductionsForIncome(
        Math.max(0, parseFloat(grossAmount) || 0),
        settings,
        expenses,
        date
      );
      return defaults.map((defItem) => {
        const existing = prev.find((p) => p.id === defItem.id);
        if (existing && existing.isCustomRateOverride) {
          return {
            ...defItem,
            type: existing.type,
            value: existing.value,
            amount: computeDeductionAmount(
              Math.max(0, parseFloat(grossAmount) || 0),
              existing.type,
              existing.value
            ),
            isCustomRateOverride: true,
          };
        }
        return defItem;
      });
    });
  }, [settings.customCuts, settings.expenseCategoryPreferences, expenses]);

  // When the selected date changes on the Record Income form, automatically update savings deduction rates for that date's quarter unless customized by the user
  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    setDraftDeductions((prev) =>
      prev.map((d) => {
        if (!isSavingsDeduction(d)) return d;
        // If user explicitly customized the savings rate on this draft, preserve their rate
        if (d.isCustomRateOverride) return d;
        const matchedCut = definedCuts.find(
          (c) =>
            d.id === `ded_${c.id}` ||
            c.name.trim().toLowerCase() === d.name.trim().toLowerCase()
        );
        if (!matchedCut) return d;
        const nextVal = getSavingsCutRateForDate(matchedCut, nextDate).rate;
        return {
          ...d,
          value: nextVal,
          amount: computeDeductionAmount(
            Math.max(0, parseFloat(grossAmount) || 0),
            d.type,
            nextVal
          ),
        };
      })
    );
  };

  // Inline Quick Account Creation inside Income Form
  const [isQuickAccountOpen, setIsQuickAccountOpen] = useState(false);
  const [quickAccName, setQuickAccName] = useState('');
  const [quickAccInstitution, setQuickAccInstitution] = useState('');
  const [quickAccType, setQuickAccType] = useState('Operating Account');
  const [isAddingQuickType, setIsAddingQuickType] = useState(false);
  const [newQuickTypeInput, setNewQuickTypeInput] = useState('');
  const [quickAccCurrency, setQuickAccCurrency] = useState<string>(currency || 'GHS');
  const [quickAccInitialBalance, setQuickAccInitialBalance] = useState('0');
  const [quickAccIsVirtual, setQuickAccIsVirtual] = useState(false);
  const [quickAccMainId, setQuickAccMainId] = useState('');
  const [isCreatingQuickAcc, setIsCreatingQuickAcc] = useState(false);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Editing states for recorded incomes
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState('');
  const [isAddingEditSource, setIsAddingEditSource] = useState(false);
  const [newEditSourceDraft, setNewEditSourceDraft] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isAddingEditOrigin, setIsAddingEditOrigin] = useState(false);
  const [newEditOriginDraft, setNewEditOriginDraft] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCurrency, setEditCurrency] = useState<string>(currency || 'GHS');
  const [editGross, setEditGross] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editNetTransferAccountId, setEditNetTransferAccountId] = useState('');
  const [editCategory, setEditCategory] = useState('');

  // Inline "Add Defined Deduction to Specific Income Record" state
  const [addingDeductionForIncomeId, setAddingDeductionForIncomeId] = useState<string | null>(null);
  const [selectedDefinedCutId, setSelectedDefinedCutId] = useState<string>('');

  // All expandable forms and recorded income cards start collapsed by default
  const [isRecordFormCollapsed, setIsRecordFormCollapsed] = useState(true);
  const [expandedIncomeIds, setExpandedIncomeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (expandFormTrigger && expandFormTrigger > 0) {
      setIsRecordFormCollapsed(false);
    }
  }, [expandFormTrigger]);

  const toggleIncomeExpand = (id: string) => {
    setExpandedIncomeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveSelectedAccountId =
    selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : defaultAccount?.id || '';

  const selectedAccountObj = useMemo(
    () =>
      summaries.find((s) => s.account.id === effectiveSelectedAccountId)?.account ||
      accounts.find((a) => a.id === effectiveSelectedAccountId),
    [summaries, accounts, effectiveSelectedAccountId]
  );

  const selectedAccountCurrency = useMemo(
    () => getAccountCurrency(selectedAccountObj, currency || 'GHS'),
    [selectedAccountObj, currency]
  );

  // Sync income currency to the selected account's currency whenever the receiving account changes
  useEffect(() => {
    setIncomeCurrency(selectedAccountCurrency);
  }, [effectiveSelectedAccountId, selectedAccountCurrency]);

  const activeIncomeCurrency = (
    incomeCurrency ||
    selectedAccountCurrency ||
    currency ||
    'GHS'
  ).toUpperCase();

  const rawDraftInputGross = roundTo2Decimals(Math.max(0, parseFloat(grossAmount) || 0));
  const draftConversion = useMemo(() => {
    return convertCurrency2dp(
      rawDraftInputGross,
      activeIncomeCurrency,
      currency,
      fxSnapshot
    );
  }, [rawDraftInputGross, activeIncomeCurrency, currency, fxSnapshot]);

  // Save & compute the income in the account's native currency without conversion
  const numericDraftGross = rawDraftInputGross;
  const selectedDraftQuarter = useMemo(() => getQuarterFromDate(date), [date]);

  const effectiveExpensePrefs = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings, expenses),
    [settings, expenses]
  );

  const computedDraftDeductions = useMemo(() => {
    return draftDeductions.map((d) => {
      const isSav = isSavingsDeduction(d);
      const amt = computeDeductionAmount(numericDraftGross, d.type, d.value);
      const mapped = !isSav
        ? resolveDeductionExpenseMapping(d, settings, expenses)
        : undefined;
      return {
        ...d,
        amount: amt,
        isSavingsSplit: isSav,
        destinationAccountId: undefined,
        expenseCategory: mapped?.category,
        expenseSubcategory: mapped?.subcategory,
      };
    });
  }, [draftDeductions, numericDraftGross, settings, expenses]);

  const draftSavingsTotal = useMemo(
    () =>
      Math.round(
        computedDraftDeductions
          .filter((d) => d.isSavingsSplit)
          .reduce((sum, d) => sum + d.amount, 0) * 100
      ) / 100,
    [computedDraftDeductions]
  );

  const draftExpenseDeductionsTotal = useMemo(
    () =>
      Math.round(
        computedDraftDeductions
          .filter((d) => !d.isSavingsSplit)
          .reduce((sum, d) => sum + d.amount, 0) * 100
      ) / 100,
    [computedDraftDeductions]
  );

  const draftTotalDeductions = useMemo(
    () =>
      Math.round((draftSavingsTotal + draftExpenseDeductionsTotal) * 100) / 100,
    [draftSavingsTotal, draftExpenseDeductionsTotal]
  );

  const draftNetRetained =
    Math.round((numericDraftGross - draftTotalDeductions) * 100) / 100;

  const handleToggleDefinedRuleInDraft = (cut: CustomDeduction) => {
    const existing = draftDeductions.find(
      (d) => d.id === `ded_${cut.id}` || d.name.toLowerCase() === cut.name.toLowerCase()
    );
    if (existing) {
      setDraftDeductions((prev) => prev.filter((item) => item.id !== existing.id));
    } else {
      const isSav = isSavingsDeduction(cut);
      const effectiveVal = isSav
        ? getSavingsCutRateForDate(cut, date).rate
        : cut.amount;
      const mapped = !isSav
        ? resolveDeductionExpenseMapping(cut, settings, expenses)
        : undefined;
      const newItem: IncomeDeductionItem = {
        id: `ded_${cut.id}`,
        name: cut.name,
        description: cut.description || '',
        type: cut.type,
        value: effectiveVal,
        amount: computeDeductionAmount(numericDraftGross, cut.type, effectiveVal),
        destinationAccountId: undefined,
        isSavingsSplit: isSav,
        expenseCategory: mapped?.category,
        expenseSubcategory: mapped?.subcategory,
      };
      setDraftDeductions((prev) => [...prev, newItem]);
    }
  };

  const handleUpdateDraftDeduction = (
    id: string,
    patch: Partial<IncomeDeductionItem>
  ) => {
    setDraftDeductions((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, ...patch };
      })
    );
  };

  const handleRemoveDraftDeduction = (id: string) => {
    setDraftDeductions((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCreateQuickAccount = async () => {
    if (!quickAccName.trim() || !onAddAccount) return;
    setIsCreatingQuickAcc(true);
    try {
      const resolvedType =
        isAddingQuickType && newQuickTypeInput.trim()
          ? newQuickTypeInput.trim()
          : quickAccType.trim() || 'Operating Account';

      if (!accountTypeOptions.includes(resolvedType) && onSaveSettings) {
        onSaveSettings({
          ...settings,
          accountTypes: [...accountTypeOptions, resolvedType],
          updatedAt: new Date().toISOString(),
        });
      }

      const attachedMainId = quickAccIsVirtual
        ? quickAccMainId || nonVirtualMainAccounts[0]?.id || undefined
        : undefined;

      const selectedQuickCurr = (quickAccCurrency || currency).toUpperCase();
      const rawQuickBal = roundTo2Decimals(parseFloat(quickAccInitialBalance) || 0);
      const { exchangeRate2dp: quickRate2dp } =
        convertCurrency2dp(rawQuickBal, selectedQuickCurr, currency, fxSnapshot);

      await onAddAccount({
        name: quickAccName.trim(),
        institution: quickAccInstitution.trim() || 'Bank / Wallet',
        type: resolvedType,
        currency: selectedQuickCurr,
        originalInitialBalance: rawQuickBal,
        exchangeRate: quickRate2dp,
        initialBalance: rawQuickBal,
        isDefaultDeposit: !quickAccIsVirtual && operatingAccounts.length === 0,
        isVirtual: quickAccIsVirtual,
        custodianAccountId: attachedMainId,
        color: '#0f172a',
        description: '',
      });
      setQuickAccName('');
      setQuickAccInstitution('');
      setQuickAccType(resolvedType);
      setIsAddingQuickType(false);
      setNewQuickTypeInput('');
      setQuickAccCurrency(currency);
      setQuickAccInitialBalance('0');
      setQuickAccIsVirtual(false);
      setQuickAccMainId('');
      setIsQuickAccountOpen(false);
    } finally {
      setIsCreatingQuickAcc(false);
    }
  };

  const executeSaveIncomeRecord = async (chosenNetTargetAccId: string) => {
    if (!clientOrSource.trim() || rawDraftInputGross <= 0) return;

    setIsSubmitting(true);
    try {
      const validDeductions = computedDraftDeductions
        .filter((d) => d.name.trim() !== '' && d.value > 0)
        .map((d) => {
          const isSav = isSavingsDeduction(d);
          return {
            ...d,
            name: d.name.trim(),
            value: Number(d.value) || 0,
            amount: computeDeductionAmount(
              rawDraftInputGross,
              d.type,
              Number(d.value) || 0
            ),
            isSavingsSplit: isSav,
            destinationAccountId: undefined,
          };
        });

      const totalDedRate =
        rawDraftInputGross > 0
          ? Math.min(
              100,
              Math.round(
                ((draftTotalDeductions / rawDraftInputGross) * 100) * 10
              ) / 10
            )
          : 0;

      persistIncomeSourceOption(clientOrSource);
      if (notes.trim()) {
        persistIncomeOriginOption(notes);
      }

      let cleanNetTargetId: string | undefined;
      if (chosenNetTargetAccId === '__KEEP__') {
        cleanNetTargetId = '__KEEP__';
      } else if (
        chosenNetTargetAccId &&
        chosenNetTargetAccId !== effectiveSelectedAccountId
      ) {
        cleanNetTargetId = chosenNetTargetAccId;
      } else if (
        !chosenNetTargetAccId &&
        settings.defaultNetIncomeAccountId &&
        settings.defaultNetIncomeAccountId !== effectiveSelectedAccountId
      ) {
        cleanNetTargetId = '__KEEP__';
      }

      // Save the income directly in the account's currency without conversion
      await onAddIncome({
        date,
        quarter: getQuarterFromDate(date),
        clientOrSource: clientOrSource.trim(),
        category: category.trim() || 'General',
        accountId: effectiveSelectedAccountId,
        netTransferredToAccountId: cleanNetTargetId,
        currency: activeIncomeCurrency,
        originalGrossAmount: rawDraftInputGross,
        exchangeRate: draftConversion.exchangeRate2dp,
        grossAmount: rawDraftInputGross,
        savingsRate: totalDedRate,
        receiptId: generateReceiptCode(),
        notes: notes.trim(),
        allocatedDeductions: validDeductions,
      });

      setGrossAmount('');
      setIncomeCurrency(selectedAccountCurrency);
      setIsAddingNewSource(false);
      setNewSourceDraft('');
      setIsAddingNewOrigin(false);
      setNewOriginDraft('');
      setIsNetTransferPromptOpen(false);
      setDraftNetTransferAccountId(settings.defaultNetIncomeAccountId || '');
      setDraftDeductions(buildDefaultDeductionsForIncome(0, settings, expenses, date));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientOrSource.trim() || rawDraftInputGross <= 0) return;

    if (settings.askNetIncomeTransfer !== false && draftNetRetained > 0) {
      setIsNetTransferPromptOpen(true);
      return;
    }

    await executeSaveIncomeRecord(draftNetTransferAccountId);
  };

  const handleStartEditIncome = (inc: IncomeReceipt) => {
    setEditingIncomeId(inc.id);
    setEditSource(inc.clientOrSource);
    setIsAddingEditSource(false);
    setNewEditSourceDraft('');
    setEditNotes(inc.notes || '');
    setIsAddingEditOrigin(false);
    setNewEditOriginDraft('');
    setEditDate(inc.date);
    const resolvedAccId = resolveValidAccountId(inc.accountId, accounts, settings);
    setEditAccountId(resolvedAccId);
    const { nativeGross, currency: incNativeCurr } = getIncomeNativeGross(
      inc,
      settings,
      accounts
    );
    setEditCurrency(incNativeCurr);
    setEditGross(String(roundTo2Decimals(nativeGross)));
    const effectiveNetDest = getEffectiveNetTransferAccountId(inc, settings, accounts);
    setEditNetTransferAccountId(effectiveNetDest);
    setEditCategory(inc.category || 'General');
  };

  const handleSaveEditIncome = async (inc: IncomeReceipt) => {
    const rawEditInputGross = roundTo2Decimals(Math.max(0, parseFloat(editGross) || 0));
    const targetEditAcc = accounts.find((a) => a.id === editAccountId);
    const selectedEditCurr = (
      editCurrency || getAccountCurrency(targetEditAcc, currency)
    ).toUpperCase();
    const { exchangeRate2dp } = convertCurrency2dp(
      rawEditInputGross,
      selectedEditCurr,
      currency,
      fxSnapshot
    );

    const resolvedSource =
      isAddingEditSource && newEditSourceDraft.trim()
        ? newEditSourceDraft.trim()
        : editSource.trim();
    const resolvedOrigin =
      isAddingEditOrigin && newEditOriginDraft.trim()
        ? newEditOriginDraft.trim()
        : editNotes.trim();

    if (!resolvedSource || rawEditInputGross <= 0) return;

    persistIncomeSourceOption(resolvedSource);
    if (resolvedOrigin) {
      persistIncomeOriginOption(resolvedOrigin);
    }

    const updatedReceiptPreview: IncomeReceipt = {
      ...inc,
      date: editDate,
      quarter: getQuarterFromDate(editDate),
      currency: selectedEditCurr,
      originalGrossAmount: rawEditInputGross,
      grossAmount: rawEditInputGross,
    };

    // Preserve the exact deduction rates recorded on this income record in its native currency
    const currentDeductions = getEffectiveIncomeDeductions(
      updatedReceiptPreview,
      settings,
      expenses
    ).map((d) => ({
      ...d,
      value: Number(d.value) || 0,
      amount: computeDeductionAmount(
        rawEditInputGross,
        d.type,
        Number(d.value) || 0
      ),
    }));

    let cleanNetTargetId: string | undefined;
    if (editNetTransferAccountId === '__KEEP__') {
      cleanNetTargetId = '__KEEP__';
    } else if (
      editNetTransferAccountId &&
      editNetTransferAccountId !== editAccountId
    ) {
      cleanNetTargetId = editNetTransferAccountId;
    } else if (
      !editNetTransferAccountId &&
      settings.defaultNetIncomeAccountId &&
      settings.defaultNetIncomeAccountId !== editAccountId
    ) {
      cleanNetTargetId = '__KEEP__';
    }

    await onUpdateIncome({
      ...inc,
      clientOrSource: resolvedSource,
      notes: resolvedOrigin,
      date: editDate,
      quarter: getQuarterFromDate(editDate),
      currency: selectedEditCurr,
      originalGrossAmount: rawEditInputGross,
      exchangeRate: exchangeRate2dp,
      grossAmount: rawEditInputGross,
      accountId: editAccountId,
      netTransferredToAccountId: cleanNetTargetId,
      category: editCategory.trim() || 'General',
      allocatedDeductions: currentDeductions,
      updatedAt: new Date().toISOString(),
    });
    setEditingIncomeId(null);
    setIsAddingEditSource(false);
    setIsAddingEditOrigin(false);
  };

  const handleUpdateExistingIncomeNetTransfer = async (
    inc: IncomeReceipt,
    nextNetDestAccId: string
  ) => {
    const resolvedSourceAccId = resolveValidAccountId(
      inc.accountId,
      accounts,
      settings
    );
    let cleanNetTargetId: string | undefined;
    if (!nextNetDestAccId || nextNetDestAccId === resolvedSourceAccId) {
      cleanNetTargetId =
        settings.defaultNetIncomeAccountId &&
        settings.defaultNetIncomeAccountId !== resolvedSourceAccId
          ? '__KEEP__'
          : undefined;
    } else {
      cleanNetTargetId = nextNetDestAccId;
    }

    await onUpdateIncome({
      ...inc,
      accountId: resolvedSourceAccId,
      netTransferredToAccountId: cleanNetTargetId,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddDefinedDeductionToExistingIncome = async (inc: IncomeReceipt) => {
    const cut = definedCuts.find((c) => c.id === selectedDefinedCutId);
    if (!cut) return;

    const existingDeductions = getEffectiveIncomeDeductions(inc, settings, expenses);
    if (
      existingDeductions.some(
        (d) =>
          d.id.includes(cut.id) ||
          d.name.trim().toLowerCase() === cut.name.trim().toLowerCase()
      )
    ) {
      setAddingDeductionForIncomeId(null);
      return;
    }

    const { nativeGross } = getIncomeNativeGross(inc, settings, accounts);
    const isSav = isSavingsDeduction(cut);
    const effectiveVal = isSav
      ? getSavingsCutRateForDate(cut, inc.date).rate
      : cut.amount;
    const mapped = !isSav
      ? resolveDeductionExpenseMapping(cut, settings, expenses)
      : undefined;
    const newItem: IncomeDeductionItem = {
      id: `${inc.id}_cut_${cut.id}`,
      name: cut.name,
      description: cut.description,
      type: cut.type,
      value: effectiveVal,
      amount: computeDeductionAmount(nativeGross, cut.type, effectiveVal),
      destinationAccountId: undefined,
      isSavingsSplit: isSav,
      expenseCategory: mapped?.category,
      expenseSubcategory: mapped?.subcategory,
    };

    const nextDeductions = [...existingDeductions, newItem];
    await onUpdateIncome({
      ...inc,
      allocatedDeductions: nextDeductions,
      updatedAt: new Date().toISOString(),
    });

    setSelectedDefinedCutId('');
    setAddingDeductionForIncomeId(null);
  };

  const handleUpdateExistingIncomeDeductionCategory = async (
    inc: IncomeReceipt,
    deductionId: string,
    nextCategory: string,
    nextSubcategory: string
  ) => {
    const existingDeductions = getEffectiveIncomeDeductions(inc, settings, expenses);
    const nextDeductions = existingDeductions.map((d) =>
      d.id === deductionId
        ? {
            ...d,
            expenseCategory: nextCategory,
            expenseSubcategory: nextSubcategory,
          }
        : d
    );
    await onUpdateIncome({
      ...inc,
      allocatedDeductions: nextDeductions,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateExistingIncomeDeductionRate = async (
    inc: IncomeReceipt,
    deductionId: string,
    nextValRaw: number
  ) => {
    const cleanVal = Math.max(0, Number(nextValRaw) || 0);
    const { nativeGross } = getIncomeNativeGross(inc, settings, accounts);
    const existingDeductions = getEffectiveIncomeDeductions(inc, settings, expenses);
    const nextDeductions = existingDeductions.map((d) =>
      d.id === deductionId
        ? {
            ...d,
            value: cleanVal,
            amount: computeDeductionAmount(nativeGross, d.type, cleanVal),
            isCustomRateOverride: true,
          }
        : d
    );
    await onUpdateIncome({
      ...inc,
      allocatedDeductions: nextDeductions,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRemoveDeductionFromExistingIncome = async (
    inc: IncomeReceipt,
    deductionId: string
  ) => {
    const existingDeductions = getEffectiveIncomeDeductions(inc, settings, expenses);
    const nextDeductions = existingDeductions.filter((d) => d.id !== deductionId);
    await onUpdateIncome({
      ...inc,
      allocatedDeductions: nextDeductions,
      updatedAt: new Date().toISOString(),
    });
  };

  const filteredIncomes = useMemo(() => {
    return incomes.filter((inc) => {
      if (accountFilter !== 'all') {
        const incAccId = inc.accountId || defaultAccount?.id || '';
        if (incAccId !== accountFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSource = inc.clientOrSource.toLowerCase().includes(q);
        const matchNotes = (inc.notes || '').toLowerCase().includes(q);
        const matchCat = (inc.category || '').toLowerCase().includes(q);
        return matchSource || matchNotes || matchCat;
      }
      return true;
    });
  }, [incomes, accountFilter, searchQuery, defaultAccount]);

  const anyFilteredExpanded =
    filteredIncomes.length > 0 &&
    filteredIncomes.some((inc) => expandedIncomeIds.has(inc.id));

  const handleToggleExpandAllIncomes = () => {
    if (anyFilteredExpanded) {
      setExpandedIncomeIds(new Set());
    } else {
      setExpandedIncomeIds(new Set(filteredIncomes.map((inc) => inc.id)));
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Income & Deductions
        </h1>

        <button
          type="button"
          onClick={() => setIsRecordFormCollapsed((prev) => !prev)}
          className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors shrink-0"
        >
          {isRecordFormCollapsed ? '+ Record Income' : 'Collapse Form'}
        </button>
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Collapsible Record Income Form (Collapsed by default) */}
        <div
          className={`${
            isRecordFormCollapsed ? 'lg:col-span-12' : 'lg:col-span-5'
          } rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 min-w-0`}
        >
          <div
            onClick={() => setIsRecordFormCollapsed((prev) => !prev)}
            className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
              isRecordFormCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
            }`}
          >
            <h2 className="font-display text-base font-semibold text-slate-900">
              Record Income
            </h2>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsRecordFormCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isRecordFormCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isRecordFormCollapsed ? '' : 'rotate-180'
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

          {!isRecordFormCollapsed && (
            <form onSubmit={handleRecordIncome} className="space-y-4">
              {/* 1. Income Source (Dropdown + On-Demand Add New Input + Edit Button to Modify Existing Options) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Income Source
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsManagingSources((prev) => !prev)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {isManagingSources ? 'Done' : 'Edit'}
                  </button>
                </div>

                <WrapSelect
                  ariaLabel="Income Source"
                  value={isAddingNewSource ? '__CUSTOM__' : clientOrSource.trim()}
                  options={[
                    ...incomeSourceOptions.map((src) => ({
                      value: src,
                      label: src,
                    })),
                    ...(clientOrSource.trim() &&
                    !incomeSourceOptions.includes(clientOrSource.trim()) &&
                    !isAddingNewSource
                      ? [
                          {
                            value: clientOrSource.trim(),
                            label: clientOrSource.trim(),
                          },
                        ]
                      : []),
                    {
                      value: '__CUSTOM__',
                      label: '+ Add New Income Source...',
                    },
                  ]}
                  onChange={(val) => {
                    if (val === '__CUSTOM__') {
                      setIsAddingNewSource(true);
                      setNewSourceDraft('');
                    } else {
                      setIsAddingNewSource(false);
                      setNewSourceDraft('');
                      setClientOrSource(val);
                    }
                  }}
                />

                {isAddingNewSource && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <input
                      type="text"
                      autoFocus
                      value={newSourceDraft}
                      onChange={(e) => {
                        setNewSourceDraft(e.target.value);
                        setClientOrSource(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSourceDraft.trim()) {
                          e.preventDefault();
                          const saved = persistIncomeSourceOption(newSourceDraft);
                          if (saved) {
                            setClientOrSource(saved);
                            setIsAddingNewSource(false);
                            setNewSourceDraft('');
                          }
                        } else if (e.key === 'Escape') {
                          setIsAddingNewSource(false);
                          setNewSourceDraft('');
                          setClientOrSource(incomeSourceOptions[0] || '');
                        }
                      }}
                      placeholder="Enter new income source..."
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!newSourceDraft.trim()}
                      onClick={() => {
                        const saved = persistIncomeSourceOption(newSourceDraft);
                        if (saved) {
                          setClientOrSource(saved);
                          setIsAddingNewSource(false);
                          setNewSourceDraft('');
                        }
                      }}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNewSource(false);
                        setNewSourceDraft('');
                        setClientOrSource(incomeSourceOptions[0] || '');
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Edit Existing Income Source Options */}
                {isManagingSources && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Modify Income Source Options ({incomeSourceOptions.length})
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-200/60 rounded border border-slate-200/80 bg-white">
                      {incomeSourceOptions.length === 0 ? (
                        <div className="p-2.5 text-center text-xs text-slate-400">
                          No saved options
                        </div>
                      ) : (
                        incomeSourceOptions.map((opt) => {
                          const isEditingOpt = editingSourceOriginal === opt;
                          return (
                            <div
                              key={opt}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                            >
                              {isEditingOpt ? (
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingSourceValue}
                                    onChange={(e) => setEditingSourceValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleRenameSavedSourceOption(opt, editingSourceValue);
                                      } else if (e.key === 'Escape') {
                                        setEditingSourceOriginal(null);
                                      }
                                    }}
                                    className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRenameSavedSourceOption(opt, editingSourceValue)
                                    }
                                    className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shrink-0"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingSourceOriginal(null)}
                                    className="px-1.5 py-1 text-[11px] text-slate-500 hover:text-slate-900 shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-800 break-words min-w-0">{opt}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSourceOriginal(opt);
                                        setEditingSourceValue(opt);
                                      }}
                                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSavedSourceOption(opt)}
                                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Source (Where income comes from — Dropdown + On-Demand Add New Input + Edit Button) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Source
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsManagingOrigins((prev) => !prev)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {isManagingOrigins ? 'Done' : 'Edit'}
                  </button>
                </div>

                <WrapSelect
                  ariaLabel="Source"
                  value={isAddingNewOrigin ? '__CUSTOM_ORIGIN__' : notes.trim()}
                  options={[
                    ...incomeOriginOptions.map((orig) => ({
                      value: orig,
                      label: orig,
                    })),
                    ...(notes.trim() &&
                    !incomeOriginOptions.includes(notes.trim()) &&
                    !isAddingNewOrigin
                      ? [
                          {
                            value: notes.trim(),
                            label: notes.trim(),
                          },
                        ]
                      : []),
                    {
                      value: '__CUSTOM_ORIGIN__',
                      label: '+ Add New Source...',
                    },
                  ]}
                  onChange={(val) => {
                    if (val === '__CUSTOM_ORIGIN__') {
                      setIsAddingNewOrigin(true);
                      setNewOriginDraft('');
                    } else {
                      setIsAddingNewOrigin(false);
                      setNewOriginDraft('');
                      setNotes(val);
                    }
                  }}
                />

                {isAddingNewOrigin && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <input
                      type="text"
                      autoFocus
                      value={newOriginDraft}
                      onChange={(e) => {
                        setNewOriginDraft(e.target.value);
                        setNotes(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newOriginDraft.trim()) {
                          e.preventDefault();
                          const saved = persistIncomeOriginOption(newOriginDraft);
                          if (saved) {
                            setNotes(saved);
                            setIsAddingNewOrigin(false);
                            setNewOriginDraft('');
                          }
                        } else if (e.key === 'Escape') {
                          setIsAddingNewOrigin(false);
                          setNewOriginDraft('');
                          setNotes(incomeOriginOptions[0] || '');
                        }
                      }}
                      placeholder="Enter new source..."
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!newOriginDraft.trim()}
                      onClick={() => {
                        const saved = persistIncomeOriginOption(newOriginDraft);
                        if (saved) {
                          setNotes(saved);
                          setIsAddingNewOrigin(false);
                          setNewOriginDraft('');
                        }
                      }}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingNewOrigin(false);
                        setNewOriginDraft('');
                        setNotes(incomeOriginOptions[0] || '');
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Edit Existing Source Options */}
                {isManagingOrigins && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700">
                      Modify Source Options ({incomeOriginOptions.length})
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-200/60 rounded border border-slate-200/80 bg-white">
                      {incomeOriginOptions.length === 0 ? (
                        <div className="p-2.5 text-center text-xs text-slate-400">
                          No saved options
                        </div>
                      ) : (
                        incomeOriginOptions.map((opt) => {
                          const isEditingOpt = editingOriginOriginal === opt;
                          return (
                            <div
                              key={opt}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                            >
                              {isEditingOpt ? (
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingOriginValue}
                                    onChange={(e) => setEditingOriginValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleRenameSavedOriginOption(opt, editingOriginValue);
                                      } else if (e.key === 'Escape') {
                                        setEditingOriginOriginal(null);
                                      }
                                    }}
                                    className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRenameSavedOriginOption(opt, editingOriginValue)
                                    }
                                    className="rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shrink-0"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingOriginOriginal(null)}
                                    className="px-1.5 py-1 text-[11px] text-slate-500 hover:text-slate-900 shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-800 break-words min-w-0">{opt}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingOriginOriginal(opt);
                                        setEditingOriginValue(opt);
                                      }}
                                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSavedOriginOption(opt)}
                                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Total Income Amount, Currency & Date (With Quarter Intelligence & Real-Time Market FX) */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Currency
                    </label>
                    <select
                      value={incomeCurrency}
                      onChange={(e) => setIncomeCurrency(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Total Income ({incomeCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={grossAmount}
                      onChange={(e) => setGrossAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Date
                      </label>
                      <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                        {selectedDraftQuarter}
                      </span>
                    </div>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => handleDateChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>

                {activeIncomeCurrency !== currency && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <span>
                        Saved in Account Currency ({activeIncomeCurrency})
                      </span>
                      <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                        {formatAmount(rawDraftInputGross, activeIncomeCurrency)} (No Conversion)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-200/70 pt-1">
                      <span>
                        Totals Equivalent ({currency} @ {format2PointFloat(draftConversion.exchangeRate2dp)})
                      </span>
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        {formatAmount(draftConversion.convertedAmount, currency)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Receiving Account */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Account
                  </label>
                  {onAddAccount && (
                    <button
                      type="button"
                      onClick={() => setIsQuickAccountOpen(!isQuickAccountOpen)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2"
                    >
                      {isQuickAccountOpen ? 'Cancel' : '+ New Account'}
                    </button>
                  )}
                </div>

                <WrapSelect
                  ariaLabel="Account"
                  value={effectiveSelectedAccountId}
                  onChange={(val) => {
                    setSelectedAccountId(val);
                    const nextAcc =
                      summaries.find((s) => s.account.id === val)?.account ||
                      accounts.find((a) => a.id === val);
                    if (nextAcc) {
                      setIncomeCurrency(getAccountCurrency(nextAcc, currency));
                    }
                  }}
                  options={[
                    ...operatingAccounts.map((acc) => {
                      const nat = getAccountNativeBalance(
                        accountBalanceMap.get(acc.id) ?? 0,
                        acc,
                        currency,
                        fxSnapshot
                      );
                      return {
                        value: acc.id,
                        label: `${acc.name} (${formatAmount(
                          nat.amount,
                          nat.currency
                        )})${acc.isDefaultDeposit ? ' — Default' : ''}`,
                        group: 'Operating Accounts',
                      };
                    }),
                    ...savingsPillarAccounts.map((acc) => {
                      const nat = getAccountNativeBalance(
                        accountBalanceMap.get(acc.id) ?? 0,
                        acc,
                        currency,
                        fxSnapshot
                      );
                      return {
                        value: acc.id,
                        label: `${acc.name} (${formatAmount(
                          nat.amount,
                          nat.currency
                        )})`,
                        group: 'Savings Vaults',
                      };
                    }),
                  ]}
                />

                {isQuickAccountOpen && onAddAccount && (
                  <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-800">
                      New Account
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={quickAccName}
                        onChange={(e) => setQuickAccName(e.target.value)}
                        placeholder="Account name"
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={quickAccInstitution}
                        onChange={(e) => setQuickAccInstitution(e.target.value)}
                        placeholder="Institution"
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <WrapSelect
                          value={isAddingQuickType ? '__ADD_NEW__' : quickAccType}
                          options={[
                            ...accountTypeOptions.map((opt) => ({
                              value: opt,
                              label: opt,
                            })),
                            { value: '__ADD_NEW__', label: '+ New Type...' },
                          ]}
                          onChange={(val) => {
                            if (val === '__ADD_NEW__') {
                              setIsAddingQuickType(true);
                            } else {
                              setIsAddingQuickType(false);
                              setQuickAccType(val);
                            }
                          }}
                        />
                        {isAddingQuickType && (
                          <input
                            type="text"
                            value={newQuickTypeInput}
                            onChange={(e) => setNewQuickTypeInput(e.target.value)}
                            placeholder="New account type"
                            className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        )}
                      </div>
                      <select
                        value={quickAccCurrency}
                        onChange={(e) => setQuickAccCurrency(e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none h-fit"
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={quickAccInitialBalance}
                        onChange={(e) => setQuickAccInitialBalance(e.target.value)}
                        placeholder={`Initial (${quickAccCurrency})`}
                        className={`rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs tabular-nums focus:border-slate-900 focus:outline-none h-fit ${
                          (parseFloat(quickAccInitialBalance) || 0) < 0
                            ? 'text-rose-600 font-semibold'
                            : 'text-slate-900'
                        }`}
                      />
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={quickAccIsVirtual}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setQuickAccIsVirtual(checked);
                            if (checked && !quickAccMainId) {
                              setQuickAccMainId(nonVirtualMainAccounts[0]?.id || '');
                            }
                          }}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        />
                        <span className="text-xs font-medium text-slate-800">
                          Virtual account (attached to a main account)
                        </span>
                      </label>
                      {quickAccIsVirtual && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Attached Main Account
                          </label>
                          <WrapSelect
                            value={quickAccMainId || nonVirtualMainAccounts[0]?.id || ''}
                            options={nonVirtualMainAccounts.map((m) => ({
                              value: m.id,
                              label: m.name,
                            }))}
                            onChange={(val) => setQuickAccMainId(val)}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={isCreatingQuickAcc || !quickAccName.trim()}
                        onClick={handleCreateQuickAccount}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {isCreatingQuickAcc ? 'Saving...' : 'Save Account'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Defined Deductions & Learned Suggestions */}
              <div className="pt-2 border-t border-slate-100 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    Defined Deductions ({computedDraftDeductions.length})
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {onOpenDeductionAgent && (
                      <button
                        type="button"
                        onClick={onOpenDeductionAgent}
                        className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2"
                      >
                        Smart Suggestions
                      </button>
                    )}
                    {onNavigateToSettings && (
                      <button
                        type="button"
                        onClick={onNavigateToSettings}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2"
                      >
                        Manage in Settings
                      </button>
                    )}
                  </div>
                </div>

                {/* Learned Suggestions Across Your Data */}
                {(() => {
                  const learnedList = learnDeductionSuggestions({
                    incomes,
                    expenses,
                    settings,
                    activeDate: date,
                    activeSource: isAddingNewSource ? newSourceDraft : clientOrSource,
                    activeOrigin: isAddingNewOrigin ? newOriginDraft : notes,
                    grossAmount: numericDraftGross,
                  }).filter((s) => !s.isAlreadyDefinedCut);

                  if (learnedList.length === 0) return null;

                  return (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-700">
                        Suggested from Your History (Tap to Select)
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {learnedList.map((sug) => {
                          const isSelected = computedDraftDeductions.some(
                            (d) =>
                              d.name.trim().toLowerCase() ===
                              sug.name.trim().toLowerCase()
                          );
                          return (
                            <button
                              key={sug.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setDraftDeductions((prev) =>
                                    prev.filter(
                                      (d) =>
                                        d.name.trim().toLowerCase() !==
                                        sug.name.trim().toLowerCase()
                                    )
                                  );
                                } else {
                                  setDraftDeductions((prev) => [
                                    ...prev,
                                    suggestionToIncomeDeductionItem(
                                      sug,
                                      numericDraftGross,
                                      date
                                    ),
                                  ]);
                                }
                              }}
                              title={sug.reason}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                isSelected
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                              }`}
                            >
                              {isSelected ? '✓ ' : '+ '}
                              {sug.name} (
                              {sug.type === 'percentage'
                                ? `${sug.value}%`
                                : `${currency} ${sug.value}`}
                              )
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {definedCuts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 py-3.5 px-3 text-center space-y-1.5">
                    <div className="text-xs text-slate-500">
                      No deductions defined in Settings.
                    </div>
                    {onNavigateToSettings && (
                      <button
                        type="button"
                        onClick={onNavigateToSettings}
                        className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Define Deductions in Settings
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Toggle pills for defined deductions */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {definedCuts.map((cut) => {
                        const isIncluded = computedDraftDeductions.some(
                          (d) =>
                            d.id === `ded_${cut.id}` ||
                            d.name.toLowerCase() === cut.name.toLowerCase()
                        );
                        const isSavCut = isSavingsDeduction(cut);
                        const activeCutVal = isSavCut
                          ? getSavingsCutRateForDate(cut, date).rate
                          : cut.amount;
                        return (
                          <button
                            key={cut.id}
                            type="button"
                            onClick={() => handleToggleDefinedRuleInDraft(cut)}
                            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              isIncluded
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                            }`}
                          >
                            {isIncluded ? '✓ ' : '+ '}
                            {cut.name} (
                            {isSavCut ? `${selectedDraftQuarter}: ` : ''}
                            {cut.type === 'percentage'
                              ? `${activeCutVal}%`
                              : `${currency} ${activeCutVal}`}
                            )
                          </button>
                        );
                      })}
                    </div>

                    {computedDraftDeductions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 py-3 px-3 text-center text-xs text-slate-400">
                        Select a defined deduction above to apply
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {computedDraftDeductions.map((ded) => {
                          const isSav = isSavingsDeduction(ded);
                          const savingsShares = isSav
                            ? computeSavingsBreakdown(ded.amount, accounts, settings)
                            : [];
                          const matchedSavCut = isSav
                            ? definedCuts.find(
                                (c) =>
                                  ded.id === `ded_${c.id}` ||
                                  c.name.trim().toLowerCase() ===
                                    ded.name.trim().toLowerCase()
                              )
                            : undefined;

                          return (
                            <div
                              key={ded.id}
                              className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-2.5 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                  <span className="font-display text-xs font-semibold text-slate-900 break-words">
                                    {ded.name}
                                  </span>
                                  <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 break-words">
                                    {isSav
                                      ? `${selectedDraftQuarter} Rate (${ded.value}${
                                          ded.type === 'percentage' ? '%' : ''
                                        }) · Savings Splits`
                                      : `Expense · ${ded.expenseCategory || 'General'}${
                                          ded.expenseSubcategory
                                            ? ` → ${ded.expenseSubcategory}`
                                            : ''
                                        }`}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDraftDeduction(ded.id)}
                                  className="text-xs text-slate-500 hover:text-slate-900 px-1.5 py-0.5 shrink-0"
                                >
                                  Remove
                                </button>
                              </div>

                              {isSav && matchedSavCut?.quarterlyRates && (
                                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-500">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => {
                                      const qRate =
                                        matchedSavCut.quarterlyRates?.[q] ??
                                        matchedSavCut.amount;
                                      const isActiveQ =
                                        selectedDraftQuarter === q && !ded.isCustomRateOverride;
                                      return (
                                        <button
                                          key={q}
                                          type="button"
                                          onClick={() =>
                                            handleUpdateDraftDeduction(ded.id, {
                                              value: qRate,
                                              isCustomRateOverride: selectedDraftQuarter !== q,
                                            })
                                          }
                                          className={`rounded px-1.5 py-0.5 font-mono tabular-nums transition-colors ${
                                            isActiveQ
                                              ? 'bg-slate-900 text-white font-semibold'
                                              : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
                                          }`}
                                        >
                                          {q}: {qRate}
                                          {ded.type === 'percentage' ? '%' : ''}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {ded.isCustomRateOverride && (
                                    <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 font-medium text-amber-800">
                                      Custom Rate ({ded.value}
                                      {ded.type === 'percentage' ? '%' : ''})
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-5 sm:col-span-4">
                                    <WrapSelect
                                      value={ded.type}
                                      onChange={(val) =>
                                        handleUpdateDraftDeduction(ded.id, {
                                          type: val as 'percentage' | 'fixed',
                                          isCustomRateOverride: true,
                                        })
                                      }
                                      triggerClassName="px-2 py-1.5 text-xs"
                                      options={[
                                        { value: 'percentage', label: '% Rate' },
                                        { value: 'fixed', label: `Fixed (${activeIncomeCurrency})` },
                                      ]}
                                    />
                                  </div>

                                  <div className="col-span-3">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={ded.value}
                                      onChange={(e) =>
                                        handleUpdateDraftDeduction(ded.id, {
                                          value: Math.max(0, parseFloat(e.target.value) || 0),
                                          isCustomRateOverride: true,
                                        })
                                      }
                                      placeholder="0"
                                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                                    />
                                  </div>

                                  <div className="col-span-4 sm:col-span-5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums break-words">
                                    -{formatAmount(ded.amount, activeIncomeCurrency)}
                                  </div>
                                </div>

                                {!isSav && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-200/60">
                                    <div>
                                      <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                        Expense Category
                                      </label>
                                      <WrapSelect
                                        value={ded.expenseCategory || ''}
                                        onChange={(nextCat) => {
                                          const pref = effectiveExpensePrefs.find(
                                            (p) => p.name === nextCat
                                          );
                                          handleUpdateDraftDeduction(ded.id, {
                                            expenseCategory: nextCat,
                                            expenseSubcategory:
                                              pref?.subcategories[0] || '',
                                          });
                                        }}
                                        triggerClassName="px-2 py-1 text-[11px]"
                                        options={[
                                          ...effectiveExpensePrefs.map((pref) => ({
                                            value: pref.name,
                                            label: pref.name,
                                          })),
                                          ...(ded.expenseCategory &&
                                          !effectiveExpensePrefs.some(
                                            (p) => p.name === ded.expenseCategory
                                          )
                                            ? [
                                                {
                                                  value: ded.expenseCategory,
                                                  label: ded.expenseCategory,
                                                },
                                              ]
                                            : []),
                                        ]}
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                                        Subcategory
                                      </label>
                                      {(() => {
                                        const activePref = effectiveExpensePrefs.find(
                                          (p) => p.name === ded.expenseCategory
                                        );
                                        const subs = activePref?.subcategories || [];
                                        return subs.length > 0 ? (
                                          <WrapSelect
                                            value={ded.expenseSubcategory || ''}
                                            onChange={(val) =>
                                              handleUpdateDraftDeduction(ded.id, {
                                                expenseSubcategory: val,
                                              })
                                            }
                                            triggerClassName="px-2 py-1 text-[11px]"
                                            options={[
                                              ...subs.map((s) => ({
                                                value: s,
                                                label: s,
                                              })),
                                              { value: '', label: 'None' },
                                            ]}
                                          />
                                        ) : (
                                          <input
                                            type="text"
                                            value={ded.expenseSubcategory || ''}
                                            onChange={(e) =>
                                              handleUpdateDraftDeduction(ded.id, {
                                                expenseSubcategory: e.target.value,
                                              })
                                            }
                                            placeholder="Subcategory"
                                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-slate-900 focus:outline-none"
                                          />
                                        );
                                      })()}
                                    </div>
                                  </div>
                                )}

                                {isSav && (
                                  <div className="rounded-md border border-slate-200 bg-white p-2 space-y-1">
                                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-medium text-slate-900">
                                      <span>Transfers to Savings Splits</span>
                                      <span className="font-mono tabular-nums">
                                        {formatAmount(ded.amount, activeIncomeCurrency)}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-0.5 pt-1 border-t border-slate-100">
                                      {savingsShares.map((share) => (
                                        <div
                                          key={share.bucketId}
                                          className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600"
                                        >
                                          <span className="break-words pr-2">
                                            {share.percentage}% → {share.accountName}
                                          </span>
                                          <span className="font-mono font-medium text-slate-900 tabular-nums shrink-0">
                                            +{formatAmount(share.amount, activeIncomeCurrency)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 6. Net Income After Deductions Destination Account */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-800">
                      Transfer Net Income After Deductions To
                    </label>
                    {onNavigateToSettings && (
                      <button
                        type="button"
                        onClick={onNavigateToSettings}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2"
                      >
                        Configure in Settings
                      </button>
                    )}
                  </div>
                  <WrapSelect
                    ariaLabel="Transfer Net Income After Deductions To"
                    value={draftNetTransferAccountId}
                    onChange={(val) => setDraftNetTransferAccountId(val)}
                    options={[
                      (() => {
                        const nat = getAccountNativeBalance(
                          accountBalanceMap.get(effectiveSelectedAccountId) ?? 0,
                          selectedAccountObj,
                          currency,
                          fxSnapshot
                        );
                        return {
                          value: '',
                          label: `Keep in ${selectedAccountObj?.name || 'Receiving Account'} (${formatAmount(
                            nat.amount,
                            nat.currency
                          )})`,
                        };
                      })(),
                      ...operatingAccounts
                        .filter((acc) => acc.id !== effectiveSelectedAccountId)
                        .map((acc) => {
                          const sumAcc = summaries.find((s) => s.account.id === acc.id)?.account || acc;
                          const nat = getAccountNativeBalance(
                            accountBalanceMap.get(acc.id) ?? 0,
                            sumAcc,
                            currency,
                            fxSnapshot
                          );
                          return {
                            value: acc.id,
                            label: `Transfer Net to ${acc.name} (${formatAmount(
                              nat.amount,
                              nat.currency
                            )})`,
                            group: 'Operating Accounts',
                          };
                        }),
                      ...savingsPillarAccounts
                        .filter((acc) => acc.id !== effectiveSelectedAccountId)
                        .map((acc) => {
                          const sumAcc = summaries.find((s) => s.account.id === acc.id)?.account || acc;
                          const nat = getAccountNativeBalance(
                            accountBalanceMap.get(acc.id) ?? 0,
                            sumAcc,
                            currency,
                            fxSnapshot
                          );
                          return {
                            value: acc.id,
                            label: `Transfer Net to ${acc.name} (${formatAmount(
                              nat.amount,
                              nat.currency
                            )})`,
                            group: 'Savings Vaults',
                          };
                        }),
                    ]}
                  />
                </div>

                {/* 7. Summary */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600">
                    <span>Total Income ({activeIncomeCurrency})</span>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                      +{formatAmount(numericDraftGross, activeIncomeCurrency)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600">
                    <span>Expenses (Deductions)</span>
                    <span className="font-mono font-medium text-rose-600 tabular-nums">
                      -{formatAmount(draftExpenseDeductionsTotal, activeIncomeCurrency)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600">
                    <span>Savings Accumulated</span>
                    <span className="font-mono font-medium text-rose-600 tabular-nums">
                      -{formatAmount(draftSavingsTotal, activeIncomeCurrency)}
                    </span>
                  </div>
                  <div className="border-t border-slate-200/80 pt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-semibold text-slate-900">
                    <span className="break-words pr-2">
                      Net After Deductions (
                      {draftNetTransferAccountId &&
                      draftNetTransferAccountId !== effectiveSelectedAccountId
                        ? `→ ${
                            accounts.find((a) => a.id === draftNetTransferAccountId)
                              ?.name || 'Selected Account'
                          }`
                        : selectedAccountObj?.name || 'Account'}
                      )
                    </span>
                    <span
                      className={`font-mono text-sm tabular-nums shrink-0 ${
                        draftNetRetained < 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatAmount(draftNetRetained, activeIncomeCurrency)}
                    </span>
                  </div>
                </div>

              <button
                type="submit"
                disabled={isSubmitting || !clientOrSource.trim() || numericDraftGross <= 0}
                className="w-full rounded-lg bg-slate-900 py-2.5 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? 'Saving...' : 'Save Income'}
              </button>
            </form>
          )}
        </div>

        {/* RIGHT COLUMN: Recorded Income List */}
        <div
          className={`${
            isRecordFormCollapsed ? 'lg:col-span-12' : 'lg:col-span-7'
          } space-y-3.5 min-w-0`}
        >
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search records..."
              className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-900 focus:outline-none max-w-full"
              >
                <option value="all">All Accounts ({incomes.length})</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>

              {filteredIncomes.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleExpandAllIncomes}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                >
                  {anyFilteredExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              )}
            </div>
          </div>

          {/* Income Records List */}
          {filteredIncomes.length === 0 ? (
            <div className="rounded-xl border border-slate-200/90 bg-white p-10 text-center">
              <p className="font-display text-sm font-semibold text-slate-900">
                No Income Records
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIncomes.map((inc) => {
                const resolvedSourceAccId = resolveValidAccountId(
                  inc.accountId,
                  accounts,
                  settings
                );
                const targetAccount =
                  summaries.find((s) => s.account.id === resolvedSourceAccId)?.account ||
                  accounts.find((a) => a.id === resolvedSourceAccId) ||
                  defaultAccount;
                const { nativeGross: incNativeGross, currency: incRecordCurr } =
                  getIncomeNativeGross(inc, settings, accounts);
                const effectiveNetDestId = getEffectiveNetTransferAccountId(
                  inc,
                  settings,
                  accounts
                );
                const netDestAccount = effectiveNetDestId
                  ? summaries.find((s) => s.account.id === effectiveNetDestId)?.account ||
                    accounts.find((a) => a.id === effectiveNetDestId)
                  : undefined;
                const itemDeductions = getEffectiveIncomeDeductions(
                  inc,
                  settings,
                  expenses
                );
                const totalSavingsTrans =
                  Math.round(
                    itemDeductions
                      .filter((d) => isSavingsDeduction(d))
                      .reduce((sum, d) => sum + d.amount, 0) * 100
                  ) / 100;
                const totalExpenseDeds =
                  Math.round(
                    itemDeductions
                      .filter((d) => !isSavingsDeduction(d))
                      .reduce((sum, d) => sum + d.amount, 0) * 100
                  ) / 100;
                const totalDed =
                  Math.round((totalSavingsTrans + totalExpenseDeds) * 100) / 100;
                const netRetained =
                  Math.round((incNativeGross - totalDed) * 100) / 100;
                const isEditing = editingIncomeId === inc.id;
                const isAddingDeduction = addingDeductionForIncomeId === inc.id;
                const isExpanded = expandedIncomeIds.has(inc.id) || isEditing;

                const availableDefinedCutsToAdd = definedCuts.filter(
                  (c) =>
                    !itemDeductions.some(
                      (d) =>
                        d.id.includes(c.id) ||
                        d.name.trim().toLowerCase() === c.name.trim().toLowerCase()
                    )
                );

                return (
                  <div
                    key={inc.id}
                    className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 transition-colors min-w-0"
                  >
                    {isEditing ? (
                      <div className="space-y-3 border-b border-slate-100 pb-4 mb-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900">
                            Edit Income Record
                          </div>
                          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                            {getQuarterFromDate(editDate)}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <label className="block text-[11px] text-slate-500">
                                Income Source
                              </label>
                              <button
                                type="button"
                                onClick={() => setIsManagingSources((prev) => !prev)}
                                className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                              >
                                {isManagingSources ? 'Done' : 'Edit'}
                              </button>
                            </div>
                            <WrapSelect
                              value={
                                isAddingEditSource
                                  ? '__CUSTOM__'
                                  : editSource.trim()
                              }
                              options={[
                                ...incomeSourceOptions.map((src) => ({
                                  value: src,
                                  label: src,
                                })),
                                ...(editSource.trim() &&
                                !incomeSourceOptions.includes(editSource.trim()) &&
                                !isAddingEditSource
                                  ? [
                                      {
                                        value: editSource.trim(),
                                        label: editSource.trim(),
                                      },
                                    ]
                                  : []),
                                {
                                  value: '__CUSTOM__',
                                  label: '+ Add New Income Source...',
                                },
                              ]}
                              onChange={(val) => {
                                if (val === '__CUSTOM__') {
                                  setIsAddingEditSource(true);
                                  setNewEditSourceDraft('');
                                } else {
                                  setIsAddingEditSource(false);
                                  setNewEditSourceDraft('');
                                  setEditSource(val);
                                }
                              }}
                            />
                            {isAddingEditSource && (
                              <input
                                type="text"
                                autoFocus
                                value={newEditSourceDraft}
                                onChange={(e) => {
                                  setNewEditSourceDraft(e.target.value);
                                  setEditSource(e.target.value);
                                }}
                                placeholder="Enter new income source..."
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                              />
                            )}
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1.5">
                              Account
                            </label>
                            <WrapSelect
                              value={editAccountId}
                              onChange={(val) => {
                                setEditAccountId(val);
                                const nextAcc = accounts.find((a) => a.id === val);
                                if (nextAcc) {
                                  setEditCurrency(
                                    getAccountCurrency(nextAcc, currency)
                                  );
                                }
                              }}
                              options={accounts.map((a) => ({
                                value: a.id,
                                label: a.name,
                              }))}
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="block text-[11px] text-slate-500">
                              Source
                            </label>
                            <button
                              type="button"
                              onClick={() => setIsManagingOrigins((prev) => !prev)}
                              className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                            >
                              {isManagingOrigins ? 'Done' : 'Edit'}
                            </button>
                          </div>
                          <WrapSelect
                            value={
                              isAddingEditOrigin
                                ? '__CUSTOM_ORIGIN__'
                                : editNotes.trim()
                            }
                            options={[
                              ...incomeOriginOptions.map((orig) => ({
                                value: orig,
                                label: orig,
                              })),
                              ...(editNotes.trim() &&
                              !incomeOriginOptions.includes(editNotes.trim()) &&
                              !isAddingEditOrigin
                                ? [
                                    {
                                      value: editNotes.trim(),
                                      label: editNotes.trim(),
                                    },
                                  ]
                                : []),
                              {
                                value: '__CUSTOM_ORIGIN__',
                                label: '+ Add New Source...',
                              },
                            ]}
                            onChange={(val) => {
                              if (val === '__CUSTOM_ORIGIN__') {
                                setIsAddingEditOrigin(true);
                                setNewEditOriginDraft('');
                              } else {
                                setIsAddingEditOrigin(false);
                                setNewEditOriginDraft('');
                                setEditNotes(val);
                              }
                            }}
                          />
                          {isAddingEditOrigin && (
                            <input
                              type="text"
                              autoFocus
                              value={newEditOriginDraft}
                              onChange={(e) => {
                                setNewEditOriginDraft(e.target.value);
                                setEditNotes(e.target.value);
                              }}
                              placeholder="Enter new source..."
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                            />
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Currency
                              </label>
                              <select
                                value={editCurrency}
                                onChange={(e) => setEditCurrency(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                              >
                                {SUPPORTED_CURRENCIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-5">
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Total Income ({editCurrency})
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={editGross}
                                onChange={(e) => setEditGross(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                              />
                            </div>
                            <div className="sm:col-span-4">
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Date ({getQuarterFromDate(editDate)})
                              </label>
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                              />
                            </div>
                          </div>

                          {editCurrency !== currency && (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1 text-xs">
                              <div className="flex items-center justify-between gap-2 text-slate-600">
                                <span>
                                  Saved in Account Currency ({editCurrency})
                                </span>
                                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                                  {formatAmount(parseFloat(editGross) || 0, editCurrency)} (No Conversion)
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-200/70 pt-1">
                                <span>
                                  Totals Equivalent ({currency} @{' '}
                                  {format2PointFloat(
                                    getExchangeRate(
                                      editCurrency,
                                      currency,
                                      fxSnapshot
                                    ).rate2dp
                                  )}
                                  )
                                </span>
                                <span className="font-mono font-semibold text-slate-800 tabular-nums">
                                  {formatAmount(
                                    convertCurrency2dp(
                                      parseFloat(editGross) || 0,
                                      editCurrency,
                                      currency,
                                      fxSnapshot
                                    ).convertedAmount,
                                    currency
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Transfer Net Income After Deductions To
                          </label>
                          <WrapSelect
                            value={editNetTransferAccountId}
                            onChange={(val) => setEditNetTransferAccountId(val)}
                            options={[
                              {
                                value: '',
                                label: `Keep in ${
                                  accounts.find((a) => a.id === editAccountId)?.name ||
                                  'Receiving Account'
                                }`,
                              },
                              ...accounts
                                .filter((a) => a.id !== editAccountId)
                                .map((a) => {
                                  const sumAcc =
                                    summaries.find((s) => s.account.id === a.id)?.account || a;
                                  const nat = getAccountNativeBalance(
                                    accountBalanceMap.get(a.id) ?? 0,
                                    sumAcc,
                                    currency,
                                    fxSnapshot
                                  );
                                  return {
                                    value: a.id,
                                    label: `Transfer Net to ${a.name} (${formatAmount(
                                      nat.amount,
                                      nat.currency
                                    )})`,
                                  };
                                }),
                            ]}
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingIncomeId(null)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEditIncome(inc)}
                            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => toggleIncomeExpand(inc.id)}
                        className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 cursor-pointer select-none ${
                          isExpanded ? 'border-b border-slate-100 pb-3.5' : ''
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${
                                isExpanded ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                            <h3 className="font-display text-sm sm:text-base font-semibold text-slate-900 break-words">
                              {inc.clientOrSource}
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-slate-500">
                            <span className="font-mono tabular-nums">{inc.date}</span>
                            {inc.notes && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-700 break-words">{inc.notes}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-700 break-words">
                              {netDestAccount
                                ? `${targetAccount?.name || 'Account'} → Net to ${netDestAccount.name}`
                                : targetAccount?.name || 'Account'}
                            </span>
                          </div>
                        </div>

                        <div className="flex sm:flex-col items-end justify-between sm:justify-start gap-1.5 shrink-0 pl-6 sm:pl-0">
                          <div className="text-right font-mono tabular-nums space-y-0.5">
                            <div className="text-sm font-semibold text-emerald-700">
                              +{formatAmount(incNativeGross, incRecordCurr)}
                            </div>
                            {incRecordCurr !== currency && (
                              <div className="text-[10px] text-slate-400">
                                Totals ({currency}):{' '}
                                {formatAmount(
                                  convertCurrency2dp(
                                    incNativeGross,
                                    incRecordCurr,
                                    currency,
                                    fxSnapshot
                                  ).convertedAmount,
                                  currency
                                )}{' '}
                                @{' '}
                                {format2PointFloat(
                                  getExchangeRate(
                                    incRecordCurr,
                                    currency,
                                    fxSnapshot
                                  ).rate2dp
                                )}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-500">
                              {totalDed > 0 ? (
                                <span className="text-rose-600 font-medium">
                                  Ded: -{formatAmount(totalDed, incRecordCurr)} ·{' '}
                                </span>
                              ) : null}
                              <span
                                className={`font-semibold ${
                                  netRetained < 0 ? 'text-rose-600' : 'text-emerald-700'
                                }`}
                              >
                                Net: {formatAmount(netRetained, incRecordCurr)}
                              </span>
                            </div>
                          </div>

                          <div
                            className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => toggleIncomeExpand(inc.id)}
                              className="hover:text-slate-900"
                            >
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </button>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => handleStartEditIncome(inc)}
                              className="hover:text-slate-900"
                            >
                              Edit
                            </button>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmDeleteConfig({
                                  title: 'Delete Income Record?',
                                  message: `Delete "${inc.clientOrSource}" (${formatAmount(incNativeGross, incRecordCurr)})?`,
                                  confirmLabel: 'Delete',
                                  onConfirm: () => onDeleteIncome(inc.id),
                                })
                              }
                              className="hover:text-slate-900"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Expanded Deductions */}
                    {isExpanded && (
                      <div className="pt-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-700">
                            Defined Deductions ({itemDeductions.length})
                          </span>
                          {availableDefinedCutsToAdd.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (isAddingDeduction) {
                                  setAddingDeductionForIncomeId(null);
                                } else {
                                  setSelectedDefinedCutId(
                                    availableDefinedCutsToAdd[0]?.id || ''
                                  );
                                  setAddingDeductionForIncomeId(inc.id);
                                }
                              }}
                              className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2"
                            >
                              {isAddingDeduction ? 'Cancel' : '+ Apply Defined Deduction'}
                            </button>
                          )}
                        </div>

                        {isAddingDeduction && availableDefinedCutsToAdd.length > 0 && (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center gap-2">
                            <WrapSelect
                              value={selectedDefinedCutId}
                              onChange={(val) => setSelectedDefinedCutId(val)}
                              className="flex-1 min-w-[200px]"
                              triggerClassName="px-2.5 py-1.5 text-xs"
                              options={availableDefinedCutsToAdd.map((c) => {
                                const isSavCut = isSavingsDeduction(c);
                                const { rate: resolvedRate, quarter: resolvedQuarter } = isSavCut
                                  ? getSavingsCutRateForDate(c, inc.date)
                                  : { rate: c.amount, quarter: getQuarterFromDate(inc.date) };
                                return {
                                  value: c.id,
                                  label: `${c.name} (${
                                    c.type === 'percentage'
                                      ? `${resolvedRate}%`
                                      : formatAmount(resolvedRate, incRecordCurr)
                                  }${isSavCut ? ` · ${resolvedQuarter}` : ''}) — ${
                                    isSavCut ? 'Savings Split Transfer' : 'Expense'
                                  }`,
                                };
                              })}
                            />
                            <button
                              type="button"
                              onClick={() => handleAddDefinedDeductionToExistingIncome(inc)}
                              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 shrink-0"
                            >
                              Apply
                            </button>
                          </div>
                        )}

                        {itemDeductions.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 py-3 px-3 text-center text-xs text-slate-400">
                            No defined deductions applied
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-slate-50/50">
                            {itemDeductions.map((ded) => {
                              const isSav = isSavingsDeduction(ded);
                              const savingsShares = isSav
                                ? computeSavingsBreakdown(ded.amount, accounts, settings)
                                : [];

                              return (
                                <div key={ded.id} className="px-3 py-2.5 text-xs space-y-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                      <span className="font-medium text-slate-900 break-words">
                                        {ded.name}
                                      </span>
                                      <div className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          aria-label={`${ded.name} rate`}
                                          value={ded.value}
                                          onChange={(e) =>
                                            handleUpdateExistingIncomeDeductionRate(
                                              inc,
                                              ded.id,
                                              parseFloat(e.target.value) || 0
                                            )
                                          }
                                          className="w-14 bg-transparent font-mono text-[11px] font-semibold text-slate-900 tabular-nums focus:outline-none"
                                        />
                                        <span>
                                          {ded.type === 'percentage' ? '%' : incRecordCurr}
                                          {isSav ? ` · ${getQuarterFromDate(inc.date)}` : ''}
                                        </span>
                                      </div>
                                      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 break-words">
                                        {isSav
                                          ? 'Transfer → Savings Splits'
                                          : `Expense · ${ded.expenseCategory || 'General'}${
                                              ded.expenseSubcategory
                                                ? ` → ${ded.expenseSubcategory}`
                                                : ''
                                            }`}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2.5 shrink-0">
                                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                        -{formatAmount(ded.amount, incRecordCurr)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteConfig({
                                            title: 'Remove Deduction?',
                                            message: `Remove "${ded.name}" (${formatAmount(ded.amount, incRecordCurr)})?`,
                                            confirmLabel: 'Remove',
                                            onConfirm: () =>
                                              handleRemoveDeductionFromExistingIncome(
                                                inc,
                                                ded.id
                                              ),
                                          })
                                        }
                                        className="text-slate-400 hover:text-slate-900"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>

                                  {!isSav && (
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                      <span className="text-[11px] text-slate-500">
                                        Match Category:
                                      </span>
                                      <WrapSelect
                                        value={ded.expenseCategory || ''}
                                        onChange={(nextCat) => {
                                          const pref = effectiveExpensePrefs.find(
                                            (p) => p.name === nextCat
                                          );
                                          handleUpdateExistingIncomeDeductionCategory(
                                            inc,
                                            ded.id,
                                            nextCat,
                                            pref?.subcategories[0] || ''
                                          );
                                        }}
                                        className="min-w-[140px] max-w-full sm:max-w-[220px]"
                                        triggerClassName="px-2 py-1 text-[11px]"
                                        options={effectiveExpensePrefs.map((pref) => ({
                                          value: pref.name,
                                          label: pref.name,
                                        }))}
                                      />

                                      {(() => {
                                        const activePref = effectiveExpensePrefs.find(
                                          (p) => p.name === ded.expenseCategory
                                        );
                                        const subs = activePref?.subcategories || [];
                                        if (subs.length === 0) return null;
                                        return (
                                          <>
                                            <span className="text-[11px] text-slate-400">
                                              →
                                            </span>
                                            <WrapSelect
                                              value={ded.expenseSubcategory || ''}
                                              onChange={(val) =>
                                                handleUpdateExistingIncomeDeductionCategory(
                                                  inc,
                                                  ded.id,
                                                  ded.expenseCategory || '',
                                                  val
                                                )
                                              }
                                              className="min-w-[140px] max-w-full sm:max-w-[220px]"
                                              triggerClassName="px-2 py-1 text-[11px]"
                                              options={[
                                                ...subs.map((s) => ({
                                                  value: s,
                                                  label: s,
                                                })),
                                                { value: '', label: 'None' },
                                              ]}
                                            />
                                          </>
                                        );
                                      })()}
                                    </div>
                                  )}

                                  {isSav && (
                                    <div className="rounded border border-slate-200/70 bg-white p-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                      {savingsShares.map((s) => (
                                        <div
                                          key={s.bucketId}
                                          className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600"
                                        >
                                          <span className="break-words pr-2">
                                            {s.percentage}% → {s.accountName}
                                          </span>
                                          <span className="font-mono text-slate-900 font-medium tabular-nums shrink-0">
                                            +{formatAmount(s.amount, incRecordCurr)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Direct Net Income After Deductions Transfer Control */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-800">
                              Transfer Net Income After Deductions To
                            </span>
                            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                              Net: {formatAmount(netRetained, incRecordCurr)}
                            </span>
                          </div>
                          <WrapSelect
                            ariaLabel="Transfer Net Income After Deductions To"
                            value={effectiveNetDestId}
                            onChange={(val) =>
                              handleUpdateExistingIncomeNetTransfer(inc, val)
                            }
                            triggerClassName="px-2.5 py-1.5 text-xs"
                            options={[
                              (() => {
                                const nat = getAccountNativeBalance(
                                  accountBalanceMap.get(resolvedSourceAccId) ?? 0,
                                  targetAccount,
                                  currency,
                                  fxSnapshot
                                );
                                return {
                                  value: '',
                                  label: `Keep in ${
                                    targetAccount?.name || 'Receiving Account'
                                  } (${formatAmount(nat.amount, nat.currency)})`,
                                };
                              })(),
                              ...operatingAccounts
                                .filter((acc) => acc.id !== resolvedSourceAccId)
                                .map((acc) => {
                                  const sumAcc =
                                    summaries.find((s) => s.account.id === acc.id)?.account || acc;
                                  const nat = getAccountNativeBalance(
                                    accountBalanceMap.get(acc.id) ?? 0,
                                    sumAcc,
                                    currency,
                                    fxSnapshot
                                  );
                                  return {
                                    value: acc.id,
                                    label: `Transfer Net to ${acc.name} (${formatAmount(
                                      nat.amount,
                                      nat.currency
                                    )})`,
                                    group: 'Operating Accounts',
                                  };
                                }),
                              ...savingsPillarAccounts
                                .filter((acc) => acc.id !== resolvedSourceAccId)
                                .map((acc) => {
                                  const sumAcc =
                                    summaries.find((s) => s.account.id === acc.id)?.account || acc;
                                  const nat = getAccountNativeBalance(
                                    accountBalanceMap.get(acc.id) ?? 0,
                                    sumAcc,
                                    currency,
                                    fxSnapshot
                                  );
                                  return {
                                    value: acc.id,
                                    label: `Transfer Net to ${acc.name} (${formatAmount(
                                      nat.amount,
                                      nat.currency
                                    )})`,
                                    group: 'Savings Vaults',
                                  };
                                }),
                            ]}
                          />
                        </div>

                        {/* Bottom Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                          <div className="flex flex-wrap items-center gap-3 text-slate-600">
                            <span>
                              Expenses:{' '}
                              <span className="font-mono font-medium text-slate-900 tabular-nums">
                                -{formatAmount(totalExpenseDeds, incRecordCurr)}
                              </span>
                            </span>
                            <span>
                              Savings Accumulated:{' '}
                              <span className="font-mono font-medium text-slate-900 tabular-nums">
                                -{formatAmount(totalSavingsTrans, incRecordCurr)}
                              </span>
                            </span>
                          </div>
                          <span className="font-medium text-slate-800 break-words">
                            Net (
                            {netDestAccount
                              ? `${targetAccount?.name || 'Account'} → ${netDestAccount.name}`
                              : targetAccount?.name || 'Account'}
                            ):{' '}
                            <span className="font-mono font-semibold tabular-nums text-emerald-700">
                              {formatAmount(netRetained, incRecordCurr)}
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Where Should Net Income After Deductions Be Transferred? Modal */}
      {isNetTransferPromptOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setIsNetTransferPromptOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1 border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Where Should Net Income Be Transferred?
              </h3>
              <p className="text-xs text-slate-500">
                After deducting {formatAmount(draftTotalDeductions, activeIncomeCurrency)}, choose which account receives the Net Income.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>Total Income</span>
                <span className="font-mono font-medium text-slate-900 tabular-nums">
                  {formatAmount(numericDraftGross, activeIncomeCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Total Deductions</span>
                <span className="font-mono font-medium text-slate-900 tabular-nums">
                  -{formatAmount(draftTotalDeductions, activeIncomeCurrency)}
                </span>
              </div>
              <div className="border-t border-slate-200 pt-1.5 flex items-center justify-between font-semibold text-slate-900">
                <span>Net Income After Deductions</span>
                <span className="font-mono text-sm tabular-nums">
                  {formatAmount(draftNetRetained, activeIncomeCurrency)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-800">
                Select Destination Account for Net Income
              </label>
              <WrapSelect
                ariaLabel="Select Destination Account for Net Income"
                value={draftNetTransferAccountId}
                onChange={(val) => setDraftNetTransferAccountId(val)}
                options={[
                  (() => {
                    const currBal = accountBalanceMap.get(effectiveSelectedAccountId) ?? 0;
                    const natBefore = getAccountNativeBalance(
                      currBal,
                      selectedAccountObj,
                      currency,
                      fxSnapshot
                    );
                    const netInAccCurr = convertCurrency2dp(
                      draftNetRetained,
                      activeIncomeCurrency,
                      natBefore.currency,
                      fxSnapshot
                    ).convertedAmount;
                    const natAfterAmount = roundTo2Decimals(natBefore.amount + netInAccCurr);
                    return {
                      value: '',
                      label: `Keep in ${
                        selectedAccountObj?.name || 'Receiving Account'
                      } (Balance: ${formatAmount(
                        natBefore.amount,
                        natBefore.currency
                      )} → ${formatAmount(natAfterAmount, natBefore.currency)})`,
                    };
                  })(),
                  ...operatingAccounts
                    .filter((acc) => acc.id !== effectiveSelectedAccountId)
                    .map((acc) => {
                      const sumAcc =
                        summaries.find((s) => s.account.id === acc.id)?.account || acc;
                      const currBal = accountBalanceMap.get(acc.id) ?? 0;
                      const natBefore = getAccountNativeBalance(
                        currBal,
                        sumAcc,
                        currency,
                        fxSnapshot
                      );
                      const netInDestCurr = convertCurrency2dp(
                        draftNetRetained,
                        activeIncomeCurrency,
                        natBefore.currency,
                        fxSnapshot
                      ).convertedAmount;
                      const natAfterAmount = roundTo2Decimals(natBefore.amount + netInDestCurr);
                      return {
                        value: acc.id,
                        label: `Transfer to ${acc.name} (Balance: ${formatAmount(
                          natBefore.amount,
                          natBefore.currency
                        )} → ${formatAmount(natAfterAmount, natBefore.currency)})`,
                        group: 'Operating Accounts',
                      };
                    }),
                  ...savingsPillarAccounts
                    .filter((acc) => acc.id !== effectiveSelectedAccountId)
                    .map((acc) => {
                      const sumAcc =
                        summaries.find((s) => s.account.id === acc.id)?.account || acc;
                      const currBal = accountBalanceMap.get(acc.id) ?? 0;
                      const natBefore = getAccountNativeBalance(
                        currBal,
                        sumAcc,
                        currency,
                        fxSnapshot
                      );
                      const netInDestCurr = convertCurrency2dp(
                        draftNetRetained,
                        activeIncomeCurrency,
                        natBefore.currency,
                        fxSnapshot
                      ).convertedAmount;
                      const natAfterAmount = roundTo2Decimals(natBefore.amount + netInDestCurr);
                      return {
                        value: acc.id,
                        label: `Transfer to ${acc.name} (Balance: ${formatAmount(
                          natBefore.amount,
                          natBefore.currency
                        )} → ${formatAmount(natAfterAmount, natBefore.currency)})`,
                        group: 'Savings Vaults',
                      };
                    }),
                ]}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              {onNavigateToSettings ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsNetTransferPromptOpen(false);
                    onNavigateToSettings();
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 underline"
                >
                  Settings Preference
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsNetTransferPromptOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => executeSaveIncomeRecord(draftNetTransferAccountId)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Confirm & Save Income'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Check Modal */}
      <ConfirmDeleteModal
        isOpen={Boolean(confirmDeleteConfig)}
        title={confirmDeleteConfig?.title || 'Confirm Delete'}
        message={confirmDeleteConfig?.message || 'Delete this item?'}
        confirmLabel={confirmDeleteConfig?.confirmLabel || 'Delete'}
        onCancel={() => setConfirmDeleteConfig(null)}
        onConfirm={() => {
          if (confirmDeleteConfig) {
            confirmDeleteConfig.onConfirm();
          }
        }}
      />
    </div>
  );
};
