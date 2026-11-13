import React, { useState, useEffect, useMemo } from 'react';
import {
  FlexibleExpense,
  IncomeReceipt,
  UserSettings,
  FinancialAccount,
  AccountTransfer,
  ExpenseCategoryPreference,
  FinancialBudget,
} from '../types/finance.ts';
import {
  checkSpendAgainstBudgetsAndAccount,
} from '../lib/budgetCalculations.ts';
import {
  formatAmount,
  calculateAccountSummaries,
  getIncomeDeductionExpenses,
  getEffectiveExpenseCategoryPreferences,
  DEFAULT_FINANCIAL_ACCOUNTS,
  isSavingsVaultAccount,
  getSavingsVaultAccountIds,
  resolveIntuitiveSubcategoryColor,
  getSubcategoryBadgeStyle,
  getExpenseNativeAndBaseAmount,
  addCurrencyBucketAmount,
  mapToCurrencyBucketTotals,
  formatTotalByCurrencyMode,
  getSecondaryCurrencyModeCaption,
} from '../lib/calculations.ts';
import {
  SUPPORTED_CURRENCIES,
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  convertCurrency2dp,
  roundTo2Decimals,
  format2PointFloat,
  getAccountCurrency,
  getAccountNativeBalance,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { ConfirmDeleteModal } from './ConfirmDeleteModal.tsx';
import { ActiveTab } from './Navigation.tsx';
import {
  formatDateDDMMYYYY,
  sortRecordsByArrivalTime,
  groupRecordsByPeriod,
  RecordGroupPeriod,
} from '../lib/dateFilters.ts';
import { learnSavingsVaultDebitAccount } from '../lib/deductionIntelligence.ts';
import { RecordCard, ExpenseDetailPopupModal } from './RecordCard.tsx';

interface ExpenseDraftRow {
  rowId: string;
  date: string;
  accountId: string;
  recipient: string;
  category: string;
  subcategory: string;
  currency: string;
  amount: string;
  notes: string;
}

interface FlexibleExpensesViewProps {
  expenses: FlexibleExpense[];
  incomes: IncomeReceipt[];
  settings: UserSettings;
  accounts?: FinancialAccount[];
  transfers?: AccountTransfer[];
  budgets?: FinancialBudget[];
  currency: string;
  onAddExpenses: (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => Promise<void>;
  onDeleteExpense: (id: string) => Promise<void>;
  onUpdateExpense?: (expense: FlexibleExpense) => Promise<void>;
  onEditExpense?: (expense: FlexibleExpense) => void;
  onMoveSubcategory?: (
    subcategory: string,
    fromCategory: string,
    toCategory: string
  ) => Promise<void>;
  onNavigateToTab?: (tab: ActiveTab) => void;
  expandFormTrigger?: number;
}

const CAUSE_QUICK_PRESETS = [
  'Treasury Bond',
  'Mutual Funds',
  'Buying of Lands',
  'Fixed Deposit',
  'Equity / ETF',
];

export const FlexibleExpensesView: React.FC<FlexibleExpensesViewProps> = ({
  expenses,
  incomes,
  settings,
  accounts = DEFAULT_FINANCIAL_ACCOUNTS,
  transfers = [],
  budgets = [],
  currency,
  onAddExpenses,
  onDeleteExpense,
  onEditExpense,
  onMoveSubcategory,
  onNavigateToTab,
  expandFormTrigger,
}) => {
  const todayStr = new Date().toISOString().substring(0, 10);

  const defaultAcc =
    accounts.find((a) => a.id === settings.defaultAccountId) ||
    accounts.find((a) => a.isDefaultDeposit) ||
    accounts[0];

  const categoryPreferences: ExpenseCategoryPreference[] = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings, expenses),
    [settings, expenses]
  );

  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const createEmptyRow = (
    dateVal = todayStr,
    accId = defaultAcc?.id || ''
  ): ExpenseDraftRow => {
    const matchedAcc = accounts.find((a) => a.id === accId) || defaultAcc;
    const accCurr = getAccountCurrency(matchedAcc, currency);
    return {
      rowId: `row_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: dateVal,
      accountId: accId,
      recipient: '',
      category: categoryPreferences[0]?.name || '',
      subcategory: categoryPreferences[0]?.subcategories?.[0] || '',
      currency: accCurr,
      amount: '',
      notes: '',
    };
  };

  // Collapsed by default
  const [isFormCollapsed, setIsFormCollapsed] = useState(true);

  useEffect(() => {
    if (expandFormTrigger && expandFormTrigger > 0) {
      setIsFormCollapsed(false);
    }
  }, [expandFormTrigger]);
  const [batchDate, setBatchDate] = useState(todayStr);
  const [rows, setRows] = useState<ExpenseDraftRow[]>(() => [
    createEmptyRow(todayStr, defaultAcc?.id || ''),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filters, search & presentation mode
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAccountFilter, setSelectedAccountFilter] = useState('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [presentationMode, setPresentationMode] = useState<'cards' | 'grouped'>('cards');
  const [groupByPeriod, setGroupByPeriod] = useState<RecordGroupPeriod>('none');
  const [selectedPopupExpense, setSelectedPopupExpense] = useState<FlexibleExpense | null>(null);
  const [expandedCategoryGroups, setExpandedCategoryGroups] = useState<Set<string>>(new Set());
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<FlexibleExpense | null>(null);

  const { summaries } = useMemo(
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

  const savingsAccounts = useMemo(
    () => accounts.filter((a) => isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const vaultIdSet = useMemo(
    () => getSavingsVaultAccountIds(settings),
    [settings]
  );

  // Combine manually recorded expenses with non-savings income deductions designated as Expenses
  const deductionExpenses = useMemo(
    () => getIncomeDeductionExpenses(incomes, settings, accounts, expenses),
    [incomes, settings, accounts, expenses]
  );

  const allCombinedExpenses = useMemo(() => {
    const standalone = expenses.filter(
      (e) => !e.id.startsWith('exp_cut_') && !e.id.startsWith('exp_ded_')
    );
    return [...standalone, ...deductionExpenses];
  }, [expenses, deductionExpenses]);

  const handleUpdateRow = (rowId: string, patch: Partial<ExpenseDraftRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const updated = { ...r, ...patch };
        if (patch.accountId !== undefined && patch.currency === undefined) {
          const prevAcc = accounts.find((a) => a.id === r.accountId);
          const nextAcc = accounts.find((a) => a.id === patch.accountId);
          const prevAccCurr = getAccountCurrency(prevAcc, currency);
          const nextAccCurr = getAccountCurrency(nextAcc, currency);
          if (!r.currency || r.currency === prevAccCurr) {
            updated.currency = nextAccCurr;
          }
        }
        if (patch.category !== undefined) {
          const matchedPref = categoryPreferences.find((c) => c.name === patch.category);
          updated.subcategory = matchedPref?.subcategories?.[0] || '';
        }
        // Automate debit from Savings Vault when recipient, subcategory, or category matches past vault-debit expenses
        if (
          patch.accountId === undefined &&
          (patch.recipient !== undefined ||
            patch.subcategory !== undefined ||
            patch.category !== undefined)
        ) {
          const learnedVault = learnSavingsVaultDebitAccount({
            expenses,
            accounts,
            settings,
            recipient: updated.recipient,
            category: updated.category,
            subcategory: updated.subcategory,
          });
          if (learnedVault) {
            const prevAcc = accounts.find((a) => a.id === r.accountId);
            const prevAccCurr = getAccountCurrency(prevAcc, currency);
            updated.accountId = learnedVault.vaultAccountId;
            if (!r.currency || r.currency === prevAccCurr) {
              updated.currency = learnedVault.vaultCurrency;
            }
          }
        }
        return updated;
      })
    );
  };

  const handleAddRow = () => {
    const lastRow = rows[rows.length - 1];
    setRows((prev) => [
      ...prev,
      createEmptyRow(lastRow?.date || batchDate, lastRow?.accountId || defaultAcc?.id || ''),
    ]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const handleApplyBatchDate = (newDate: string) => {
    setBatchDate(newDate);
    setRows((prev) => prev.map((r) => ({ ...r, date: newDate })));
  };

  const validDraftRows = useMemo(
    () =>
      rows.filter((r) => {
        const amt = parseFloat(r.amount);
        return !isNaN(amt) && amt > 0 && r.accountId;
      }),
    [rows]
  );

  const batchTotalAmount = useMemo(
    () =>
      validDraftRows.reduce((sum, r) => {
        const rawAmt = parseFloat(r.amount) || 0;
        const rowCurr =
          r.currency ||
          getAccountCurrency(
            accounts.find((a) => a.id === r.accountId),
            currency
          );
        const { convertedAmount } = convertCurrency2dp(
          rawAmt,
          rowCurr,
          currency,
          fxSnapshot
        );
        return sum + convertedAmount;
      }, 0),
    [validDraftRows, accounts, currency, fxSnapshot]
  );

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validDraftRows.length === 0) return;

    setIsSubmitting(true);
    try {
      const batchId = `batch_${Date.now()}`;
      const payloads: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[] =
        validDraftRows.map((r) => {
          const rawAmt = roundTo2Decimals(parseFloat(r.amount));
          const rowCurr = (
            r.currency ||
            getAccountCurrency(
              accounts.find((a) => a.id === r.accountId),
              currency
            )
          ).toUpperCase();
          const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
            rawAmt,
            rowCurr,
            currency,
            fxSnapshot
          );
          const toLabel = r.recipient.trim();
          const noteLabel = r.notes.trim();
          const catLabel = r.category.trim() || 'Uncategorized';
          const subLabel = r.subcategory.trim();

          const subColor = subLabel
            ? resolveIntuitiveSubcategoryColor(subLabel, catLabel, settings, expenses)
            : undefined;

          return {
            batchId,
            date: r.date || batchDate,
            accountId: r.accountId,
            recipient: toLabel || undefined,
            category: catLabel,
            subcategory: subLabel || catLabel,
            subcategoryColor: subColor,
            notes: noteLabel || undefined,
            description: subLabel || catLabel,
            currency: rowCurr,
            originalAmount: rawAmt,
            exchangeRate: exchangeRate2dp,
            amount: convertedAmount,
          };
        });

      await onAddExpenses(payloads);
      setRows([createEmptyRow(batchDate, defaultAcc?.id || '')]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredExpenses = useMemo(() => {
    const matched = allCombinedExpenses.filter((exp) => {
      if (selectedAccountFilter !== 'all' && exp.accountId !== selectedAccountFilter) {
        return false;
      }
      if (selectedCategoryFilter !== 'all' && exp.category !== selectedCategoryFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const accName =
          accounts.find((a) => a.id === exp.accountId)?.name.toLowerCase() || '';
        const match =
          (exp.recipient || '').toLowerCase().includes(q) ||
          (exp.category || '').toLowerCase().includes(q) ||
          (exp.subcategory || '').toLowerCase().includes(q) ||
          (exp.notes || '').toLowerCase().includes(q) ||
          (exp.description || '').toLowerCase().includes(q) ||
          accName.includes(q);
        if (!match) return false;
      }
      return true;
    });
    return sortRecordsByArrivalTime(matched);
  }, [allCombinedExpenses, selectedAccountFilter, selectedCategoryFilter, searchTerm, accounts]);

  const {
    totalExpensesAmount,
    totalDeductionExpensesAmount,
    totalVaultCausesAmount,
    expensesByCurrency,
    deductionExpensesByCurrency,
    vaultCausesByCurrency,
  } = useMemo(() => {
    let expSum = 0;
    let dedExpSum = 0;
    let vaultCausesSum = 0;
    const expMap = new Map<string, number>();
    const dedMap = new Map<string, number>();
    const vaultMap = new Map<string, number>();

    for (const e of filteredExpenses) {
      const { baseAmount, accountAmount, accountCurrency } =
        getExpenseNativeAndBaseAmount(e, settings, accounts, fxSnapshot);

      if (e.vaultAction !== 'credit') {
        expSum += baseAmount;
        addCurrencyBucketAmount(expMap, accountCurrency, accountAmount);
      }

      if (e.id.startsWith('exp_ded_')) {
        dedExpSum += baseAmount;
        addCurrencyBucketAmount(dedMap, accountCurrency, accountAmount);
      }

      if (e.accountId && vaultIdSet.has(e.accountId)) {
        const signedBase = e.vaultAction === 'credit' ? -baseAmount : baseAmount;
        const signedAcct =
          e.vaultAction === 'credit' ? -accountAmount : accountAmount;
        vaultCausesSum += signedBase;
        addCurrencyBucketAmount(vaultMap, accountCurrency, signedAcct);
      }
    }

    return {
      totalExpensesAmount: roundTo2Decimals(expSum),
      totalDeductionExpensesAmount: roundTo2Decimals(dedExpSum),
      totalVaultCausesAmount: roundTo2Decimals(vaultCausesSum),
      expensesByCurrency: mapToCurrencyBucketTotals(expMap, currency),
      deductionExpensesByCurrency: mapToCurrencyBucketTotals(dedMap, currency),
      vaultCausesByCurrency: mapToCurrencyBucketTotals(vaultMap, currency),
    };
  }, [filteredExpenses, vaultIdSet, settings, accounts, fxSnapshot, currency]);

  const distinctCategoriesInFilter = useMemo(() => {
    const set = new Set<string>();
    for (const pref of categoryPreferences) {
      if (pref.name) set.add(pref.name);
    }
    for (const exp of allCombinedExpenses) {
      if (exp.category) set.add(exp.category);
    }
    return Array.from(set);
  }, [categoryPreferences, allCombinedExpenses]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Expenses & Cause Credits
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('settings')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage Categories in Settings
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsFormCollapsed((prev) => !prev)}
            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            {isFormCollapsed ? '+ Record Expenses' : 'Collapse Form'}
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Total Expenses</div>
          <div className="mt-1 font-mono text-xl font-bold text-rose-600 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              totalExpensesAmount,
              expensesByCurrency,
              settings,
              { prefix: '-' }
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            totalExpensesAmount,
            expensesByCurrency,
            settings,
            { prefix: '-' }
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                totalExpensesAmount,
                expensesByCurrency,
                settings,
                { prefix: '-' }
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Income Deduction Expenses</div>
          <div className="mt-1 font-mono text-xl font-bold text-rose-600 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              totalDeductionExpensesAmount,
              deductionExpensesByCurrency,
              settings,
              { prefix: '-' }
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            totalDeductionExpensesAmount,
            deductionExpensesByCurrency,
            settings,
            { prefix: '-' }
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                totalDeductionExpensesAmount,
                deductionExpensesByCurrency,
                settings,
                { prefix: '-' }
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Net Savings Deployed to Causes</div>
          <div
            className={`mt-1 font-mono text-xl font-bold tabular-nums break-words ${
              totalVaultCausesAmount > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {formatTotalByCurrencyMode(
              Math.abs(totalVaultCausesAmount),
              vaultCausesByCurrency.map((b) => ({
                ...b,
                amount: Math.abs(b.amount),
              })),
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            Math.abs(totalVaultCausesAmount),
            vaultCausesByCurrency.map((b) => ({
              ...b,
              amount: Math.abs(b.amount),
            })),
            settings
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                Math.abs(totalVaultCausesAmount),
                vaultCausesByCurrency.map((b) => ({
                  ...b,
                  amount: Math.abs(b.amount),
                })),
                settings
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Expense Entries</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {filteredExpenses.length}
          </div>
        </div>
      </div>

      {/* Collapsible Multi-Expense Recording Instance (Collapsed by default) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div
          onClick={() => setIsFormCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isFormCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Record Expenses (Multi-Item Instance)
            </h2>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
              {rows.length} {rows.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFormCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isFormCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isFormCollapsed ? '' : 'rotate-180'
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

        {!isFormCollapsed && (
          <form onSubmit={handleSubmitBatch} className="space-y-4">
            {/* Instance Toolbar: Default Date & Quick Cause Chips */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-700">
                  Instance Date
                </label>
                <input
                  type="date"
                  value={batchDate}
                  onChange={(e) => handleApplyBatchDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs text-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 mr-1">Quick Cause:</span>
                {CAUSE_QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      const targetRow = rows[rows.length - 1];
                      if (targetRow) {
                        handleUpdateRow(targetRow.rowId, { recipient: preset });
                      }
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {categoryPreferences.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                <span>Configure expense categories and subcategories in Settings.</span>
                {onNavigateToTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('settings')}
                    className="rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 shrink-0"
                  >
                    Open Settings
                  </button>
                )}
              </div>
            )}

            {/* Multi-Expense Rows */}
            <div className="space-y-3">
              {rows.map((row, idx) => {
                const selectedCategoryObj = categoryPreferences.find(
                  (c) => c.name === row.category
                );
                const subcategories = selectedCategoryObj?.subcategories || [];
                const selectedAcc =
                  accounts.find((a) => a.id === row.accountId) || defaultAcc;
                const accCurr = getAccountCurrency(selectedAcc, currency);
                const rowCurr = (row.currency || accCurr).toUpperCase();
                const accNativeBal = getAccountNativeBalance(
                  accountBalanceMap.get(row.accountId) ?? 0,
                  selectedAcc,
                  currency,
                  fxSnapshot
                );
                const rawRowAmt = parseFloat(row.amount) || 0;
                const accConv = convertCurrency2dp(
                  rawRowAmt,
                  rowCurr,
                  accCurr,
                  fxSnapshot
                );
                const baseConv = convertCurrency2dp(
                  rawRowAmt,
                  rowCurr,
                  currency,
                  fxSnapshot
                );

                return (
                  <div
                    key={row.rowId}
                    className="rounded-xl border border-slate-200 p-3.5 space-y-3 bg-white"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-700">
                          Expense #{idx + 1}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          ({formatDateDDMMYYYY(row.date || batchDate)})
                        </span>
                        {(() => {
                          const learnedVault = learnSavingsVaultDebitAccount({
                            expenses,
                            accounts,
                            settings,
                            recipient: row.recipient,
                            category: row.category,
                            subcategory: row.subcategory,
                          });
                          if (
                            learnedVault &&
                            row.accountId === learnedVault.vaultAccountId
                          ) {
                            return (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                Auto Vault Debit: {learnedVault.vaultAccountName}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          Account Balance:{' '}
                          {formatAmount(accNativeBal.amount, accNativeBal.currency)}
                        </span>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.rowId)}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                      {/* 1. Date */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Date
                        </label>
                        <input
                          type="date"
                          required
                          value={row.date}
                          onChange={(e) =>
                            handleUpdateRow(row.rowId, { date: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:outline-none"
                        />
                      </div>

                      {/* 2. Deduct From Account (Operating or Savings Vault) */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Deduct From Account
                        </label>
                        <select
                          value={row.accountId}
                          onChange={(e) =>
                            handleUpdateRow(row.rowId, { accountId: e.target.value })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none"
                        >
                          <optgroup label="Operating Accounts">
                            {operatingAccounts.map((a) => {
                              const nat = getAccountNativeBalance(
                                accountBalanceMap.get(a.id) ?? 0,
                                a,
                                currency,
                                fxSnapshot
                              );
                              return (
                                <option key={a.id} value={a.id}>
                                  {a.name} ({formatAmount(nat.amount, nat.currency)})
                                </option>
                              );
                            })}
                          </optgroup>
                          {savingsAccounts.length > 0 && (
                            <optgroup label="Savings Vaults (Credit for Cause)">
                              {savingsAccounts.map((a) => {
                                const nat = getAccountNativeBalance(
                                  accountBalanceMap.get(a.id) ?? 0,
                                  a,
                                  currency,
                                  fxSnapshot
                                );
                                return (
                                  <option key={a.id} value={a.id}>
                                    {a.name} ({formatAmount(nat.amount, nat.currency)})
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      {/* 3. To (Recipient / Cause) */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          To / Cause
                        </label>
                        <input
                          type="text"
                          value={row.recipient}
                          onChange={(e) =>
                            handleUpdateRow(row.rowId, { recipient: e.target.value })
                          }
                          placeholder="e.g. Treasury Bond, Mutual Funds, Land"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                        />
                      </div>

                      {/* 4. Category */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Category
                        </label>
                        {categoryPreferences.length > 0 ? (
                          <select
                            value={row.category}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { category: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none"
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
                            value={row.category}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { category: e.target.value })
                            }
                            placeholder="Set in Settings or type..."
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                          />
                        )}
                      </div>

                      {/* 5. Subcategory */}
                      <div>
                        <label className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-600 mb-1">
                          <span>Subcategory</span>
                          {row.subcategory && (
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              title={`Subcategory color: ${row.subcategory}`}
                              style={{
                                backgroundColor: resolveIntuitiveSubcategoryColor(
                                  row.subcategory,
                                  row.category,
                                  settings,
                                  expenses
                                ),
                              }}
                            />
                          )}
                        </label>
                        {subcategories.length > 0 ? (
                          <select
                            value={row.subcategory}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { subcategory: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none"
                          >
                            <option value="">None</option>
                            {subcategories.map((sub) => (
                              <option key={sub} value={sub}>
                                {sub}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={row.subcategory}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { subcategory: e.target.value })
                            }
                            placeholder="Optional subcategory"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
                          />
                        )}
                      </div>

                      {/* 6. Currency & Amount */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Amount ({rowCurr})
                        </label>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={rowCurr}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { currency: e.target.value })
                            }
                            className="rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 font-mono text-[11px] font-semibold text-slate-800 focus:outline-none shrink-0"
                            aria-label="Expense currency"
                          >
                            {SUPPORTED_CURRENCIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            value={row.amount}
                            onChange={(e) =>
                              handleUpdateRow(row.rowId, { amount: e.target.value })
                            }
                            placeholder="0.00"
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-right text-slate-900 tabular-nums focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {rawRowAmt > 0 && (rowCurr !== accCurr || rowCurr !== currency) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
                        <span className="font-mono text-slate-600 tabular-nums">
                          Auto Rate: 1 {rowCurr} = {format2PointFloat(accConv.exchangeRate2dp)} {accCurr}
                        </span>
                        <span className="font-mono font-semibold text-rose-600 tabular-nums">
                          Deducts {formatAmount(accConv.convertedAmount, accCurr)} from {selectedAcc?.name || 'Account'}
                          {accCurr !== currency
                            ? ` (${formatAmount(baseConv.convertedAmount, currency)})`
                            : ''}
                        </span>
                      </div>
                    )}

                    {/* Real-Time Budget & Account Spend Check Alerts */}
                    {rawRowAmt > 0 &&
                      (() => {
                        const spendEval = checkSpendAgainstBudgetsAndAccount({
                          date: row.date || batchDate,
                          accountId: row.accountId,
                          category: row.category,
                          subcategory: row.subcategory,
                          amount: rawRowAmt,
                          currency: rowCurr,
                          budgets,
                          expenses,
                          incomes,
                          accounts,
                          transfers,
                          settings,
                          fxSnapshot,
                        });

                        return (
                          <div className="space-y-2">
                            {/* Account Balance Check Alert */}
                            {spendEval.accountCheck && (
                              <div
                                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 rounded-lg border px-3 py-2 text-xs ${
                                  spendEval.accountCheck.status === 'overdrawn'
                                    ? 'border-rose-300 bg-rose-50 text-rose-900'
                                    : spendEval.accountCheck.status ===
                                      'low_balance'
                                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                                    : 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                                }`}
                              >
                                <div className="font-medium">
                                  {spendEval.accountCheck.status ===
                                  'overdrawn' ? (
                                    <span className="font-bold text-rose-700">
                                      Account Alert: Spending exceeds{' '}
                                      {spendEval.accountCheck.account.name}{' '}
                                      balance!
                                    </span>
                                  ) : spendEval.accountCheck.status ===
                                    'low_balance' ? (
                                    <span className="font-bold text-amber-800">
                                      Account Warning: Uses ≥80% of{' '}
                                      {spendEval.accountCheck.account.name}{' '}
                                      balance.
                                    </span>
                                  ) : (
                                    <span className="font-semibold text-emerald-800">
                                      Account Check:{' '}
                                      {spendEval.accountCheck.account.name} has
                                      sufficient funds.
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-[11px] font-semibold tabular-nums">
                                  After Spend:{' '}
                                  <span
                                    className={
                                      spendEval.accountCheck.projectedBalance <
                                      0
                                        ? 'text-rose-600 font-bold'
                                        : 'text-emerald-700 font-bold'
                                    }
                                  >
                                    {formatAmount(
                                      spendEval.accountCheck.projectedBalance,
                                      spendEval.accountCheck.accountCurrency
                                    )}
                                  </span>
                                  {spendEval.accountCheck.custodianAccount &&
                                    spendEval.accountCheck
                                      .custodianProjectedBalance !==
                                      undefined && (
                                      <span className="ml-2 text-slate-600">
                                        (Main{' '}
                                        {
                                          spendEval.accountCheck
                                            .custodianAccount.name
                                        }
                                        :{' '}
                                        {formatAmount(
                                          spendEval.accountCheck
                                            .custodianProjectedBalance,
                                          spendEval.accountCheck
                                            .custodianCurrency || currency
                                        )}
                                        )
                                      </span>
                                    )}
                                </div>
                              </div>
                            )}

                            {/* Matching Subcategory Budget Checks */}
                            {spendEval.budgetChecks.map((bc) => {
                              const isOver = bc.projectedStatus === 'exceeded';
                              const isWarn =
                                bc.projectedStatus === 'warning' ||
                                bc.projectedStatus === 'at_limit';
                              const clampedPct = Math.min(
                                100,
                                Math.max(0, bc.projectedPercentage)
                              );
                              const residualPct = Math.max(
                                0,
                                roundTo2Decimals(100 - clampedPct)
                              );

                              return (
                                <div
                                  key={bc.budget.id}
                                  className={`rounded-lg border px-3 py-2 space-y-1.5 text-xs ${
                                    isOver
                                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                                      : isWarn
                                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                                      : 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
                                  }`}
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                    <div className="font-bold">
                                      {isOver
                                        ? `Budget Alert: Exceeds "${bc.budget.name}"`
                                        : isWarn
                                        ? `Budget Warning: Near limit for "${bc.budget.name}"`
                                        : `Budget Check: Within "${bc.budget.name}"`}{' '}
                                      <span className="font-normal text-[11px] opacity-80">
                                        ({bc.periodLabel})
                                      </span>
                                    </div>
                                    <div className="font-mono text-[11px] font-bold tabular-nums">
                                      {bc.percentageBefore}% →{' '}
                                      <span
                                        className={
                                          isOver
                                            ? 'text-rose-600'
                                            : isWarn
                                            ? 'text-amber-700'
                                            : 'text-emerald-700'
                                        }
                                      >
                                        {bc.projectedPercentage}% used
                                      </span>{' '}
                                      ·{' '}
                                      {bc.projectedResidual < 0 ? (
                                        <span className="text-rose-600">
                                          Over by{' '}
                                          {formatAmount(
                                            Math.abs(bc.projectedResidual),
                                            bc.budget.currency
                                          )}
                                        </span>
                                      ) : (
                                        <span className="text-emerald-700">
                                          Residual:{' '}
                                          {formatAmount(
                                            bc.projectedResidual,
                                            bc.budget.currency
                                          )}{' '}
                                          ({residualPct}%)
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Inline Progress + Residual Bar */}
                                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/80 border border-black/10 flex">
                                    <div
                                      style={{ width: `${clampedPct}%` }}
                                      className={`h-full transition-all ${
                                        isOver
                                          ? 'bg-rose-600'
                                          : isWarn
                                          ? 'bg-amber-500'
                                          : 'bg-emerald-600'
                                      }`}
                                    />
                                    {residualPct > 0 && (
                                      <div
                                        style={{ width: `${residualPct}%` }}
                                        className="h-full bg-emerald-100/70"
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                    {/* Row Notes */}
                    <div>
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) =>
                          handleUpdateRow(row.rowId, { notes: e.target.value })
                        }
                        placeholder="Notes (optional)"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Instance Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleAddRow}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                + Add Another Expense Row
              </button>

              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-slate-500">
                  Instance Total:{' '}
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatAmount(batchTotalAmount, currency)}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting || validDraftRows.length === 0}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {isSubmitting
                    ? 'Recording...'
                    : `Record ${validDraftRows.length} ${
                        validDraftRows.length === 1 ? 'Expense' : 'Expenses'
                      }`}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Filter & Presentation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search To, cause, category, notes..."
            className="w-full sm:w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />

          <select
            value={selectedAccountFilter}
            onChange={(e) => setSelectedAccountFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
          >
            <option value="all">All Accounts</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>

          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {distinctCategoriesInFilter.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Group Records By Period Selector */}
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
            {(
              [
                { id: 'none', label: 'All' },
                { id: 'week', label: 'Week' },
                { id: 'month', label: 'Month' },
                { id: 'year', label: 'Year' },
              ] as { id: RecordGroupPeriod; label: string }[]
            ).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupByPeriod(g.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  groupByPeriod === g.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setPresentationMode('cards')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                presentationMode === 'cards'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Timeline Cards
            </button>
            <button
              type="button"
              onClick={() => setPresentationMode('grouped')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                presentationMode === 'grouped'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Category
            </button>
          </div>
        </div>
      </div>

      {/* Expense Records Feed (Non-Table Card & Category Presentation) */}
      {filteredExpenses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-12 px-4 text-center text-xs text-slate-400">
          No expenses recorded yet.
        </div>
      ) : presentationMode === 'cards' ? (
        <div className="space-y-4">
          {groupRecordsByPeriod(filteredExpenses, groupByPeriod).map((periodGroup) => {
            const periodTotal = roundTo2Decimals(
              periodGroup.items.reduce(
                (sum, e) =>
                  sum + (e.vaultAction === 'credit' ? 0 : e.amount || 0),
                0
              )
            );
            return (
              <div key={periodGroup.key} className="space-y-2.5">
                {groupByPeriod !== 'none' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-100/80 px-3.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-xs font-bold text-slate-900">
                        {periodGroup.label}
                      </span>
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                        {periodGroup.items.length}{' '}
                        {periodGroup.items.length === 1 ? 'entry' : 'entries'}
                      </span>
                    </div>
                    <span className="font-mono text-xs font-bold text-rose-600 tabular-nums">
                      -{formatAmount(periodTotal, currency)}
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  {periodGroup.items.map((exp) => {
                    const acc =
                      accounts.find((a) => a.id === exp.accountId) || defaultAcc;
                    const subLabel =
                      exp.subcategory || exp.category || 'Expense';
                    const subColor = resolveIntuitiveSubcategoryColor(
                      exp.subcategory,
                      exp.category,
                      settings,
                      expenses
                    );
                    const expCurr = (
                      exp.currency || getAccountCurrency(acc, currency)
                    ).toUpperCase();
                    const expNativeAmt =
                      exp.originalAmount !== undefined && exp.originalAmount > 0
                        ? exp.originalAmount
                        : exp.amount;

                    return (
                      <RecordCard
                        key={exp.id}
                        subcategory={subLabel}
                        subcategoryColor={subColor}
                        accountName={acc?.name || 'Account'}
                        amountText={`-${formatAmount(expNativeAmt, expCurr)}`}
                        recordType="expense"
                        date={exp.date}
                        onClick={() => setSelectedPopupExpense(exp)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Grouped by Category & Subcategory Presentation */
        <div className="space-y-3">
          {(() => {
            const catGroups = new Map<
              string,
              {
                category: string;
                total: number;
                items: FlexibleExpense[];
                subMap: Map<string, number>;
              }
            >();

            for (const exp of filteredExpenses) {
              const cat = (exp.category || 'Uncategorized').trim();
              const sub = (exp.subcategory || 'General').trim();
              const existing = catGroups.get(cat) || {
                category: cat,
                total: 0,
                items: [],
                subMap: new Map<string, number>(),
              };
              existing.total += exp.amount || 0;
              existing.items.push(exp);
              existing.subMap.set(
                sub,
                (existing.subMap.get(sub) || 0) + (exp.amount || 0)
              );
              catGroups.set(cat, existing);
            }

            const sortedGroups = Array.from(catGroups.values()).sort(
              (a, b) => b.total - a.total
            );

            return sortedGroups.map((group) => {
              const isGroupOpen = expandedCategoryGroups.has(group.category);
              const sharePct =
                totalExpensesAmount > 0
                  ? Math.round((group.total / totalExpensesAmount) * 1000) / 10
                  : 0;

              const toggleGroup = () => {
                setExpandedCategoryGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.category)) {
                    next.delete(group.category);
                  } else {
                    next.add(group.category);
                  }
                  return next;
                });
              };

              return (
                <div
                  key={group.category}
                  className="rounded-xl border border-slate-200/90 bg-white overflow-hidden"
                >
                  <div
                    onClick={toggleGroup}
                    className="p-4 cursor-pointer select-none hover:bg-slate-50/70 transition-colors space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: 'var(--app-accent)' }}
                        />
                        <span className="font-display text-sm font-bold text-slate-900 break-words">
                          {group.category}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                          {sharePct}%
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="font-mono text-sm font-bold text-rose-600 tabular-nums">
                          -{formatAmount(group.total, currency)}
                        </span>
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {isGroupOpen ? 'Collapse' : 'Expand'}
                        </span>
                      </div>
                    </div>

                    {/* Subcategory chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(group.subMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([subName, subTotal]) => {
                          const subColor = resolveIntuitiveSubcategoryColor(
                            subName,
                            group.category,
                            settings,
                            expenses
                          );
                          const subBadge = getSubcategoryBadgeStyle(subColor);
                          return (
                            <span
                              key={subName}
                              style={{
                                backgroundColor: subBadge.backgroundColor,
                                borderColor: subBadge.borderColor,
                                color: subBadge.color,
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]"
                            >
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: subColor }}
                              />
                              <span className="font-semibold">{subName}</span>
                              <span className="font-mono text-[10px] font-semibold tabular-nums opacity-90">
                                {formatAmount(subTotal, currency)}
                              </span>
                            </span>
                          );
                        })}
                    </div>
                  </div>

                  {isGroupOpen && (
                    <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50/40">
                      {group.items.map((exp) => {
                        const acc =
                          accounts.find((a) => a.id === exp.accountId) ||
                          defaultAcc;
                        const subLabel =
                          exp.subcategory || exp.category || 'Expense';
                        const itemSubColor = resolveIntuitiveSubcategoryColor(
                          exp.subcategory,
                          exp.category,
                          settings,
                          expenses
                        );
                        const expCurr = (
                          exp.currency || getAccountCurrency(acc, currency)
                        ).toUpperCase();
                        const expNativeAmt =
                          exp.originalAmount !== undefined &&
                          exp.originalAmount > 0
                            ? exp.originalAmount
                            : exp.amount;

                        return (
                          <RecordCard
                            key={exp.id}
                            subcategory={subLabel}
                            subcategoryColor={itemSubColor}
                            accountName={acc?.name || 'Account'}
                            amountText={`-${formatAmount(expNativeAmt, expCurr)}`}
                            recordType="expense"
                            date={exp.date}
                            onClick={() => setSelectedPopupExpense(exp)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Expense Details Pop-Up Modal */}
      <ExpenseDetailPopupModal
        expense={selectedPopupExpense}
        accounts={accounts}
        settings={settings}
        expenses={expenses}
        currency={currency}
        fxSnapshot={fxSnapshot}
        categoryPreferences={categoryPreferences}
        onClose={() => setSelectedPopupExpense(null)}
        onEdit={onEditExpense}
        onDelete={(exp) => setPendingDeleteExpense(exp)}
        onMoveSubcategory={onMoveSubcategory}
      />

      <ConfirmDeleteModal
        isOpen={Boolean(pendingDeleteExpense)}
        title="Delete Expense?"
        message={
          pendingDeleteExpense
            ? `Delete expense of ${formatAmount(pendingDeleteExpense.amount, currency)} (${
                pendingDeleteExpense.subcategory || pendingDeleteExpense.category
              })?`
            : 'Delete this expense?'
        }
        confirmLabel="Yes, Delete"
        onCancel={() => setPendingDeleteExpense(null)}
        onConfirm={() => {
          if (pendingDeleteExpense) {
            onDeleteExpense(pendingDeleteExpense.id);
            setPendingDeleteExpense(null);
          }
        }}
      />
    </div>
  );
};
