import React, { useState, useEffect, useMemo } from 'react';
import {
  FinancialBudget,
  BudgetPeriodType,
  BudgetScopeType,
  FlexibleExpense,
  IncomeReceipt,
  FinancialAccount,
  AccountTransfer,
  UserSettings,
  ExpenseCategoryPreference,
} from '../types/finance.ts';
import {
  formatAmount,
  calculateAccountSummaries,
  getEffectiveExpenseCategoryPreferences,
  resolveIntuitiveSubcategoryColor,
  addCurrencyBucketAmount,
  mapToCurrencyBucketTotals,
  formatTotalByCurrencyMode,
  getSecondaryCurrencyModeCaption,
} from '../lib/calculations.ts';
import {
  evaluateAllBudgets,
  computeRecurringPeriodBounds,
  EvaluatedBudget,
} from '../lib/budgetCalculations.ts';
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

interface BudgetsViewProps {
  budgets: FinancialBudget[];
  expenses: FlexibleExpense[];
  incomes: IncomeReceipt[];
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  settings: UserSettings;
  currency: string;
  onSaveBudget: (
    budget: Omit<FinancialBudget, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & {
      id?: string;
      createdAt?: string;
    }
  ) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
  onNavigateToTab?: (tab: ActiveTab) => void;
}

export const BudgetsView: React.FC<BudgetsViewProps> = ({
  budgets,
  expenses,
  incomes,
  accounts,
  transfers,
  settings,
  currency,
  onSaveBudget,
  onDeleteBudget,
  onNavigateToTab,
}) => {
  const todayStr = new Date().toISOString().substring(0, 10);
  const endOfMonthStr = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.toISOString().substring(0, 10);
  }, []);

  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const categoryPreferences: ExpenseCategoryPreference[] = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings, expenses),
    [settings, expenses]
  );

  // Flatten all available subcategories with their parent category
  const availableSubcategories = useMemo(() => {
    const list: { subcategory: string; category: string }[] = [];
    const seen = new Set<string>();

    for (const pref of categoryPreferences) {
      for (const sub of pref.subcategories || []) {
        const clean = sub.trim();
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) {
          seen.add(key);
          list.push({ subcategory: clean, category: pref.name });
        }
      }
    }

    for (const exp of expenses) {
      const clean = (exp.subcategory || '').trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        list.push({
          subcategory: clean,
          category: exp.category || 'Uncategorized',
        });
      }
    }

    return list;
  }, [categoryPreferences, expenses]);

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FinancialBudget | null>(
    null
  );
  const [name, setName] = useState('');
  const [periodType, setPeriodType] = useState<BudgetPeriodType>('monthly');
  const [customStartDate, setCustomStartDate] = useState(todayStr);
  const [customEndDate, setCustomEndDate] = useState(endOfMonthStr);
  const [scopeType, setScopeType] = useState<BudgetScopeType>('single');
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>(
    () =>
      availableSubcategories[0]?.subcategory
        ? [availableSubcategories[0].subcategory]
        : []
  );
  const [customSubcategoryInput, setCustomSubcategoryInput] = useState('');
  const [accountId, setAccountId] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState(currency);
  const [amount, setAmount] = useState('');
  const [alertThresholdPercent, setAlertThresholdPercent] = useState('80');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter & UI State
  const [periodFilter, setPeriodFilter] = useState<
    'all' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'alerts'
  >('all');
  const [showArchivedCycles, setShowArchivedCycles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBudgetIds, setExpandedBudgetIds] = useState<Set<string>>(
    new Set()
  );
  const [pendingDeleteBudget, setPendingDeleteBudget] =
    useState<FinancialBudget | null>(null);

  const archivedBudgetsCount = useMemo(
    () => budgets.filter((b) => Boolean(b.isArchivedPeriod)).length,
    [budgets]
  );

  // Evaluate budgets
  const evaluatedBudgets: EvaluatedBudget[] = useMemo(
    () =>
      evaluateAllBudgets(
        budgets,
        expenses,
        incomes,
        accounts,
        settings,
        fxSnapshot,
        new Date(),
        showArchivedCycles
      ),
    [budgets, expenses, incomes, accounts, settings, fxSnapshot, showArchivedCycles]
  );

  // Account summaries to surface negative account alerts alongside budgets
  const { summaries: accountSummaries } = useMemo(
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

  const negativeAccounts = useMemo(
    () =>
      accountSummaries.filter((s) => {
        const nat =
          s.nativeCurrentCashBalance ??
          getAccountNativeBalance(
            s.currentCashBalance,
            s.account,
            currency,
            fxSnapshot
          ).amount;
        return nat < 0;
      }),
    [accountSummaries, currency, fxSnapshot]
  );

  const filteredEvaluatedBudgets = useMemo(() => {
    return evaluatedBudgets.filter((eb) => {
      if (periodFilter === 'weekly' && eb.budget.periodType !== 'weekly') {
        return false;
      }
      if (periodFilter === 'monthly' && eb.budget.periodType !== 'monthly') {
        return false;
      }
      if (periodFilter === 'yearly' && eb.budget.periodType !== 'yearly') {
        return false;
      }
      if (periodFilter === 'custom' && eb.budget.periodType !== 'custom') {
        return false;
      }
      if (
        periodFilter === 'alerts' &&
        eb.status !== 'exceeded' &&
        eb.status !== 'at_limit' &&
        eb.status !== 'warning'
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = eb.budget.name.toLowerCase().includes(q);
        const matchSub = eb.budget.subcategories.some((s) =>
          s.toLowerCase().includes(q)
        );
        const matchAcc = (eb.linkedAccount?.name || '')
          .toLowerCase()
          .includes(q);
        if (!matchName && !matchSub && !matchAcc) return false;
      }
      return true;
    });
  }, [evaluatedBudgets, periodFilter, searchQuery]);

  // Consolidated KPI Totals (supporting Base Currency vs. Account/Budget Original Currency mode)
  const {
    totalBudgetLimitBase,
    totalSpentBase,
    totalResidualBase,
    budgetLimitByCurrency,
    spentByCurrency,
    residualByCurrency,
    alertBudgetsCount,
    exceededBudgetsCount,
  } = useMemo(() => {
    let limitBase = 0;
    let spentBase = 0;
    const limitMap = new Map<string, number>();
    const spentMap = new Map<string, number>();
    const residualMap = new Map<string, number>();
    let alertsCount = 0;
    let exceededCount = 0;

    for (const eb of filteredEvaluatedBudgets) {
      const bCurr = (eb.budget.currency || currency).toUpperCase();
      limitBase += eb.budgetLimitBase;
      spentBase += eb.spentAmountBase;
      addCurrencyBucketAmount(limitMap, bCurr, eb.budgetLimit);
      addCurrencyBucketAmount(spentMap, bCurr, eb.spentAmount);
      addCurrencyBucketAmount(residualMap, bCurr, eb.residualAmount);

      if (
        eb.status === 'exceeded' ||
        eb.status === 'at_limit' ||
        eb.status === 'warning'
      ) {
        alertsCount += 1;
      }
      if (eb.status === 'exceeded') {
        exceededCount += 1;
      }
    }

    return {
      totalBudgetLimitBase: roundTo2Decimals(limitBase),
      totalSpentBase: roundTo2Decimals(spentBase),
      totalResidualBase: roundTo2Decimals(limitBase - spentBase),
      budgetLimitByCurrency: mapToCurrencyBucketTotals(limitMap, currency),
      spentByCurrency: mapToCurrencyBucketTotals(spentMap, currency),
      residualByCurrency: mapToCurrencyBucketTotals(residualMap, currency),
      alertBudgetsCount: alertsCount,
      exceededBudgetsCount: exceededCount,
    };
  }, [filteredEvaluatedBudgets, currency]);

  const resetForm = () => {
    setEditingBudget(null);
    setName('');
    setPeriodType('monthly');
    setCustomStartDate(todayStr);
    setCustomEndDate(endOfMonthStr);
    setScopeType('single');
    setSelectedSubcategories(
      availableSubcategories[0]?.subcategory
        ? [availableSubcategories[0].subcategory]
        : []
    );
    setCustomSubcategoryInput('');
    setAccountId('');
    setBudgetCurrency(currency);
    setAmount('');
    setAlertThresholdPercent('80');
    setNotes('');
    setFormError(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const handleOpenEdit = (budget: FinancialBudget) => {
    setEditingBudget(budget);
    setName(budget.name);
    setPeriodType(budget.periodType);
    setCustomStartDate(budget.customStartDate || todayStr);
    setCustomEndDate(budget.customEndDate || endOfMonthStr);
    setScopeType(budget.scopeType);
    setSelectedSubcategories(budget.subcategories || []);
    setCustomSubcategoryInput('');
    setAccountId(budget.accountId || '');
    setBudgetCurrency(budget.currency || currency);
    setAmount(String(budget.amount));
    setAlertThresholdPercent(String(budget.alertThresholdPercent ?? 80));
    setNotes(budget.notes || '');
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleToggleSubcategory = (sub: string) => {
    if (scopeType === 'single') {
      setSelectedSubcategories([sub]);
      return;
    }
    setSelectedSubcategories((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === sub.toLowerCase()
      );
      if (exists) {
        return prev.filter((item) => item.toLowerCase() !== sub.toLowerCase());
      }
      return [...prev, sub];
    });
  };

  const handleAddCustomSubcategory = () => {
    const clean = customSubcategoryInput.trim();
    if (!clean) return;
    if (scopeType === 'single') {
      setSelectedSubcategories([clean]);
    } else {
      setSelectedSubcategories((prev) =>
        prev.some((s) => s.toLowerCase() === clean.toLowerCase())
          ? prev
          : [...prev, clean]
      );
    }
    setCustomSubcategoryInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Enter a budget name.');
      return;
    }

    const numericAmount = roundTo2Decimals(parseFloat(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setFormError('Enter a valid budget limit greater than zero.');
      return;
    }

    const finalSubcategories =
      scopeType === 'single'
        ? selectedSubcategories.slice(0, 1)
        : selectedSubcategories;

    if (finalSubcategories.length === 0) {
      setFormError('Select at least one expense subcategory.');
      return;
    }

    if (periodType === 'custom' && (!customStartDate || !customEndDate)) {
      setFormError('Specify both start and end dates for a custom period.');
      return;
    }

    const parentCats = Array.from(
      new Set(
        finalSubcategories
          .map(
            (sub) =>
              availableSubcategories.find(
                (a) => a.subcategory.toLowerCase() === sub.toLowerCase()
              )?.category
          )
          .filter((c): c is string => Boolean(c))
      )
    );

    const recurringBounds =
      periodType !== 'custom'
        ? computeRecurringPeriodBounds(periodType)
        : null;

    setIsSubmitting(true);
    try {
      await onSaveBudget({
        id: editingBudget?.id,
        createdAt: editingBudget?.createdAt,
        name: cleanName,
        periodType,
        customStartDate: periodType === 'custom' ? customStartDate : undefined,
        customEndDate: periodType === 'custom' ? customEndDate : undefined,
        activePeriodStart: recurringBounds ? recurringBounds.startYmd : undefined,
        activePeriodEnd: recurringBounds ? recurringBounds.endYmd : undefined,
        parentRecurringBudgetId: editingBudget?.parentRecurringBudgetId,
        isArchivedPeriod: false,
        scopeType,
        subcategories: finalSubcategories,
        categories: parentCats.length > 0 ? parentCats : undefined,
        accountId: accountId || undefined,
        currency: (budgetCurrency || currency).toUpperCase(),
        amount: numericAmount,
        alertThresholdPercent: Math.min(
          100,
          Math.max(1, parseFloat(alertThresholdPercent) || 80)
        ),
        notes: notes.trim() || undefined,
      });
      setIsFormOpen(false);
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeBudgetsCount = useMemo(
    () => budgets.filter((b) => !b.isArchivedPeriod).length,
    [budgets]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border-b border-slate-200 pb-3.5">
        <div className="min-w-0">
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-slate-900">
            Budgets
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Weekly, monthly, yearly, and custom spending limits.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('flexible_expenses')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 text-center"
            >
              Record Expense
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (isFormOpen) {
                setIsFormOpen(false);
                resetForm();
              } else {
                handleOpenCreate();
              }
            }}
            className="rounded-lg bg-slate-900 px-3.5 py-2 sm:py-1.5 text-xs font-bold text-white hover:bg-slate-800 text-center"
          >
            {isFormOpen ? 'Close Form' : '+ New Budget'}
          </button>
        </div>
      </div>

      {/* KPI Summary Strip — 2x2 on Mobile, 4-Column on Desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 min-w-0">
          <div className="text-[11px] sm:text-xs text-slate-500 truncate">
            Total Budgeted
          </div>
          <div className="mt-1 font-mono text-sm sm:text-xl font-bold text-slate-900 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              totalBudgetLimitBase,
              budgetLimitByCurrency,
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            totalBudgetLimitBase,
            budgetLimitByCurrency,
            settings
          ) && (
            <div className="mt-0.5 font-mono text-[10px] sm:text-[11px] text-slate-400 tabular-nums truncate">
              {getSecondaryCurrencyModeCaption(
                totalBudgetLimitBase,
                budgetLimitByCurrency,
                settings
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 min-w-0">
          <div className="text-[11px] sm:text-xs text-slate-500 truncate">
            Spent in Period
          </div>
          <div className="mt-1 font-mono text-sm sm:text-xl font-bold text-rose-600 tabular-nums break-words">
            {formatTotalByCurrencyMode(totalSpentBase, spentByCurrency, settings, {
              prefix: '-',
            })}
          </div>
          <div className="mt-0.5 font-mono text-[10px] sm:text-[11px] text-slate-500 tabular-nums truncate">
            {totalBudgetLimitBase > 0
              ? `${roundTo2Decimals(
                  (totalSpentBase / totalBudgetLimitBase) * 100
                )}% used`
              : '0% used'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 min-w-0">
          <div className="text-[11px] sm:text-xs text-slate-500 truncate">
            Residual Available
          </div>
          <div
            className={`mt-1 font-mono text-sm sm:text-xl font-bold tabular-nums break-words ${
              totalResidualBase < 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {formatTotalByCurrencyMode(
              totalResidualBase,
              residualByCurrency,
              settings,
              {
                prefix: totalResidualBase > 0 ? '+' : '',
              }
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] sm:text-[11px] text-slate-500 tabular-nums truncate">
            {totalResidualBase < 0
              ? 'Over budget'
              : totalBudgetLimitBase > 0
              ? `${Math.max(
                  0,
                  roundTo2Decimals(
                    100 - (totalSpentBase / totalBudgetLimitBase) * 100
                  )
                )}% left`
              : 'No limits'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 min-w-0">
          <div className="text-[11px] sm:text-xs text-slate-500 truncate">
            Alerts
          </div>
          <div
            className={`mt-1 font-mono text-sm sm:text-xl font-bold tabular-nums ${
              exceededBudgetsCount > 0 || negativeAccounts.length > 0
                ? 'text-rose-600'
                : alertBudgetsCount > 0
                ? 'text-amber-600'
                : 'text-emerald-700'
            }`}
          >
            {alertBudgetsCount + negativeAccounts.length === 0
              ? 'Healthy'
              : `${alertBudgetsCount + negativeAccounts.length} Active`}
          </div>
          <div className="mt-0.5 text-[10px] sm:text-[11px] text-slate-500 truncate">
            {exceededBudgetsCount} over ·{' '}
            {Math.max(0, alertBudgetsCount - exceededBudgetsCount)} warn ·{' '}
            {negativeAccounts.length} neg acct
          </div>
        </div>
      </div>

      {/* Active Alerts Banner (Budgets Exceeded / Warning or Accounts in Negative) */}
      {(alertBudgetsCount > 0 || negativeAccounts.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 sm:p-4 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="text-xs font-bold text-slate-900">
              Active Spend & Account Alerts
            </div>
            {alertBudgetsCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setPeriodFilter((prev) =>
                    prev === 'alerts' ? 'all' : 'alerts'
                  )
                }
                className="self-start sm:self-auto rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-800 hover:bg-amber-100/50"
              >
                {periodFilter === 'alerts'
                  ? 'Show All Budgets'
                  : 'Filter Alert Budgets'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {evaluatedBudgets
              .filter(
                (eb) =>
                  eb.status === 'exceeded' ||
                  eb.status === 'at_limit' ||
                  eb.status === 'warning'
              )
              .map((eb) => (
                <div
                  key={`alert_${eb.budget.id}`}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                    eb.status === 'exceeded'
                      ? 'border-rose-200 bg-rose-50 text-rose-900'
                      : 'border-amber-200 bg-white text-amber-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{eb.budget.name}</div>
                    <div className="text-[11px] opacity-85 truncate">
                      {eb.periodWindow.periodBadge} ·{' '}
                      {eb.budget.subcategories.join(', ')}
                    </div>
                  </div>
                  <div className="text-right font-mono shrink-0 tabular-nums">
                    <div
                      className={`font-bold ${
                        eb.status === 'exceeded'
                          ? 'text-rose-600'
                          : 'text-amber-700'
                      }`}
                    >
                      {eb.usagePercentage}% used
                    </div>
                    <div className="text-[11px]">
                      {eb.residualAmount < 0
                        ? `Over by ${formatAmount(
                            Math.abs(eb.residualAmount),
                            eb.budget.currency
                          )}`
                        : `Residual: ${formatAmount(
                            eb.residualAmount,
                            eb.budget.currency
                          )}`}
                    </div>
                  </div>
                </div>
              ))}

            {negativeAccounts.map((accSum) => {
              const accCurr = getAccountCurrency(accSum.account, currency);
              const natBal =
                accSum.nativeCurrentCashBalance ??
                getAccountNativeBalance(
                  accSum.currentCashBalance,
                  accSum.account,
                  currency,
                  fxSnapshot
                ).amount;
              return (
                <div
                  key={`neg_acc_${accSum.account.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">
                      Account Negative: {accSum.account.name}
                    </div>
                    <div className="text-[11px] opacity-85 truncate">
                      Spending exceeded available account balance
                    </div>
                  </div>
                  <div className="font-mono font-bold text-rose-600 shrink-0 tabular-nums">
                    {formatAmount(natBal, accCurr)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create / Edit Budget Form */}
      {isFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-display text-sm font-bold text-slate-900 truncate">
              {editingBudget ? `Edit Budget: ${editingBudget.name}` : 'Create Budget'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                resetForm();
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0"
            >
              Cancel
            </button>
          </div>

          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* 1. Budget Name */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Budget Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Monthly Utilities, Annual Insurance"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* 2. Recurrence / Period Type (Weekly, Monthly, Yearly, Custom) */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Period Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                {(
                  [
                    { id: 'weekly', label: 'Weekly' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'yearly', label: 'Yearly' },
                    { id: 'custom', label: 'Custom' },
                  ] as { id: BudgetPeriodType; label: string }[]
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPeriodType(item.id)}
                    className={`rounded-md py-1.5 px-1.5 text-xs font-bold transition-colors ${
                      periodType === item.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {periodType !== 'custom' && (
                <div className="mt-1 text-[10px] text-slate-500">
                  Auto-recreates each {periodType} period.
                </div>
              )}
            </div>

            {/* 3. Budget Limit & Currency */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Budget Amount ({budgetCurrency})
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={budgetCurrency}
                  onChange={(e) => setBudgetCurrency(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 font-mono text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none shrink-0"
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
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>
              {budgetCurrency !== currency && parseFloat(amount) > 0 && (
                <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                  ≈{' '}
                  {formatAmount(
                    convertCurrency2dp(
                      parseFloat(amount) || 0,
                      budgetCurrency,
                      currency,
                      fxSnapshot
                    ).convertedAmount,
                    currency
                  )}{' '}
                  (Rate:{' '}
                  {format2PointFloat(
                    convertCurrency2dp(
                      1,
                      budgetCurrency,
                      currency,
                      fxSnapshot
                    ).exchangeRate2dp
                  )}
                  )
                </div>
              )}
            </div>

            {/* 4. Optional Account Scope & Alert Threshold */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account to Check
                </label>
                <select
                  value={accountId}
                  onChange={(e) => {
                    const nextAccId = e.target.value;
                    setAccountId(nextAccId);
                    if (nextAccId) {
                      const matchedAcc = accounts.find(
                        (a) => a.id === nextAccId
                      );
                      if (matchedAcc) {
                        setBudgetCurrency(
                          getAccountCurrency(matchedAcc, currency)
                        );
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">All Accounts</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({getAccountCurrency(acc, currency)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alert %
                </label>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={alertThresholdPercent}
                  onChange={(e) => setAlertThresholdPercent(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Custom Date Range Picker (when periodType === 'custom') */}
          {periodType === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  required
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Subcategory Scope Selector (Single vs. Multiple) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-xs font-bold text-slate-900">
                Subcategories
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setScopeType('single');
                    if (selectedSubcategories.length > 1) {
                      setSelectedSubcategories([selectedSubcategories[0]]);
                    }
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                    scopeType === 'single'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setScopeType('multiple')}
                  className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                    scopeType === 'multiple'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Multiple
                </button>
              </div>
            </div>

            {scopeType === 'single' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Select Subcategory
                  </label>
                  <select
                    value={selectedSubcategories[0] || ''}
                    onChange={(e) =>
                      setSelectedSubcategories(
                        e.target.value ? [e.target.value] : []
                      )
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">Select subcategory...</option>
                    {categoryPreferences.map((pref) => (
                      <optgroup key={pref.id} label={pref.name}>
                        {(pref.subcategories || []).map((sub) => (
                          <option key={`${pref.id}_${sub}`} value={sub}>
                            {sub} ({pref.name})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Or Enter Custom Subcategory
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customSubcategoryInput}
                      onChange={(e) =>
                        setCustomSubcategoryInput(e.target.value)
                      }
                      placeholder="e.g. Fuel, Internet"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomSubcategory}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 shrink-0"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {availableSubcategories.map(({ subcategory, category }) => {
                    const isSelected = selectedSubcategories.some(
                      (s) => s.toLowerCase() === subcategory.toLowerCase()
                    );
                    const dotColor = resolveIntuitiveSubcategoryColor(
                      subcategory,
                      category,
                      settings,
                      expenses
                    );
                    return (
                      <button
                        key={`${category}_${subcategory}`}
                        type="button"
                        onClick={() => handleToggleSubcategory(subcategory)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                          isSelected
                            ? 'border-slate-900 bg-slate-900 text-white font-bold shadow-2xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 font-medium'
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span>{subcategory}</span>
                        <span
                          className={`text-[10px] ${
                            isSelected ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          ({category})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Add custom subcategory to multiple selection */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
                  <div className="text-[11px] font-medium text-slate-600">
                    Selected ({selectedSubcategories.length}):{' '}
                    <span className="font-bold text-slate-900">
                      {selectedSubcategories.join(', ') || 'None'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customSubcategoryInput}
                      onChange={(e) =>
                        setCustomSubcategoryInput(e.target.value)
                      }
                      placeholder="Add custom subcategory..."
                      className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomSubcategory}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-100 shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note..."
              className="w-full sm:max-w-md rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
            />
            <div className="grid grid-cols-2 sm:flex sm:items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  resetForm();
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingBudget
                  ? 'Update Budget'
                  : 'Save Budget'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Search Bar — Mobile-Fitted 3-Column Grid on Small Screens */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap sm:items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'weekly', label: 'Weekly' },
              { id: 'monthly', label: 'Monthly' },
              { id: 'yearly', label: 'Yearly' },
              { id: 'custom', label: 'Custom' },
              { id: 'alerts', label: 'Alerts' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriodFilter(tab.id)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors text-center ${
                periodFilter === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {archivedBudgetsCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchivedCycles((prev) => !prev)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold shrink-0 transition-colors ${
                showArchivedCycles
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {showArchivedCycles
                ? 'Hide Past Cycles'
                : `Past Cycles (${archivedBudgetsCount})`}
            </button>
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search budget or subcategory..."
            className="w-full sm:w-60 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Budget Cards Grid */}
      {filteredEvaluatedBudgets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 text-center space-y-3">
          <div className="font-display text-sm font-bold text-slate-900">
            {activeBudgetsCount === 0
              ? 'No Budgets Defined Yet'
              : 'No Budgets Match Your Filter'}
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Create weekly, monthly, yearly, or custom-period budgets to track progress, residual balances, and spending alerts.
          </p>
          {activeBudgetsCount === 0 && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              + Create First Budget
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-4">
          {filteredEvaluatedBudgets.map((eb) => {
            const { budget, periodWindow } = eb;
            const isExpanded = expandedBudgetIds.has(budget.id);
            const isOver = eb.status === 'exceeded';
            const isWarn =
              eb.status === 'warning' || eb.status === 'at_limit';

            return (
              <div
                key={budget.id}
                className={`rounded-xl border bg-white p-3.5 sm:p-5 space-y-3.5 transition-colors ${
                  isOver
                    ? 'border-rose-300'
                    : isWarn
                    ? 'border-amber-300'
                    : 'border-slate-200'
                }`}
              >
                {/* Card Top Header — Clean & Mobile Fitted (No Single/Multiple Description) */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 break-words">
                        {budget.name}
                      </h3>
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          isOver
                            ? 'bg-rose-100 text-rose-700'
                            : isWarn
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isOver
                          ? `Exceeded (${eb.usagePercentage}%)`
                          : eb.status === 'at_limit'
                          ? 'At Limit (100%)'
                          : isWarn
                          ? `Warning (${eb.usagePercentage}%)`
                          : `Healthy (${eb.usagePercentage}%)`}
                      </span>
                      {budget.isArchivedPeriod && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                          Past Cycle
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {periodWindow.periodBadge}
                      </span>
                      <span>·</span>
                      <span className="font-mono">{periodWindow.label}</span>
                      {eb.linkedAccount && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-slate-700">
                            {eb.linkedAccount.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-start shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(budget)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteBudget(budget)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* 3-Column Metrics: Budget Limit, Spent (%), Residual Available (%) */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 sm:p-3">
                  <div className="min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                      Limit
                    </div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums break-words">
                      {formatAmount(eb.budgetLimit, budget.currency)}
                    </div>
                    {budget.currency !== currency && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums truncate">
                        ≈ {formatAmount(eb.budgetLimitBase, currency)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                      Spent ({eb.usagePercentage}%)
                    </div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-rose-600 tabular-nums break-words">
                      -{formatAmount(eb.spentAmount, budget.currency)}
                    </div>
                    {budget.currency !== currency && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums truncate">
                        ≈ -{formatAmount(eb.spentAmountBase, currency)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                      {eb.residualAmount < 0
                        ? `Over (+${eb.overagePercent}%)`
                        : `Residual (${eb.residualPercent}%)`}
                    </div>
                    <div
                      className={`mt-0.5 font-mono text-xs sm:text-sm font-bold tabular-nums break-words ${
                        eb.residualAmount < 0
                          ? 'text-rose-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {eb.residualAmount < 0
                        ? `-${formatAmount(
                            Math.abs(eb.residualAmount),
                            budget.currency
                          )}`
                        : `+${formatAmount(eb.residualAmount, budget.currency)}`}
                    </div>
                    {budget.currency !== currency && (
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums truncate">
                        ≈{' '}
                        {formatAmount(
                          Math.abs(eb.residualAmountBase),
                          currency
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress & Residual Visual Bar */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                    <span className="font-semibold text-slate-700">
                      Progress:{' '}
                      <span
                        className={`font-mono font-bold ${
                          isOver
                            ? 'text-rose-600'
                            : isWarn
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {eb.usagePercentage}%
                      </span>
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        eb.residualAmount < 0
                          ? 'text-rose-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {eb.residualAmount < 0
                        ? `Over by ${formatAmount(
                            eb.overageAmount,
                            budget.currency
                          )}`
                        : `Residual: ${eb.residualPercent}% (${formatAmount(
                            eb.residualAmount,
                            budget.currency
                          )})`}
                    </span>
                  </div>

                  {/* Multi-Segment Subcategory Spend + Residual Runway Bar */}
                  <div className="relative h-3.5 sm:h-4 w-full overflow-hidden rounded-lg border border-slate-200 bg-emerald-50/70 flex">
                    {eb.subcategoryBreakdowns.map((subItem) => {
                      const widthPct =
                        eb.budgetLimit > 0
                          ? Math.min(
                              100,
                              Math.max(
                                0,
                                (subItem.spentAmount / eb.budgetLimit) * 100
                              )
                            )
                          : 0;
                      if (widthPct <= 0) return null;
                      return (
                        <div
                          key={subItem.subcategory}
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: isOver
                              ? '#e11d48'
                              : subItem.color,
                          }}
                          className="h-full transition-all border-r border-white/40 last:border-r-0"
                          title={`${subItem.subcategory}: ${formatAmount(
                            subItem.spentAmount,
                            budget.currency
                          )} (${subItem.shareOfBudgetPercent}%)`}
                        />
                      );
                    })}

                    {/* Residual Visual Segment */}
                    {eb.residualPercent > 0 && (
                      <div
                        style={{ width: `${eb.residualPercent}%` }}
                        className="h-full flex items-center justify-end pr-1.5 bg-emerald-100/60 text-[9px] font-mono font-bold text-emerald-800 overflow-hidden whitespace-nowrap"
                        title={`Residual Available: ${formatAmount(
                          eb.residualAmount,
                          budget.currency
                        )} (${eb.residualPercent}%)`}
                      >
                        {eb.residualPercent >= 20
                          ? `${eb.residualPercent}% left`
                          : ''}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer: Toggle View Expenses (Includes Subcategory Breakdown + Recorded Expenses) */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <span className="text-[11px] text-slate-500">
                    {eb.matchedExpenses.length}{' '}
                    {eb.matchedExpenses.length === 1
                      ? 'expense recorded'
                      : 'expenses recorded'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedBudgetIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(budget.id)) next.delete(budget.id);
                        else next.add(budget.id);
                        return next;
                      })
                    }
                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
                  >
                    {isExpanded ? 'Hide Expenses' : 'View Expenses'}
                  </button>
                </div>

                {/* Expanded View Expenses Panel: Subcategory Breakdown + Matching Expense Records */}
                {isExpanded && (
                  <div className="space-y-3 pt-2.5 border-t border-slate-100">
                    {/* 1. Subcategory Breakdown */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-700">
                        Subcategory Breakdown
                      </div>
                      <div className="space-y-1.5">
                        {eb.subcategoryBreakdowns.map((subItem) => {
                          const subWidth = Math.min(
                            100,
                            Math.max(0, subItem.shareOfBudgetPercent)
                          );
                          return (
                            <div
                              key={subItem.subcategory}
                              className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: subItem.color }}
                                  />
                                  <span className="font-semibold text-slate-800 truncate">
                                    {subItem.subcategory}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-400 shrink-0">
                                    ({subItem.transactionCount})
                                  </span>
                                </div>
                                <div className="font-mono text-xs font-semibold text-slate-900 shrink-0 tabular-nums">
                                  {formatAmount(
                                    subItem.spentAmount,
                                    budget.currency
                                  )}{' '}
                                  <span className="text-[10px] text-slate-500">
                                    ({subItem.shareOfBudgetPercent}%)
                                  </span>
                                </div>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${subWidth}%`,
                                    backgroundColor: subItem.color,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 2. Matching Expense Records */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-700">
                        Recorded Expenses ({eb.matchedExpenses.length})
                      </div>
                      {eb.matchedExpenses.length === 0 ? (
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          No expenses recorded in this period yet.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {eb.matchedExpenses.map((exp) => (
                            <div
                              key={exp.id}
                              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-800 truncate">
                                  {exp.recipient || exp.subcategory || exp.category}
                                </div>
                                <div className="font-mono text-[10px] text-slate-500 truncate">
                                  {exp.date} · {exp.subcategory || exp.category}
                                </div>
                              </div>
                              <div className="font-mono font-semibold text-rose-600 shrink-0 tabular-nums">
                                -
                                {formatAmount(
                                  exp.originalAmount ?? exp.amount,
                                  exp.currency || currency
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={Boolean(pendingDeleteBudget)}
        title="Delete Budget"
        message={
          pendingDeleteBudget
            ? `Delete budget "${pendingDeleteBudget.name}"? Existing expense records will not be affected.`
            : ''
        }
        onCancel={() => setPendingDeleteBudget(null)}
        onConfirm={async () => {
          if (!pendingDeleteBudget) return;
          const id = pendingDeleteBudget.id;
          setPendingDeleteBudget(null);
          await onDeleteBudget(id);
        }}
      />
    </div>
  );
};
