import React, { useState, useEffect, useMemo } from 'react';
import {
  FinancialAccount,
  AccountTransfer,
  IncomeReceipt,
  FlexibleExpense,
  UserSettings,
  ExpenseCategoryPreference,
} from '../types/finance.ts';
import {
  calculateAccountSummaries,
  formatAmount,
  getEffectiveIncomeDeductions,
  getIncomeDeductionExpenses,
  getSavingsSplitTransfers,
  isSavingsDeduction,
  computeSavingsBreakdown,
  getEffectiveSavingsPillars,
  isSavingsVaultAccount,
  isAccountVirtual,
  getNonVirtualOperatingAccounts,
  resolveAttachedMainAccountId,
  getVaultCleanName,
  getEffectiveNetTransferAccountId,
  resolveValidAccountId,
  getIncomeNativeGross,
  formatTotalByCurrencyMode,
  getSecondaryCurrencyModeCaption,
  formatAccountCardBalanceByMode,
  DEFAULT_ACCOUNT_TYPES,
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
  convertBaseToAccountCurrency,
  getAccountNativeBalance,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { getColorThemeConfig } from '../lib/colorThemes.ts';
import { ActiveTab } from './Navigation.tsx';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.tsx';

interface AccountsViewProps {
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  settings: UserSettings;
  currency: string;
  onAddAccount: (
    account: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateAccount: (account: FinancialAccount) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onAddTransfer: (
    transfer: Omit<AccountTransfer, 'id' | 'createdAt'>
  ) => Promise<void>;
  onDeleteTransfer: (id: string) => Promise<void>;
  onUpdateIncome?: (receipt: IncomeReceipt) => Promise<void>;
  onAddExpenses?: (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => Promise<void>;
  onDeleteExpense?: (id: string) => Promise<void>;
  onSaveSettings?: (settings: UserSettings) => Promise<void>;
  onNavigateToTab?: (tab: ActiveTab) => void;
  openTransferTrigger?: number;
}

const CAUSE_PRESETS = [
  'Treasury Bond',
  'Mutual Funds',
  'Buying of Lands',
  'Fixed Deposit',
  'Equity / ETF',
];

const ADD_NEW_TYPE_VALUE = '__ADD_NEW_ACCOUNT_TYPE__';

export const AccountsView: React.FC<AccountsViewProps> = ({
  accounts,
  transfers,
  incomes,
  expenses,
  settings,
  currency,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onAddTransfer,
  onDeleteTransfer,
  onUpdateIncome,
  onAddExpenses,
  onDeleteExpense,
  onSaveSettings,
  onNavigateToTab,
  openTransferTrigger,
}) => {
  const themeConfig = useMemo(
    () => getColorThemeConfig(settings.colorTheme),
    [settings.colorTheme]
  );

  const accountColorSwatches = useMemo(
    () =>
      themeConfig.chartPalette.slice(0, 6).map((hex, i) => ({
        label: `Tone ${i + 1}`,
        value: hex,
      })),
    [themeConfig]
  );

  const [customSavedTypes, setCustomSavedTypes] = useState<string[]>([]);

  const accountTypeOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_ACCOUNT_TYPES);
    if (settings.accountTypes) {
      for (const t of settings.accountTypes) {
        if (t && t.trim()) set.add(t.trim());
      }
    }
    for (const t of customSavedTypes) {
      if (t && t.trim()) set.add(t.trim());
    }
    for (const acc of accounts) {
      if (acc.type && acc.type.trim()) set.add(acc.type.trim());
    }
    return Array.from(set);
  }, [settings.accountTypes, customSavedTypes, accounts]);

  const persistNewAccountTypeOption = async (newTypeRaw: string) => {
    const trimmed = newTypeRaw.trim();
    if (!trimmed) return '';
    if (!accountTypeOptions.includes(trimmed)) {
      const nextTypes = [...accountTypeOptions, trimmed];
      setCustomSavedTypes((prev) =>
        prev.includes(trimmed) ? prev : [...prev, trimmed]
      );
      if (onSaveSettings) {
        await onSaveSettings({
          ...settings,
          accountTypes: nextTypes,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return trimmed;
  };

  // Collapsible states for Create Account form, Operating Accounts, and Savings Vaults (all collapsed by default)
  const [isCreateAccountCollapsed, setIsCreateAccountCollapsed] = useState(true);
  const [isOperatingAccountsCollapsed, setIsOperatingAccountsCollapsed] = useState(true);
  const [isSavingsVaultsCollapsed, setIsSavingsVaultsCollapsed] = useState(true);

  // Account creation form state
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState('Operating Account');
  const [isAddingCreateType, setIsAddingCreateType] = useState(false);
  const [newCreateTypeInput, setNewCreateTypeInput] = useState('');
  const [accountCurrency, setAccountCurrency] = useState<string>(currency || 'GHS');
  const [initialBalance, setInitialBalance] = useState('0');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(themeConfig.primary);
  const [isDefaultDeposit, setIsDefaultDeposit] = useState(false);
  const [isVirtual, setIsVirtual] = useState(false);
  const [attachedMainAccountId, setAttachedMainAccountId] = useState('');
  const [isSubmittingAccount, setIsSubmittingAccount] = useState(false);

  // Real-time Market Exchange Rates state
  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    setAccountCurrency(currency || 'GHS');
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  // Pop-Up Account History Modal State
  const [historyModalAccountId, setHistoryModalAccountId] = useState<string | null>(
    null
  );

  // Editing Account Pop-up Modal State
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(null);
  const [editAccountCurrency, setEditAccountCurrency] = useState<string>(
    currency || 'GHS'
  );
  const [editInitialBalanceStr, setEditInitialBalanceStr] = useState('0');
  const [isAddingEditType, setIsAddingEditType] = useState(false);
  const [newEditTypeInput, setNewEditTypeInput] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Debit / Credit Savings Vault for Cause Modal State
  const [creditVaultAccount, setCreditVaultAccount] =
    useState<FinancialAccount | null>(null);
  const [vaultModalMode, setVaultModalMode] = useState<'debit' | 'credit'>('debit');
  const [selectedDebitInstanceId, setSelectedDebitInstanceId] = useState<string>('');
  const [causeDate, setCauseDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [causeRecipient, setCauseRecipient] = useState('');
  const [causeCategory, setCauseCategory] = useState('');
  const [causeSubcategory, setCauseSubcategory] = useState('');
  const [causeCurrency, setCauseCurrency] = useState<string>(currency || 'GHS');
  const [causeAmount, setCauseAmount] = useState('');
  const [causeNotes, setCauseNotes] = useState('');
  const [isSubmittingCause, setIsSubmittingCause] = useState(false);

  // Delete / Revert Confirmation Modal State
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirmAction: () => void;
  } | null>(null);

  // Transfer Modal / Drawer State
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  useEffect(() => {
    if (openTransferTrigger && openTransferTrigger > 0) {
      setIsTransferOpen(true);
    }
  }, [openTransferTrigger]);
  const [transferSourceId, setTransferSourceId] = useState('');
  const [transferDestId, setTransferDestId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [transferDesc, setTransferDesc] = useState('');

  // Available To-Accounts: excludes the selected From-Account
  const availableDestinationAccounts = useMemo(
    () => accounts.filter((a) => a.id !== transferSourceId),
    [accounts, transferSourceId]
  );

  const effectiveTransferDestId = useMemo(() => {
    if (
      transferDestId &&
      transferDestId !== transferSourceId &&
      availableDestinationAccounts.some((a) => a.id === transferDestId)
    ) {
      return transferDestId;
    }
    return availableDestinationAccounts[0]?.id || '';
  }, [transferDestId, transferSourceId, availableDestinationAccounts]);

  const {
    summaries,
    totalCashAcrossAllAccounts,
    totalGrossDeposited,
    totalTransferredSavings,
    totalAllocatedSavings,
    cashByCurrency,
    grossDepositedByCurrency,
    netAfterDeductionsByCurrency,
    transferredSavingsByCurrency,
  } = useMemo(
    () =>
      calculateAccountSummaries(
        accounts,
        incomes,
        expenses,
        settings,
        transfers,
        fxSnapshot
      ),
    [accounts, incomes, expenses, settings, transfers, fxSnapshot]
  );

  const totalNetAfterDeductions = useMemo(
    () =>
      Math.max(
        0,
        Math.round((totalGrossDeposited - totalAllocatedSavings) * 100) / 100
      ),
    [totalGrossDeposited, totalAllocatedSavings]
  );

  const effectivePillars = useMemo(
    () => getEffectiveSavingsPillars(settings),
    [settings]
  );

  const operatingSummaries = useMemo(
    () => summaries.filter((s) => !isSavingsVaultAccount(s.account, settings)),
    [summaries, settings]
  );

  const savingsSummaries = useMemo(
    () => summaries.filter((s) => isSavingsVaultAccount(s.account, settings)),
    [summaries, settings]
  );

  const operatingAccounts = useMemo(
    () => accounts.filter((a) => !isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const nonVirtualMainAccounts = useMemo(
    () => getNonVirtualOperatingAccounts(accounts, settings),
    [accounts, settings]
  );

  const defaultAccount =
    nonVirtualMainAccounts.find((a) => a.isDefaultDeposit) ||
    nonVirtualMainAccounts[0] ||
    operatingAccounts.find((a) => a.isDefaultDeposit) ||
    operatingAccounts[0] ||
    accounts[0];

  const categoryPreferences: ExpenseCategoryPreference[] = useMemo(
    () => settings.expenseCategoryPreferences || [],
    [settings.expenseCategoryPreferences]
  );

  // Helper to resolve which Main Account holds a Virtual Account or Savings Vault's balance
  const getVaultCustodianAccountId = (vaultAcc: FinancialAccount): string => {
    return (
      resolveAttachedMainAccountId(vaultAcc, accounts, settings) ||
      settings.vaultCustodianAccounts?.[vaultAcc.id] ||
      vaultAcc.custodianAccountId ||
      defaultAccount?.id ||
      ''
    );
  };

  const handleAssignVaultCustodian = async (
    vaultAccountId: string,
    custodianAccountId: string
  ) => {
    const nextBuckets = (settings.savingsBuckets || []).map((b) =>
      b.accountId === vaultAccountId ? { ...b, custodianAccountId } : b
    );
    if (onSaveSettings) {
      await onSaveSettings({
        ...settings,
        savingsBuckets:
          nextBuckets.length > 0 ? nextBuckets : settings.savingsBuckets,
        vaultCustodianAccounts: {
          ...(settings.vaultCustodianAccounts || {}),
          [vaultAccountId]: custodianAccountId,
        },
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleToggleVaultVirtual = async (
    vaultAcc: FinancialAccount,
    nextIsVirtual: boolean
  ) => {
    const defaultMainId =
      getVaultCustodianAccountId(vaultAcc) || nonVirtualMainAccounts[0]?.id || '';
    const nextBuckets = (settings.savingsBuckets || []).map((b) =>
      b.accountId === vaultAcc.id
        ? {
            ...b,
            isVirtual: nextIsVirtual,
            custodianAccountId: nextIsVirtual ? defaultMainId : undefined,
          }
        : b
    );
    const nextCustodians = { ...(settings.vaultCustodianAccounts || {}) };
    if (nextIsVirtual && defaultMainId) {
      nextCustodians[vaultAcc.id] = defaultMainId;
    } else if (!nextIsVirtual) {
      delete nextCustodians[vaultAcc.id];
    }
    if (onSaveSettings) {
      await onSaveSettings({
        ...settings,
        savingsBuckets:
          nextBuckets.length > 0 ? nextBuckets : settings.savingsBuckets,
        vaultCustodianAccounts: nextCustodians,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  // Active debited cause instances on `creditVaultAccount` that have not yet been credited back
  const activeVaultDebitInstances = useMemo(() => {
    if (!creditVaultAccount) return [];
    const creditedExpenseIds = new Set(
      expenses
        .filter((e) => e.vaultAction === 'credit' && e.linkedExpenseId)
        .map((e) => e.linkedExpenseId!)
    );
    return expenses.filter(
      (e) =>
        e.accountId === creditVaultAccount.id &&
        e.vaultAction !== 'credit' &&
        !e.id.startsWith('exp_ded_') &&
        !e.id.startsWith('exp_cut_') &&
        !creditedExpenseIds.has(e.id)
    );
  }, [creditVaultAccount, expenses]);

  const openVaultCauseModal = (
    acc: FinancialAccount,
    mode: 'debit' | 'credit' = 'debit',
    prefillDebitItem?: FlexibleExpense
  ) => {
    const vaultCurr = getAccountCurrency(acc, currency);
    setCreditVaultAccount(acc);
    setVaultModalMode(mode);
    setCauseDate(new Date().toISOString().split('T')[0]);
    if (mode === 'credit' && prefillDebitItem) {
      setSelectedDebitInstanceId(prefillDebitItem.id);
      setCauseRecipient(
        prefillDebitItem.recipient ||
          prefillDebitItem.description ||
          prefillDebitItem.category ||
          'Cause Return'
      );
      setCauseCategory(prefillDebitItem.category || categoryPreferences[0]?.name || '');
      setCauseSubcategory(prefillDebitItem.subcategory || '');
      const itemCurr = prefillDebitItem.currency || vaultCurr;
      setCauseCurrency(itemCurr);
      const amtToShow =
        prefillDebitItem.originalAmount !== undefined &&
        prefillDebitItem.currency === itemCurr
          ? prefillDebitItem.originalAmount
          : convertBaseToAccountCurrency(
              prefillDebitItem.amount,
              { currency: itemCurr },
              currency,
              fxSnapshot
            );
      setCauseAmount(String(amtToShow || ''));
      setCauseNotes(`Credited back from ${prefillDebitItem.date}`);
    } else {
      setSelectedDebitInstanceId('');
      setCauseRecipient('');
      setCauseCategory(categoryPreferences[0]?.name || '');
      setCauseSubcategory(categoryPreferences[0]?.subcategories?.[0] || '');
      setCauseCurrency(vaultCurr);
      setCauseAmount('');
      setCauseNotes('');
    }
  };

  const handleSelectDebitInstanceToCredit = (instanceId: string) => {
    setSelectedDebitInstanceId(instanceId);
    const matched = activeVaultDebitInstances.find((d) => d.id === instanceId);
    if (matched) {
      const vaultCurr = getAccountCurrency(creditVaultAccount, currency);
      const itemCurr = matched.currency || vaultCurr;
      setCauseRecipient(
        matched.recipient || matched.description || matched.category || 'Cause Return'
      );
      setCauseCategory(matched.category || categoryPreferences[0]?.name || '');
      setCauseSubcategory(matched.subcategory || '');
      setCauseCurrency(itemCurr);
      const amtToShow =
        matched.originalAmount !== undefined && matched.currency === itemCurr
          ? matched.originalAmount
          : convertBaseToAccountCurrency(
              matched.amount,
              { currency: itemCurr },
              currency,
              fxSnapshot
            );
      setCauseAmount(String(amtToShow || ''));
      setCauseNotes(`Cause ended (${matched.date})`);
    }
  };

  const handleSubmitCreditCause = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditVaultAccount || !onAddExpenses) return;
    const rawAmt = roundTo2Decimals(parseFloat(causeAmount));
    if (isNaN(rawAmt) || rawAmt <= 0 || !causeRecipient.trim()) return;

    setIsSubmittingCause(true);
    try {
      const selectedCurr = (causeCurrency || getAccountCurrency(creditVaultAccount, currency)).toUpperCase();
      const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
        rawAmt,
        selectedCurr,
        currency,
        fxSnapshot
      );
      const toLabel = causeRecipient.trim();
      const noteLabel = causeNotes.trim();
      await onAddExpenses([
        {
          date: causeDate,
          accountId: creditVaultAccount.id,
          recipient: toLabel,
          category: causeCategory.trim() || 'Savings Cause',
          subcategory: causeSubcategory.trim() || undefined,
          notes: noteLabel || undefined,
          description: `${
            vaultModalMode === 'credit' ? 'Credit: ' : ''
          }${toLabel}${noteLabel ? ` — ${noteLabel}` : ''}`,
          currency: selectedCurr,
          originalAmount: rawAmt,
          exchangeRate: exchangeRate2dp,
          amount: convertedAmount,
          vaultAction: vaultModalMode,
          linkedExpenseId:
            vaultModalMode === 'credit' && selectedDebitInstanceId
              ? selectedDebitInstanceId
              : undefined,
        },
      ]);
      setCreditVaultAccount(null);
      setSelectedDebitInstanceId('');
    } finally {
      setIsSubmittingCause(false);
    }
  };

  const selectedHistorySummary = useMemo(
    () =>
      historyModalAccountId
        ? summaries.find((s) => s.account.id === historyModalAccountId) || null
        : null,
    [summaries, historyModalAccountId]
  );

  // Attached Virtual Accounts & Savings Vaults for a Main Account
  const attachedSummariesForSelectedMain = useMemo(() => {
    if (!historyModalAccountId || !selectedHistorySummary) return [];
    if (isAccountVirtual(selectedHistorySummary.account, settings)) return [];
    return summaries.filter(
      (s) =>
        s.account.id !== historyModalAccountId &&
        isAccountVirtual(s.account, settings) &&
        resolveAttachedMainAccountId(s.account, accounts, settings) ===
          historyModalAccountId
    );
  }, [
    historyModalAccountId,
    selectedHistorySummary,
    summaries,
    accounts,
    settings,
  ]);

  // Incomes that fell into the tapped history modal account
  const selectedAccountIncomes = useMemo(() => {
    if (!historyModalAccountId) return [];
    return incomes.filter((inc) => {
      const targetId = resolveValidAccountId(inc.accountId, accounts, settings);
      return targetId === historyModalAccountId;
    });
  }, [incomes, historyModalAccountId, accounts, settings]);

  // Incoming Savings Split transfers routed to the tapped history modal account
  const incomingRoutedDeductions = useMemo(() => {
    if (!historyModalAccountId) return [];
    const routed: {
      id: string;
      date: string;
      incomeSource: string;
      deductionName: string;
      amount: number;
    }[] = [];

    for (const inc of incomes) {
      const incAccId = resolveValidAccountId(inc.accountId, accounts, settings);
      if (incAccId === historyModalAccountId) continue;
      const deds = getEffectiveIncomeDeductions(inc, settings);
      for (const d of deds) {
        if (isSavingsDeduction(d)) {
          const shares = computeSavingsBreakdown(d.amount, accounts, settings);
          for (const share of shares) {
            if (share.accountId === historyModalAccountId && share.amount > 0) {
              routed.push({
                id: `${inc.id}_${d.id}_${share.bucketId}`,
                date: inc.date,
                incomeSource: inc.clientOrSource,
                deductionName: `Savings Transfer: ${share.percentage}% of ${d.name} (${formatAmount(d.amount, currency)})`,
                amount: share.amount,
              });
            }
          }
        }
      }
    }
    return routed;
  }, [incomes, historyModalAccountId, settings, accounts, currency]);

  // Transfers involving the tapped history modal account (includes Savings Split Transfers, Net Income Transfers & Manual Transfers)
  const selectedAccountTransfers = useMemo(() => {
    if (!historyModalAccountId) return [];
    const savingsTransfers = getSavingsSplitTransfers(incomes, settings, accounts);
    const manual = transfers
      .filter(
        (t) =>
          !t.id.startsWith('trans_auto_') &&
          !t.id.startsWith('trans_sav_') &&
          !t.id.startsWith('trans_net_')
      )
      .map((t) => ({
        ...t,
        sourceAccountId: resolveValidAccountId(
          t.sourceAccountId,
          accounts,
          settings
        ),
        destinationAccountId: resolveValidAccountId(
          t.destinationAccountId,
          accounts,
          settings
        ),
      }));
    return [...manual, ...savingsTransfers].filter(
      (t) =>
        t.sourceAccountId === historyModalAccountId ||
        t.destinationAccountId === historyModalAccountId
    );
  }, [transfers, incomes, settings, accounts, historyModalAccountId]);

  // Expenses, Vault Debits & Vault Credits for the tapped history modal account
  const selectedAccountExpenses = useMemo(() => {
    if (!historyModalAccountId) return [];
    const deductionExps = getIncomeDeductionExpenses(
      incomes,
      settings,
      accounts,
      expenses
    );
    const standalone = expenses.filter(
      (e) => !e.id.startsWith('exp_cut_') && !e.id.startsWith('exp_ded_')
    );
    return [...standalone, ...deductionExps].filter((e) => {
      const targetId = resolveValidAccountId(e.accountId, accounts, settings);
      return targetId === historyModalAccountId;
    });
  }, [expenses, incomes, settings, accounts, historyModalAccountId]);

  const handleSaveNewCreateType = async () => {
    const saved = await persistNewAccountTypeOption(newCreateTypeInput);
    if (saved) {
      setType(saved);
      setNewCreateTypeInput('');
      setIsAddingCreateType(false);
    }
  };

  const handleSaveNewEditType = async () => {
    const saved = await persistNewAccountTypeOption(newEditTypeInput);
    if (saved && editingAccount) {
      setEditingAccount({ ...editingAccount, type: saved });
      setNewEditTypeInput('');
      setIsAddingEditType(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmittingAccount(true);
    try {
      let resolvedType = type.trim() || 'Operating Account';
      if (isAddingCreateType && newCreateTypeInput.trim()) {
        resolvedType = await persistNewAccountTypeOption(newCreateTypeInput);
      } else {
        await persistNewAccountTypeOption(resolvedType);
      }

      const resolvedMainId = isVirtual
        ? attachedMainAccountId || nonVirtualMainAccounts[0]?.id || undefined
        : undefined;

      const selectedCurr = (accountCurrency || currency).toUpperCase();
      const rawBal = roundTo2Decimals(parseFloat(initialBalance) || 0);
      const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
        rawBal,
        selectedCurr,
        currency,
        fxSnapshot
      );

      await onAddAccount({
        name: name.trim(),
        institution: institution.trim() || 'Financial Institution',
        type: resolvedType,
        currency: selectedCurr,
        originalInitialBalance: rawBal,
        exchangeRate: exchangeRate2dp,
        initialBalance: convertedAmount,
        description: description.trim(),
        color,
        isDefaultDeposit: accounts.length === 0 ? true : isDefaultDeposit,
        isVirtual: Boolean(isVirtual),
        custodianAccountId: resolvedMainId,
      });
      setName('');
      setInstitution('');
      setType(resolvedType);
      setIsAddingCreateType(false);
      setNewCreateTypeInput('');
      setAccountCurrency(currency);
      setInitialBalance('0');
      setDescription('');
      setIsDefaultDeposit(false);
      setIsVirtual(false);
      setAttachedMainAccountId('');
    } finally {
      setIsSubmittingAccount(false);
    }
  };

  const openEditAccountModal = (acc: FinancialAccount) => {
    const accIsVirtual = isAccountVirtual(acc, settings);
    const resolvedMainId =
      resolveAttachedMainAccountId(acc, accounts, settings) ||
      nonVirtualMainAccounts.find((m) => m.id !== acc.id)?.id ||
      '';
    const accCurr = getAccountCurrency(acc, currency);
    setEditingAccount({
      ...acc,
      institution: acc.institution || '',
      type: acc.type || 'Operating Account',
      description: acc.description || '',
      color: acc.color || '#0f172a',
      isDefaultDeposit: Boolean(acc.isDefaultDeposit),
      isVirtual: accIsVirtual,
      custodianAccountId: accIsVirtual ? resolvedMainId : undefined,
    });
    setEditAccountCurrency(accCurr);
    const initValToShow =
      accCurr !== currency && acc.originalInitialBalance !== undefined
        ? acc.originalInitialBalance
        : convertBaseToAccountCurrency(
            acc.initialBalance ?? 0,
            { currency: accCurr, exchangeRate: acc.exchangeRate },
            currency,
            fxSnapshot
          );
    setEditInitialBalanceStr(String(roundTo2Decimals(initValToShow)));
    setIsAddingEditType(false);
    setNewEditTypeInput('');
  };

  const handleSaveEditAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !editingAccount.name.trim()) return;
    setIsSavingEdit(true);
    try {
      let resolvedType = (editingAccount.type || '').trim() || 'Operating Account';
      if (isAddingEditType && newEditTypeInput.trim()) {
        resolvedType = await persistNewAccountTypeOption(newEditTypeInput);
      } else {
        await persistNewAccountTypeOption(resolvedType);
      }

      const nextIsVirtual = Boolean(editingAccount.isVirtual);
      const validMainOptions = nonVirtualMainAccounts.filter(
        (m) => m.id !== editingAccount.id
      );
      const nextCustodianId = nextIsVirtual
        ? editingAccount.custodianAccountId &&
          validMainOptions.some((m) => m.id === editingAccount.custodianAccountId)
          ? editingAccount.custodianAccountId
          : validMainOptions[0]?.id || undefined
        : undefined;

      const selectedCurr = (editAccountCurrency || currency).toUpperCase();
      const rawBal = roundTo2Decimals(parseFloat(editInitialBalanceStr) || 0);
      const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
        rawBal,
        selectedCurr,
        currency,
        fxSnapshot
      );

      await onUpdateAccount({
        ...editingAccount,
        name: editingAccount.name.trim(),
        institution: (editingAccount.institution || '').trim() || 'Financial Institution',
        type: resolvedType,
        currency: selectedCurr,
        originalInitialBalance: rawBal,
        exchangeRate: exchangeRate2dp,
        initialBalance: convertedAmount,
        description: (editingAccount.description || '').trim(),
        color: editingAccount.color || '#0f172a',
        isDefaultDeposit: Boolean(editingAccount.isDefaultDeposit),
        isVirtual: nextIsVirtual,
        custodianAccountId: nextCustodianId,
        updatedAt: new Date().toISOString(),
      });
      setEditingAccount(null);
      setIsAddingEditType(false);
      setNewEditTypeInput('');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmt = roundTo2Decimals(parseFloat(transferAmount));
    const destId = effectiveTransferDestId;
    if (
      !transferSourceId ||
      !destId ||
      transferSourceId === destId ||
      isNaN(rawAmt) ||
      rawAmt <= 0
    ) {
      return;
    }
    const sourceAcc = accounts.find((a) => a.id === transferSourceId);
    const destAcc = accounts.find((a) => a.id === destId);
    const sourceCurr = getAccountCurrency(sourceAcc, currency);
    const destCurr = getAccountCurrency(destAcc, currency);
    const destConv = convertCurrency2dp(rawAmt, sourceCurr, destCurr, fxSnapshot);
    const baseConv = convertCurrency2dp(rawAmt, sourceCurr, currency, fxSnapshot);

    await onAddTransfer({
      date: transferDate,
      sourceAccountId: transferSourceId,
      destinationAccountId: destId,
      sourceCurrency: sourceCurr,
      sourceAmount: rawAmt,
      destinationCurrency: destCurr,
      destinationAmount: destConv.convertedAmount,
      exchangeRate: destConv.exchangeRate2dp,
      amount: baseConv.convertedAmount,
      description: transferDesc.trim() || 'Account transfer',
      transferType: 'general',
    });
    setTransferAmount('');
    setTransferDesc('');
    setIsTransferOpen(false);
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Accounts
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateAccountCollapsed((prev) => !prev)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {isCreateAccountCollapsed
              ? '+ Create Account'
              : 'Collapse Form'}
          </button>

          {accounts.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                const defaultFrom = accounts[0]?.id || '';
                const defaultTo = accounts.find((a) => a.id !== defaultFrom)?.id || '';
                setTransferSourceId(defaultFrom);
                setTransferDestId(defaultTo);
                setIsTransferOpen(!isTransferOpen);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              {isTransferOpen ? 'Close Transfer' : 'Transfer Funds'}
            </button>
          )}
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('flexible_expenses')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              + Record Expenses
            </button>
          )}
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('income_log')}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              + Record Income
            </button>
          )}
        </div>
      </div>

      {/* Transfer Funds Drawer (To Account automatically excludes selected From Account) */}
      {isTransferOpen && accounts.length >= 2 && (() => {
        const sourceAcc = accounts.find((a) => a.id === transferSourceId);
        const destAcc = accounts.find((a) => a.id === effectiveTransferDestId);
        const sourceSummary = summaries.find((s) => s.account.id === transferSourceId);
        const sourceCurr = getAccountCurrency(sourceAcc, currency);
        const destCurr = getAccountCurrency(destAcc, currency);
        const rawTransferVal = parseFloat(transferAmount) || 0;
        const destConv = convertCurrency2dp(rawTransferVal, sourceCurr, destCurr, fxSnapshot);
        const baseConv = convertCurrency2dp(rawTransferVal, sourceCurr, currency, fxSnapshot);
        const currentSourceBal = sourceSummary
          ? sourceSummary.nativeCurrentCashBalance ?? sourceSummary.currentCashBalance
          : 0;
        const projectedSourceBal = Math.round((currentSourceBal - rawTransferVal) * 100) / 100;
        const isSourceOverdrawn = rawTransferVal > 0 && projectedSourceBal < 0;
        const isSourceWarning =
          !isSourceOverdrawn &&
          rawTransferVal > 0 &&
          currentSourceBal > 0 &&
          rawTransferVal / currentSourceBal >= 0.8;

        return (
          <form
            onSubmit={handleCreateTransfer}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Transfer Funds
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  From Account
                </label>
                <select
                  value={transferSourceId}
                  onChange={(e) => {
                    const nextFromId = e.target.value;
                    setTransferSourceId(nextFromId);
                    if (transferDestId === nextFromId || !transferDestId) {
                      const nextValidTo = accounts.find((a) => a.id !== nextFromId);
                      setTransferDestId(nextValidTo?.id || '');
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {accounts.map((a) => {
                    const aCurr = getAccountCurrency(a, currency);
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} ({aCurr})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  To Account
                </label>
                <select
                  value={effectiveTransferDestId}
                  onChange={(e) => setTransferDestId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {availableDestinationAccounts.map((a) => {
                    const aCurr = getAccountCurrency(a, currency);
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name} ({aCurr})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Amount ({sourceCurr})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Note
                </label>
                <input
                  type="text"
                  value={transferDesc}
                  onChange={(e) => setTransferDesc(e.target.value)}
                  placeholder="Reason for transfer"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {rawTransferVal > 0 && sourceAcc && (
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  isSourceOverdrawn
                    ? 'border-rose-300 bg-rose-50/90 text-rose-800'
                    : isSourceWarning
                    ? 'border-amber-200 bg-amber-50/80 text-amber-800'
                    : 'border-emerald-200/80 bg-emerald-50/60 text-emerald-800'
                }`}
              >
                <span className="font-semibold">
                  {sourceAcc.name} Balance Check:{' '}
                  {isSourceOverdrawn
                    ? 'Exceeds Available Balance'
                    : isSourceWarning
                    ? 'Near Balance Limit'
                    : 'Sufficient Balance'}
                </span>
                <span className="font-mono font-bold tabular-nums">
                  Available: {formatAmount(currentSourceBal, sourceCurr)} → After:{' '}
                  {formatAmount(projectedSourceBal, sourceCurr)}
                </span>
              </div>
            )}

            {(sourceCurr !== destCurr || sourceCurr !== currency) && rawTransferVal > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-600 font-mono tabular-nums">
                  Auto Conversion: 1 {sourceCurr} = {format2PointFloat(destConv.exchangeRate2dp)} {destCurr}
                </span>
                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                  {destAcc?.name || 'To Account'} receives {formatAmount(destConv.convertedAmount, destCurr)}
                  {destCurr !== currency && sourceCurr !== currency
                    ? ` (${formatAmount(baseConv.convertedAmount, currency)})`
                    : ''}
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Complete Transfer
              </button>
            </div>
          </form>
        );
      })()}

      {/* Main Flowing Workspace: Collapsible Create Account + Accounts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: Collapsible Create Account Form */}
        <div
          className={`${
            isCreateAccountCollapsed ? 'lg:col-span-12' : 'lg:col-span-4'
          } rounded-xl border border-slate-200/90 bg-white p-5 sm:p-6 transition-all`}
        >
          <div
            onClick={() => setIsCreateAccountCollapsed((prev) => !prev)}
            className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
              isCreateAccountCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
            }`}
          >
            <h2 className="font-display text-base font-semibold text-slate-900">
              Create Account
            </h2>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCreateAccountCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isCreateAccountCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isCreateAccountCollapsed ? '' : 'rotate-180'
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

          {!isCreateAccountCollapsed && (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Account Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ecobank Main, Stanbic Checking, MTN MoMo"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Financial Institution / Provider
                </label>
                <input
                  type="text"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="e.g. Ecobank, Stanbic, Commercial Bank"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700">
                      Account Type
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddingCreateType(!isAddingCreateType)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                    >
                      {isAddingCreateType ? 'Cancel' : '+ Add New Type'}
                    </button>
                  </div>

                  <select
                    value={isAddingCreateType ? ADD_NEW_TYPE_VALUE : type}
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW_TYPE_VALUE) {
                        setIsAddingCreateType(true);
                      } else {
                        setIsAddingCreateType(false);
                        setType(e.target.value);
                      }
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {accountTypeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value={ADD_NEW_TYPE_VALUE}>+ Add New Account Type...</option>
                  </select>

                  {isAddingCreateType && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={newCreateTypeInput}
                        onChange={(e) => setNewCreateTypeInput(e.target.value)}
                        placeholder="Enter new account type..."
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveNewCreateType}
                        disabled={!newCreateTypeInput.trim()}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 shrink-0"
                      >
                        Save Option
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Currency
                    </label>
                    <select
                      value={accountCurrency}
                      onChange={(e) => setAccountCurrency(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Initial Balance ({accountCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={initialBalance}
                      onChange={(e) => setInitialBalance(e.target.value)}
                      placeholder="0.00 (negative allowed)"
                      className={`w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs tabular-nums focus:border-slate-900 focus:outline-none ${
                        (parseFloat(initialBalance) || 0) < 0
                          ? 'text-rose-600 font-semibold'
                          : 'text-slate-900'
                      }`}
                    />
                  </div>
                </div>

                {accountCurrency !== currency && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <span>
                        Auto Rate (1 {accountCurrency} → {currency})
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {format2PointFloat(
                          getExchangeRate(accountCurrency, currency, fxSnapshot).rate2dp
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-200/70 pt-1">
                      <span>Converted ({currency})</span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          (parseFloat(initialBalance) || 0) < 0
                            ? 'text-rose-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {formatAmount(
                          convertCurrency2dp(
                            parseFloat(initialBalance) || 0,
                            accountCurrency,
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
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Purpose of this account"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  {accountColorSwatches.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${
                        color === c.value
                          ? 'scale-110 border-slate-900'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Virtual Account Checkbox & Attached Main Account Selector */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVirtual}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsVirtual(checked);
                      if (checked && !attachedMainAccountId) {
                        setAttachedMainAccountId(
                          nonVirtualMainAccounts[0]?.id || ''
                        );
                      }
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Virtual account for fund management
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Attach to a main account so transfers and spending reflect in both while totals come from the main account.
                    </div>
                  </div>
                </label>

                {isVirtual && nonVirtualMainAccounts.length > 0 && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Attached Main Account
                    </label>
                    <select
                      value={
                        attachedMainAccountId || nonVirtualMainAccounts[0]?.id || ''
                      }
                      onChange={(e) => setAttachedMainAccountId(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {nonVirtualMainAccounts.map((mainAcc) => (
                        <option key={mainAcc.id} value={mainAcc.id}>
                          {mainAcc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDefaultDeposit}
                  onChange={(e) => setIsDefaultDeposit(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>Set as default account for new income records</span>
              </label>

              <button
                type="submit"
                disabled={isSubmittingAccount || !name.trim()}
                className="w-full rounded-lg bg-slate-900 py-2.5 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {isSubmittingAccount ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>

        {/* RIGHT COLUMN: Accounts Grid */}
        <div
          className={`${
            isCreateAccountCollapsed ? 'lg:col-span-12' : 'lg:col-span-8'
          } space-y-6`}
        >
          {/* Aggregate Summary Bar (Calculated from Main Non-Virtual Accounts) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 rounded-xl border border-slate-200/90 bg-white p-5">
            <div>
              <div className="text-xs text-slate-500">Total Balance Across Accounts</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums break-words ${
                  totalCashAcrossAllAccounts < 0
                    ? 'text-rose-600'
                    : 'text-emerald-700'
                }`}
              >
                {formatTotalByCurrencyMode(
                  totalCashAcrossAllAccounts,
                  cashByCurrency,
                  settings
                )}
              </div>
              {getSecondaryCurrencyModeCaption(
                totalCashAcrossAllAccounts,
                cashByCurrency,
                settings
              ) && (
                <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
                  {getSecondaryCurrencyModeCaption(
                    totalCashAcrossAllAccounts,
                    cashByCurrency,
                    settings
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">Total Income Deposited</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums break-words ${
                  totalGrossDeposited < 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatTotalByCurrencyMode(
                  totalGrossDeposited,
                  grossDepositedByCurrency,
                  settings
                )}
              </div>
              {getSecondaryCurrencyModeCaption(
                totalGrossDeposited,
                grossDepositedByCurrency,
                settings
              ) && (
                <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
                  {getSecondaryCurrencyModeCaption(
                    totalGrossDeposited,
                    grossDepositedByCurrency,
                    settings
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">Net Income After Deductions</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums break-words ${
                  totalNetAfterDeductions < 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatTotalByCurrencyMode(
                  totalNetAfterDeductions,
                  netAfterDeductionsByCurrency,
                  settings
                )}
              </div>
              {getSecondaryCurrencyModeCaption(
                totalNetAfterDeductions,
                netAfterDeductionsByCurrency,
                settings
              ) && (
                <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
                  {getSecondaryCurrencyModeCaption(
                    totalNetAfterDeductions,
                    netAfterDeductionsByCurrency,
                    settings
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500">Total Savings Accumulated</div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums break-words ${
                  totalTransferredSavings < 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatTotalByCurrencyMode(
                  totalTransferredSavings,
                  transferredSavingsByCurrency,
                  settings
                )}
              </div>
              {getSecondaryCurrencyModeCaption(
                totalTransferredSavings,
                transferredSavingsByCurrency,
                settings
              ) && (
                <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
                  {getSecondaryCurrencyModeCaption(
                    totalTransferredSavings,
                    transferredSavingsByCurrency,
                    settings
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Section 1: Operating Accounts (Collapsible, Collapsed by Default, Name & Amount Only on Card) */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
            <div
              onClick={() => setIsOperatingAccountsCollapsed((prev) => !prev)}
              className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
                isOperatingAccountsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <h2 className="font-display text-sm sm:text-base font-semibold text-slate-900">
                Operating Accounts ({operatingSummaries.length})
              </h2>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOperatingAccountsCollapsed((prev) => !prev);
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <span>{isOperatingAccountsCollapsed ? 'Expand' : 'Collapse'}</span>
                <svg
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                    isOperatingAccountsCollapsed ? '' : 'rotate-180'
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

            {!isOperatingAccountsCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {operatingSummaries.map((s) => {
                  const cardDisplay = formatAccountCardBalanceByMode(
                    s,
                    settings,
                    fxSnapshot
                  );
                  return (
                    <div
                      key={s.account.id}
                      onClick={() => setHistoryModalAccountId(s.account.id)}
                      className="cursor-pointer rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 hover:border-slate-400 hover:shadow-xs transition-all flex items-center justify-between gap-3"
                    >
                      <h3 className="font-display text-sm font-semibold text-slate-900 break-words min-w-0">
                        {s.account.name}
                      </h3>
                      <div className="text-right shrink-0">
                        <div
                          className={`font-mono text-base font-semibold tabular-nums ${
                            cardDisplay.isNegative
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {cardDisplay.primaryText}
                        </div>
                        {cardDisplay.secondaryText && (
                          <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {cardDisplay.secondaryText}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Savings Vaults (Collapsible, Collapsed by Default, Clean Name & Amount Only on Card) */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
            <div
              onClick={() => setIsSavingsVaultsCollapsed((prev) => !prev)}
              className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
                isSavingsVaultsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <h2 className="font-display text-sm sm:text-base font-semibold text-slate-900">
                Savings Vaults ({savingsSummaries.length})
              </h2>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSavingsVaultsCollapsed((prev) => !prev);
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <span>{isSavingsVaultsCollapsed ? 'Expand' : 'Collapse'}</span>
                <svg
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                    isSavingsVaultsCollapsed ? '' : 'rotate-180'
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

            {!isSavingsVaultsCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {savingsSummaries.map((s) => {
                  const cardDisplay = formatAccountCardBalanceByMode(
                    s,
                    settings,
                    fxSnapshot
                  );
                  return (
                    <div
                      key={s.account.id}
                      onClick={() => setHistoryModalAccountId(s.account.id)}
                      className="cursor-pointer rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 hover:border-slate-400 hover:shadow-xs transition-all flex items-center justify-between gap-3"
                    >
                      <h3 className="font-display text-sm font-semibold text-slate-900 break-words min-w-0">
                        {getVaultCleanName(s.account.name)}
                      </h3>
                      <div className="text-right shrink-0">
                        <div
                          className={`font-mono text-base font-semibold tabular-nums ${
                            cardDisplay.isNegative
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {cardDisplay.primaryText}
                        </div>
                        {cardDisplay.secondaryText && (
                          <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {cardDisplay.secondaryText}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pop-Up Modal: Debit or Credit Savings Vault for a Cause */}
      {creditVaultAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
          onClick={() => setCreditVaultAccount(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {vaultModalMode === 'debit'
                    ? 'Debit Savings Vault for Cause'
                    : 'Credit Savings Vault (Cause Ended)'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {vaultModalMode === 'debit'
                    ? `Deduct from ${getVaultCleanName(creditVaultAccount.name)} and its attached main account`
                    : `Credit ${getVaultCleanName(creditVaultAccount.name)} and its attached main account`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreditVaultAccount(null)}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            {/* Mode Switcher: Debit vs Credit */}
            <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setVaultModalMode('debit');
                  setSelectedDebitInstanceId('');
                }}
                className={`rounded-md py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  vaultModalMode === 'debit'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Debit Vault (Outflow)
              </button>
              <button
                type="button"
                onClick={() => setVaultModalMode('credit')}
                className={`rounded-md py-1.5 px-2.5 text-xs font-semibold transition-colors ${
                  vaultModalMode === 'credit'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Credit Vault (Inflow)
              </button>
            </div>

            <form onSubmit={handleSubmitCreditCause} className="space-y-3.5">
              {/* When in Credit Mode, allow selecting an active debited cause instance to credit back */}
              {vaultModalMode === 'credit' &&
                activeVaultDebitInstances.length > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-1.5">
                    <label className="block text-xs font-semibold text-emerald-900">
                      Select Debited Cause Instance to Credit Back
                    </label>
                    <select
                      value={selectedDebitInstanceId}
                      onChange={(e) =>
                        handleSelectDebitInstanceToCredit(e.target.value)
                      }
                      className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                    >
                      <option value="">Custom / General Credit...</option>
                      {activeVaultDebitInstances.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.recipient || inst.description || inst.category} —{' '}
                          {formatAmount(inst.amount, currency)} ({inst.date})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cause / Description
                </label>
                <input
                  type="text"
                  required
                  value={causeRecipient}
                  onChange={(e) => setCauseRecipient(e.target.value)}
                  placeholder="e.g. Treasury Bond, Mutual Funds, Buying of Lands"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CAUSE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCauseRecipient(preset)}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={causeDate}
                    onChange={(e) => setCauseDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Currency
                  </label>
                  <select
                    value={causeCurrency}
                    onChange={(e) => setCauseCurrency(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs font-semibold text-slate-900 focus:outline-none"
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount ({causeCurrency})
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={causeAmount}
                    onChange={(e) => setCauseAmount(e.target.value)}
                    placeholder="0.00"
                    className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-semibold text-right tabular-nums focus:outline-none ${
                      vaultModalMode === 'credit'
                        ? 'text-emerald-700'
                        : 'text-rose-600'
                    }`}
                  />
                </div>
              </div>

              {(() => {
                const vaultNativeCurr = getAccountCurrency(creditVaultAccount, currency);
                const rawCauseAmt = parseFloat(causeAmount) || 0;
                if (rawCauseAmt <= 0 || (causeCurrency === vaultNativeCurr && causeCurrency === currency)) {
                  return null;
                }
                const vaultConv = convertCurrency2dp(rawCauseAmt, causeCurrency, vaultNativeCurr, fxSnapshot);
                const baseConv = convertCurrency2dp(rawCauseAmt, causeCurrency, currency, fxSnapshot);
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-600 font-mono tabular-nums">
                      Auto Rate: 1 {causeCurrency} = {format2PointFloat(vaultConv.exchangeRate2dp)} {vaultNativeCurr}
                    </span>
                    <span className={`font-mono font-semibold tabular-nums ${vaultModalMode === 'credit' ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {formatAmount(vaultConv.convertedAmount, vaultNativeCurr)}
                      {vaultNativeCurr !== currency ? ` (${formatAmount(baseConv.convertedAmount, currency)})` : ''}
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  {categoryPreferences.length > 0 ? (
                    <select
                      value={causeCategory}
                      onChange={(e) => {
                        const nextCat = e.target.value;
                        setCauseCategory(nextCat);
                        const matched = categoryPreferences.find(
                          (c) => c.name === nextCat
                        );
                        setCauseSubcategory(matched?.subcategories?.[0] || '');
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none"
                    >
                      <option value="">Select Category</option>
                      {categoryPreferences.map((cat) => (
                        <option key={cat.id} value={cat.name}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={causeCategory}
                      onChange={(e) => setCauseCategory(e.target.value)}
                      placeholder="Category (or set in Settings)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Subcategory
                  </label>
                  {(() => {
                    const matched = categoryPreferences.find(
                      (c) => c.name === causeCategory
                    );
                    const subs = matched?.subcategories || [];
                    return subs.length > 0 ? (
                      <select
                        value={causeSubcategory}
                        onChange={(e) => setCauseSubcategory(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none"
                      >
                        <option value="">None</option>
                        {subs.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={causeSubcategory}
                        onChange={(e) => setCauseSubcategory(e.target.value)}
                        placeholder="Optional subcategory"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                      />
                    );
                  })()}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={causeNotes}
                  onChange={(e) => setCauseNotes(e.target.value)}
                  placeholder="Certificate / reference notes"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreditVaultAccount(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmittingCause || !causeRecipient.trim() || !causeAmount
                  }
                  className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 ${
                    vaultModalMode === 'credit'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isSubmittingCause
                    ? 'Saving...'
                    : vaultModalMode === 'credit'
                    ? 'Credit Vault'
                    : 'Debit Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pop-Up Account History Modal (Contains all details & actions for the selected Account or Savings Vault) */}
      {selectedHistorySummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
          onClick={() => setHistoryModalAccountId(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: themeConfig.primary,
                    }}
                  />
                  <h2 className="font-display text-lg font-bold text-slate-900 break-words">
                    {isSavingsVaultAccount(selectedHistorySummary.account, settings)
                      ? getVaultCleanName(selectedHistorySummary.account.name)
                      : selectedHistorySummary.account.name}
                  </h2>
                  {isAccountVirtual(selectedHistorySummary.account, settings) ? (
                    <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      Virtual Account
                    </span>
                  ) : (
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Main Account
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-1">
                  <span className="break-words">
                    {selectedHistorySummary.account.institution || 'Financial Institution'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="break-words">{selectedHistorySummary.account.type}</span>
                  {selectedHistorySummary.account.isDefaultDeposit &&
                    !isSavingsVaultAccount(selectedHistorySummary.account, settings) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-slate-800">Default</span>
                      </>
                    )}
                  {isSavingsVaultAccount(selectedHistorySummary.account, settings) && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-emerald-700">
                        Rate:{' '}
                        {effectivePillars.find(
                          (p) => p.accountId === selectedHistorySummary.account.id
                        )?.percentage ?? 0}
                        %
                      </span>
                    </>
                  )}
                </div>

                {/* Virtual Account & Attached Main Account Controls */}
                {isSavingsVaultAccount(selectedHistorySummary.account, settings) ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
                    <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAccountVirtual(
                          selectedHistorySummary.account,
                          settings
                        )}
                        onChange={(e) =>
                          handleToggleVaultVirtual(
                            selectedHistorySummary.account,
                            e.target.checked
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                      />
                      <span className="font-medium">Virtual Vault</span>
                    </label>

                    {isAccountVirtual(
                      selectedHistorySummary.account,
                      settings
                    ) && (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-slate-500">Attached to Main:</span>
                        <select
                          value={getVaultCustodianAccountId(
                            selectedHistorySummary.account
                          )}
                          onChange={(e) =>
                            handleAssignVaultCustodian(
                              selectedHistorySummary.account.id,
                              e.target.value
                            )
                          }
                          className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
                        >
                          {nonVirtualMainAccounts.map((op) => (
                            <option key={op.id} value={op.id}>
                              {op.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : isAccountVirtual(
                    selectedHistorySummary.account,
                    settings
                  ) ? (
                  <div className="mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-500">Attached to Main Account:</span>
                    <span className="font-semibold text-slate-800">
                      {accounts.find(
                        (a) =>
                          a.id ===
                          resolveAttachedMainAccountId(
                            selectedHistorySummary.account,
                            accounts,
                            settings
                          )
                      )?.name || 'Unassigned'}
                    </span>
                  </div>
                ) : (
                  selectedHistorySummary.attachedAccountsCount > 0 && (
                    <div className="mt-2.5 inline-flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                      <span>
                        Direct Balance:{' '}
                        <strong
                          className={`font-mono tabular-nums ${
                            selectedHistorySummary.standaloneCashBalance < 0
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatAmount(
                            selectedHistorySummary.standaloneCashBalance,
                            currency
                          )}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>
                        Attached Virtual & Vaults (
                        {selectedHistorySummary.attachedAccountsCount}):{' '}
                        <strong
                          className={`font-mono tabular-nums ${
                            selectedHistorySummary.attachedVirtualBalance < 0
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatAmount(
                            selectedHistorySummary.attachedVirtualBalance,
                            currency
                          )}
                        </strong>
                      </span>
                    </div>
                  )
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isSavingsVaultAccount(selectedHistorySummary.account, settings) ? (
                  <>
                    {onAddExpenses && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const acc = selectedHistorySummary.account;
                            setHistoryModalAccountId(null);
                            openVaultCauseModal(acc, 'debit');
                          }}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Debit Vault
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const acc = selectedHistorySummary.account;
                            setHistoryModalAccountId(null);
                            openVaultCauseModal(acc, 'credit');
                          }}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          Credit Vault
                        </button>
                      </>
                    )}
                    {onNavigateToTab && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryModalAccountId(null);
                          onNavigateToTab('settings');
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Modify Vault in Settings
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const accToEdit = selectedHistorySummary.account;
                        setHistoryModalAccountId(null);
                        openEditAccountModal(accToEdit);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit Account
                    </button>
                    {operatingSummaries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const accToDel = selectedHistorySummary.account;
                          setHistoryModalAccountId(null);
                          setPendingConfirm({
                            title: 'Delete Account?',
                            message: `Delete account "${accToDel.name}"?`,
                            confirmLabel: 'Yes, Delete Account',
                            onConfirmAction: () => onDeleteAccount(accToDel.id),
                          });
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        Delete Account
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryModalAccountId(null)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Balance & Flow Summary Strip (Displayed in Account's Indicated Currency) */}
            {(() => {
              const accCurr = getAccountCurrency(selectedHistorySummary.account, currency);
              const nativeAvail =
                selectedHistorySummary.nativeCurrentCashBalance ??
                convertBaseToAccountCurrency(
                  selectedHistorySummary.currentCashBalance,
                  selectedHistorySummary.account,
                  currency,
                  fxSnapshot
                );
              const nativeInit =
                selectedHistorySummary.nativeInitialBalance ??
                (accCurr !== currency &&
                selectedHistorySummary.account.originalInitialBalance !== undefined
                  ? selectedHistorySummary.account.originalInitialBalance
                  : convertBaseToAccountCurrency(
                      selectedHistorySummary.account.initialBalance,
                      selectedHistorySummary.account,
                      currency,
                      fxSnapshot
                    ));
              const nativeInflow = isSavingsVaultAccount(
                selectedHistorySummary.account,
                settings
              )
                ? convertBaseToAccountCurrency(
                    selectedHistorySummary.vaultCreditsIn,
                    selectedHistorySummary.account,
                    currency,
                    fxSnapshot
                  )
                : selectedHistorySummary.nativeGrossDeposited ??
                  convertBaseToAccountCurrency(
                    selectedHistorySummary.grossDeposited,
                    selectedHistorySummary.account,
                    currency,
                    fxSnapshot
                  );
              const nativeTransfersIn =
                selectedHistorySummary.nativeTransfersIn ??
                convertBaseToAccountCurrency(
                  selectedHistorySummary.transfersIn,
                  selectedHistorySummary.account,
                  currency,
                  fxSnapshot
                );
              const nativeOutflow =
                selectedHistorySummary.nativeExpensesPaid !== undefined &&
                selectedHistorySummary.nativeTransfersOut !== undefined
                  ? roundTo2Decimals(
                      selectedHistorySummary.nativeExpensesPaid +
                        selectedHistorySummary.nativeTransfersOut
                    )
                  : convertBaseToAccountCurrency(
                      selectedHistorySummary.expensesPaid +
                        selectedHistorySummary.transfersOut,
                      selectedHistorySummary.account,
                      currency,
                      fxSnapshot
                    );

              return (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50/80 border-b border-slate-100 px-5 py-3.5 sm:px-6 shrink-0">
                  <div>
                    <div className="text-[11px] text-slate-500">
                      Available Balance ({accCurr})
                    </div>
                    <div
                      className={`font-mono text-sm font-semibold tabular-nums mt-0.5 break-words ${
                        nativeAvail < 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatAmount(nativeAvail, accCurr)}
                    </div>
                    {accCurr !== currency && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums mt-0.5">
                        {formatAmount(selectedHistorySummary.currentCashBalance, currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Initial Balance</div>
                    <div
                      className={`font-mono text-sm font-medium tabular-nums mt-0.5 break-words ${
                        nativeInit < 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatAmount(nativeInit, accCurr)}
                    </div>
                    {accCurr !== currency && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums mt-0.5">
                        {formatAmount(selectedHistorySummary.account.initialBalance, currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">
                      {isSavingsVaultAccount(selectedHistorySummary.account, settings)
                        ? 'Vault Credits In'
                        : `Total Income In (${selectedHistorySummary.incomeCount})`}
                    </div>
                    <div className="font-mono text-sm font-medium text-emerald-700 tabular-nums mt-0.5 break-words">
                      +{formatAmount(nativeInflow, accCurr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Transfers In</div>
                    <div className="font-mono text-sm font-medium text-emerald-700 tabular-nums mt-0.5 break-words">
                      +{formatAmount(nativeTransfersIn, accCurr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">
                      {isSavingsVaultAccount(selectedHistorySummary.account, settings)
                        ? 'Debited for Causes & Out'
                        : 'Expenses & Transfers Out'}
                    </div>
                    <div className="font-mono text-sm font-medium text-rose-600 tabular-nums mt-0.5 break-words">
                      -{formatAmount(nativeOutflow, accCurr)}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable Ledger History Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Attached Virtual Accounts & Savings Vaults Breakdown for Main Account */}
              {attachedSummariesForSelectedMain.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                    <span>
                      Attached Virtual Accounts & Savings Vaults (
                      {attachedSummariesForSelectedMain.length})
                    </span>
                    <span
                      className={`font-mono tabular-nums ${
                        selectedHistorySummary.attachedVirtualBalance < 0
                          ? 'text-rose-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatAmount(
                        convertBaseToAccountCurrency(
                          selectedHistorySummary.attachedVirtualBalance,
                          selectedHistorySummary.account,
                          currency,
                          fxSnapshot
                        ),
                        getAccountCurrency(selectedHistorySummary.account, currency)
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {attachedSummariesForSelectedMain.map((vs) => {
                      const vsNative = getAccountNativeBalance(
                        vs.standaloneCashBalance,
                        vs.account,
                        currency,
                        fxSnapshot
                      );
                      return (
                        <div
                          key={vs.account.id}
                          onClick={() => setHistoryModalAccountId(vs.account.id)}
                          className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 hover:border-slate-300 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 break-words">
                              {isSavingsVaultAccount(vs.account, settings)
                                ? getVaultCleanName(vs.account.name)
                                : vs.account.name}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {isSavingsVaultAccount(vs.account, settings)
                                ? 'Savings Vault'
                                : 'Virtual Account'}
                            </div>
                          </div>
                          <span
                            className={`font-mono font-semibold tabular-nums shrink-0 ${
                              vsNative.amount < 0
                                ? 'text-rose-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {formatAmount(vsNative.amount, vsNative.currency)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedAccountIncomes.length === 0 &&
              incomingRoutedDeductions.length === 0 &&
              selectedAccountTransfers.length === 0 &&
              selectedAccountExpenses.length === 0 &&
              attachedSummariesForSelectedMain.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No activity recorded for {selectedHistorySummary.account.name} yet.
                </div>
              ) : (
                <>
                  {/* 1. Direct Income Deposits */}
                  {selectedAccountIncomes.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-slate-800">
                        Income Records Deposited ({selectedAccountIncomes.length})
                      </div>
                      <div className="space-y-2.5">
                        {selectedAccountIncomes.map((inc) => {
                          const { nativeGross: incNativeGross, currency: incRecordCurr } =
                            getIncomeNativeGross(inc, settings, accounts);
                          const deds = getEffectiveIncomeDeductions(inc, settings);
                          const savSum = deds
                            .filter((d) => isSavingsDeduction(d))
                            .reduce((s, d) => s + d.amount, 0);
                          const expSum = deds
                            .filter((d) => !isSavingsDeduction(d))
                            .reduce((s, d) => s + d.amount, 0);
                          const netAfterDeductions = Math.max(
                            0,
                            Math.round((incNativeGross - savSum - expSum) * 100) / 100
                          );
                          const netDestAccId = getEffectiveNetTransferAccountId(
                            inc,
                            settings,
                            accounts
                          );
                          const netDestAcc = netDestAccId
                            ? accounts.find((a) => a.id === netDestAccId)
                            : undefined;
                          return (
                            <div
                              key={inc.id}
                              className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-display text-sm font-semibold text-slate-900 break-words">
                                    {inc.clientOrSource}
                                  </div>
                                  {inc.notes && (
                                    <div className="text-xs text-slate-600 mt-0.5 break-words">
                                      {inc.notes}
                                    </div>
                                  )}
                                  <div className="text-[11px] font-mono text-slate-400 mt-1 tabular-nums">
                                    {inc.date}
                                    {inc.receiptId ? ` · ${inc.receiptId}` : ''}
                                  </div>
                                </div>

                                <div className="text-right font-mono text-xs space-y-0.5 tabular-nums shrink-0">
                                  <div className="text-emerald-700 font-medium">
                                    Total Income: +{formatAmount(incNativeGross, incRecordCurr)}
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
                                  {expSum > 0 && (
                                    <div className="text-rose-600">
                                      Expenses (Deductions): -{formatAmount(expSum, incRecordCurr)}
                                    </div>
                                  )}
                                  {savSum > 0 && (
                                    <div className="text-rose-600">
                                      Savings Accumulated: -{formatAmount(savSum, incRecordCurr)}
                                    </div>
                                  )}
                                  {netDestAcc ? (
                                    <div className="font-semibold text-emerald-700 pt-0.5">
                                      Net Transferred to {netDestAcc.name}:{' '}
                                      {formatAmount(netAfterDeductions, incRecordCurr)}
                                    </div>
                                  ) : (
                                    <div className="font-semibold text-emerald-700 pt-0.5">
                                      Net Retained: {formatAmount(netAfterDeductions, incRecordCurr)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2. Expenses, Vault Debits & Vault Credits */}
                  {selectedAccountExpenses.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-slate-800">
                        {isSavingsVaultAccount(selectedHistorySummary.account, settings)
                          ? `Vault Cause Debits & Credits (${selectedAccountExpenses.length})`
                          : `Expenses Deducted (${selectedAccountExpenses.length})`}
                      </div>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-white">
                        {selectedAccountExpenses.map((exp) => {
                          const isDedExp = exp.id.startsWith('exp_ded_');
                          const isCredit = exp.vaultAction === 'credit';
                          const isVault = isSavingsVaultAccount(
                            selectedHistorySummary.account,
                            settings
                          );
                          const isAlreadyCredited =
                            !isCredit &&
                            expenses.some(
                              (e) =>
                                e.vaultAction === 'credit' &&
                                e.linkedExpenseId === exp.id
                            );

                          return (
                            <div
                              key={exp.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-slate-900 break-words">
                                    {exp.recipient || exp.description || exp.category}
                                  </span>
                                  {isVault && (
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        isCredit
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                                      }`}
                                    >
                                      {isCredit ? 'Credit' : 'Debit'}
                                    </span>
                                  )}
                                  {isAlreadyCredited && (
                                    <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                      Credited Back
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 break-words">
                                  {exp.category}
                                  {exp.subcategory ? ` / ${exp.subcategory}` : ''}
                                  {exp.notes ? ` · ${exp.notes}` : ''} ·{' '}
                                  <span className="font-mono tabular-nums">{exp.date}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0">
                                <span
                                  className={`font-mono font-semibold tabular-nums ${
                                    isCredit ? 'text-emerald-700' : 'text-rose-600'
                                  }`}
                                >
                                  {isCredit ? '+' : '-'}
                                  {formatAmount(exp.amount, currency)}
                                </span>
                                {isVault &&
                                  !isCredit &&
                                  !isDedExp &&
                                  !isAlreadyCredited &&
                                  onAddExpenses && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const acc = selectedHistorySummary.account;
                                        setHistoryModalAccountId(null);
                                        openVaultCauseModal(acc, 'credit', exp);
                                      }}
                                      className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                                    >
                                      Credit Instance
                                    </button>
                                  )}
                                {isDedExp ? (
                                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                    Income Deduction
                                  </span>
                                ) : (
                                  onDeleteExpense && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPendingConfirm({
                                          title: 'Delete Entry?',
                                          message: `Delete ${
                                            exp.recipient || exp.description || exp.category
                                          } (${formatAmount(exp.amount, currency)})?`,
                                          confirmLabel: 'Yes, Delete',
                                          onConfirmAction: () => onDeleteExpense(exp.id),
                                        });
                                      }}
                                      className="text-[11px] text-slate-400 hover:text-slate-900"
                                    >
                                      Delete
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 3. Account, Net Income & Savings Split Transfers */}
                  {selectedAccountTransfers.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="text-xs font-semibold text-slate-800">
                        Savings Split, Net Income & Account Transfers ({selectedAccountTransfers.length})
                      </div>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-white">
                        {selectedAccountTransfers.map((t) => {
                          const isOut = t.sourceAccountId === historyModalAccountId;
                          const isSavingsSplitTransfer = t.id.startsWith('trans_sav_');
                          const isNetIncomeTransfer = t.id.startsWith('trans_net_');
                          const otherAccId = isOut
                            ? t.destinationAccountId
                            : t.sourceAccountId;
                          const otherAcc = accounts.find((a) => a.id === otherAccId);
                          return (
                            <div
                              key={t.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-800 break-words">
                                  {t.description || 'Account transfer'}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 break-words">
                                  {isOut
                                    ? `Transferred to ${otherAcc?.name || 'Account'}`
                                    : `Transferred from ${otherAcc?.name || 'Account'}`}{' '}
                                  · <span className="font-mono tabular-nums">{t.date}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span
                                  className={`font-mono font-semibold tabular-nums ${
                                    isOut ? 'text-rose-600' : 'text-emerald-700'
                                  }`}
                                >
                                  {isOut ? '-' : '+'}
                                  {formatAmount(t.amount, currency)}
                                </span>
                                {isSavingsSplitTransfer ? (
                                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                    Savings Split
                                  </span>
                                ) : isNetIncomeTransfer ? (
                                  <div className="flex items-center gap-2">
                                    <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                      Net Income Transfer
                                    </span>
                                    {onUpdateIncome && t.linkedIncomeId && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const linkedInc = incomes.find(
                                            (i) => i.id === t.linkedIncomeId
                                          );
                                          if (!linkedInc) return;
                                          setPendingConfirm({
                                            title: 'Revert Net Income Transfer?',
                                            message: `Keep Net Income (${formatAmount(
                                              t.amount,
                                              currency
                                            )}) in the receiving account instead of transferring to ${
                                              otherAcc?.name || 'Account'
                                            }?`,
                                            confirmLabel: 'Yes, Keep in Receiving Account',
                                            onConfirmAction: () =>
                                              onUpdateIncome({
                                                ...linkedInc,
                                                netTransferredToAccountId: '__KEEP__',
                                                updatedAt: new Date().toISOString(),
                                              }),
                                          });
                                        }}
                                        className="text-[11px] text-slate-400 hover:text-slate-900"
                                      >
                                        Revert
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPendingConfirm({
                                        title: 'Revert Account Transfer?',
                                        message: `Revert transfer of ${formatAmount(
                                          t.amount,
                                          currency
                                        )}?`,
                                        confirmLabel: 'Yes, Revert Transfer',
                                        onConfirmAction: () => onDeleteTransfer(t.id),
                                      });
                                    }}
                                    className="text-[11px] text-slate-400 hover:text-slate-900"
                                  >
                                    Revert
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pop-Up Edit Account Modal */}
      {editingAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
          onClick={() => setEditingAccount(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-4">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Edit Account
              </h2>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveEditAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Account Name
                </label>
                <input
                  type="text"
                  required
                  value={editingAccount.name}
                  onChange={(e) =>
                    setEditingAccount({ ...editingAccount, name: e.target.value })
                  }
                  placeholder="e.g. Ecobank Main, Stanbic Checking, MTN MoMo"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Financial Institution / Provider
                </label>
                <input
                  type="text"
                  value={editingAccount.institution || ''}
                  onChange={(e) =>
                    setEditingAccount({ ...editingAccount, institution: e.target.value })
                  }
                  placeholder="e.g. Ecobank, Stanbic, Commercial Bank"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700">
                      Account Type
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsAddingEditType(!isAddingEditType)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                    >
                      {isAddingEditType ? 'Cancel' : '+ Add New Type'}
                    </button>
                  </div>

                  <select
                    value={
                      isAddingEditType
                        ? ADD_NEW_TYPE_VALUE
                        : editingAccount.type || 'Operating Account'
                    }
                    onChange={(e) => {
                      if (e.target.value === ADD_NEW_TYPE_VALUE) {
                        setIsAddingEditType(true);
                      } else {
                        setIsAddingEditType(false);
                        setEditingAccount({ ...editingAccount, type: e.target.value });
                      }
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    {accountTypeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value={ADD_NEW_TYPE_VALUE}>+ Add New Account Type...</option>
                  </select>

                  {isAddingEditType && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={newEditTypeInput}
                        onChange={(e) => setNewEditTypeInput(e.target.value)}
                        placeholder="Enter new account type..."
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveNewEditType}
                        disabled={!newEditTypeInput.trim()}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 shrink-0"
                      >
                        Save Option
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Currency
                    </label>
                    <select
                      value={editAccountCurrency}
                      onChange={(e) => setEditAccountCurrency(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Initial Balance ({editAccountCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editInitialBalanceStr}
                      onChange={(e) => setEditInitialBalanceStr(e.target.value)}
                      placeholder="0.00 (negative allowed)"
                      className={`w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs tabular-nums focus:border-slate-900 focus:outline-none ${
                        (parseFloat(editInitialBalanceStr) || 0) < 0
                          ? 'text-rose-600 font-semibold'
                          : 'text-slate-900'
                      }`}
                    />
                  </div>
                </div>

                {editAccountCurrency !== currency && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <span>
                        Auto Rate (1 {editAccountCurrency} → {currency})
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {format2PointFloat(
                          getExchangeRate(editAccountCurrency, currency, fxSnapshot)
                            .rate2dp
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-200/70 pt-1">
                      <span>Converted ({currency})</span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          (parseFloat(editInitialBalanceStr) || 0) < 0
                            ? 'text-rose-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {formatAmount(
                          convertCurrency2dp(
                            parseFloat(editInitialBalanceStr) || 0,
                            editAccountCurrency,
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
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={editingAccount.description || ''}
                  onChange={(e) =>
                    setEditingAccount({ ...editingAccount, description: e.target.value })
                  }
                  placeholder="Purpose of this account"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  {accountColorSwatches.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() =>
                        setEditingAccount({ ...editingAccount, color: c.value })
                      }
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${
                        (editingAccount.color || themeConfig.primary) === c.value
                          ? 'scale-110 border-slate-900'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Virtual Account Checkbox & Attached Main Account Selector */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
                <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingAccount.isVirtual)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const validMain = nonVirtualMainAccounts.filter(
                        (m) => m.id !== editingAccount.id
                      );
                      setEditingAccount({
                        ...editingAccount,
                        isVirtual: checked,
                        custodianAccountId: checked
                          ? editingAccount.custodianAccountId ||
                            validMain[0]?.id ||
                            undefined
                          : undefined,
                      });
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Virtual account for fund management
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Attach to a main account so transfers and spending reflect in both while totals come from the main account.
                    </div>
                  </div>
                </label>

                {Boolean(editingAccount.isVirtual) && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Attached Main Account
                    </label>
                    <select
                      value={
                        editingAccount.custodianAccountId ||
                        nonVirtualMainAccounts.find(
                          (m) => m.id !== editingAccount.id
                        )?.id ||
                        ''
                      }
                      onChange={(e) =>
                        setEditingAccount({
                          ...editingAccount,
                          custodianAccountId: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {nonVirtualMainAccounts
                        .filter((m) => m.id !== editingAccount.id)
                        .map((mainAcc) => (
                          <option key={mainAcc.id} value={mainAcc.id}>
                            {mainAcc.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(editingAccount.isDefaultDeposit)}
                  onChange={(e) =>
                    setEditingAccount({
                      ...editingAccount,
                      isDefaultDeposit: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>Set as default account for new income records</span>
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit || !editingAccount.name.trim()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Check Modal */}
      <ConfirmDeleteModal
        isOpen={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || 'Confirm Delete'}
        message={
          pendingConfirm?.message ||
          'Are you sure you want to delete this item?'
        }
        confirmLabel={pendingConfirm?.confirmLabel || 'Yes, Delete'}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm) {
            pendingConfirm.onConfirmAction();
            setPendingConfirm(null);
          }
        }}
      />
    </div>
  );
};
