import React, { useState, useMemo } from 'react';
import {
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  UserSettings,
} from '../types/finance.ts';
import {
  calculateAccountSummaries,
  formatAmount,
  formatPercent,
  getEffectiveIncomeDeductions,
  isSavingsDeduction,
  getIncomeDeductionExpenses,
  isSavingsVaultAccount,
  getVaultCleanName,
  getEffectiveNetTransferAccountId,
  resolveValidAccountId,
  getIncomeBaseGross,
  getExpenseNativeAndBaseAmount,
  addCurrencyBucketAmount,
  mapToCurrencyBucketTotals,
  formatTotalByCurrencyMode,
  getSecondaryCurrencyModeCaption,
  formatAccountCardBalanceByMode,
} from '../lib/calculations.ts';
import {
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  convertCurrency2dp,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { getColorThemeConfig } from '../lib/colorThemes.ts';
import {
  TimeRangePreset,
  getPresetLabel,
  formatDateTimeDDMMYYYY,
  sortRecordsByArrivalTime,
  groupRecordsByPeriod,
  RecordGroupPeriod,
} from '../lib/dateFilters.ts';
import { ActiveTab } from './Navigation.tsx';

interface DashboardViewProps {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  settings: UserSettings;
  currency: string;
  timeRange?: TimeRangePreset;
  onSelectTimeRange?: (range: TimeRangePreset) => void;
  onNavigateToTab: (tab: ActiveTab) => void;
  onEditExpense?: (expense: FlexibleExpense) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  incomes,
  expenses,
  accounts,
  transfers,
  settings,
  currency,
  timeRange = 'all',
  onNavigateToTab,
  onEditExpense,
}) => {
  // Collapse all expandable sections by default
  const [isRecentIncomesCollapsed, setIsRecentIncomesCollapsed] = useState(true);
  const [isRecentExpensesCollapsed, setIsRecentExpensesCollapsed] = useState(true);
  const [isAccountsCollapsed, setIsAccountsCollapsed] = useState(true);
  const [recordGroupBy, setRecordGroupBy] = useState<RecordGroupPeriod>('none');
  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  React.useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const colorConfig = useMemo(
    () => getColorThemeConfig(settings.colorTheme),
    [settings.colorTheme]
  );

  const { summaries, totalCashAcrossAllAccounts, cashByCurrency } = useMemo(
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

  const defaultAccount =
    accounts.find((a) => a.isDefaultDeposit) || accounts[0];

  const incomeMetrics = useMemo(() => {
    let totalGross = 0;
    let totalDeductions = 0;
    let totalSavings = 0;
    let totalDeductionItemsCount = 0;

    const grossByCurrMap = new Map<string, number>();
    const savingsByCurrMap = new Map<string, number>();
    const expensesByCurrMap = new Map<string, number>();

    for (const inc of incomes) {
      const { baseGross, nativeGross, currency: incCurr } = getIncomeBaseGross(
        inc,
        settings,
        accounts,
        fxSnapshot
      );
      totalGross += baseGross;
      addCurrencyBucketAmount(grossByCurrMap, incCurr, nativeGross);

      const deds = getEffectiveIncomeDeductions(inc, settings);
      totalDeductionItemsCount += deds.length;
      for (const d of deds) {
        const nativeDedAmt = Number(d.amount) || 0;
        const baseDedAmt =
          incCurr === currency
            ? nativeDedAmt
            : convertCurrency2dp(nativeDedAmt, incCurr, currency, fxSnapshot)
                .convertedAmount;
        totalDeductions += baseDedAmt;
        if (isSavingsDeduction(d)) {
          totalSavings += baseDedAmt;
          addCurrencyBucketAmount(savingsByCurrMap, incCurr, nativeDedAmt);
        } else {
          addCurrencyBucketAmount(expensesByCurrMap, incCurr, nativeDedAmt);
        }
      }
    }

    const deductionExpenses = getIncomeDeductionExpenses(
      incomes,
      settings,
      accounts,
      expenses
    );
    const manualExpensesOnly = expenses.filter(
      (e) => e.vaultAction !== 'credit'
    );
    let manualExpensesTotal = 0;
    for (const e of manualExpensesOnly) {
      const { baseAmount, accountAmount, accountCurrency } =
        getExpenseNativeAndBaseAmount(e, settings, accounts, fxSnapshot);
      manualExpensesTotal += baseAmount;
      addCurrencyBucketAmount(expensesByCurrMap, accountCurrency, accountAmount);
    }
    const deductionExpensesTotal = Math.max(
      0,
      Math.round((totalDeductions - totalSavings) * 100) / 100
    );
    const totalAllExpenses =
      Math.round((manualExpensesTotal + deductionExpensesTotal) * 100) / 100;

    totalGross = Math.round(totalGross * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    totalSavings = Math.round(totalSavings * 100) / 100;
    const otherDeductions = Math.max(
      0,
      Math.round((totalDeductions - totalSavings) * 100) / 100
    );
    const netRetained = Math.round((totalGross - totalDeductions) * 100) / 100;
    const deductionRate = totalGross > 0 ? (totalDeductions / totalGross) * 100 : 0;
    const netRate =
      totalGross > 0 ? Math.max(0, (netRetained / totalGross) * 100) : 0;
    const savingsRate =
      totalGross > 0 ? Math.max(0, (totalSavings / totalGross) * 100) : 0;
    const otherRate =
      totalGross > 0 ? Math.max(0, (otherDeductions / totalGross) * 100) : 0;

    return {
      totalGross,
      totalDeductions,
      totalSavings,
      otherDeductions,
      totalAllExpenses,
      totalExpensesCount: manualExpensesOnly.length + deductionExpenses.length,
      netRetained,
      deductionRate,
      netRate,
      savingsRate,
      otherRate,
      totalDeductionItemsCount,
      grossByCurrency: mapToCurrencyBucketTotals(grossByCurrMap, currency),
      savingsByCurrency: mapToCurrencyBucketTotals(savingsByCurrMap, currency),
      expensesByCurrency: mapToCurrencyBucketTotals(expensesByCurrMap, currency),
    };
  }, [incomes, expenses, settings, accounts, currency, fxSnapshot]);

  const recentIncomes = useMemo(
    () => sortRecordsByArrivalTime(incomes).slice(0, 12),
    [incomes]
  );

  const recentExpenses = useMemo(() => {
    const dedExps = getIncomeDeductionExpenses(
      incomes,
      settings,
      accounts,
      expenses
    );
    const standalone = expenses.filter(
      (e) => !e.id.startsWith('exp_cut_') && !e.id.startsWith('exp_ded_')
    );
    return sortRecordsByArrivalTime([...standalone, ...dedExps]).slice(0, 12);
  }, [expenses, incomes, settings, accounts]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 break-words">
            Overview
          </h1>
          <span className="text-xs font-medium text-slate-500">
            · {getPresetLabel(timeRange)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigateToTab('analytics')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Analytics
          </button>
          <button
            type="button"
            onClick={() => onNavigateToTab('accounts')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            + Account
          </button>
          <button
            type="button"
            onClick={() => onNavigateToTab('income_log')}
            className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            + Record Income
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Balance
          </div>
          <div
            className={`mt-1.5 font-mono text-xl font-semibold tabular-nums break-words ${
              totalCashAcrossAllAccounts < 0 ? 'text-rose-600' : 'text-emerald-700'
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
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                totalCashAcrossAllAccounts,
                cashByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400">
            {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Income
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-emerald-700 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              incomeMetrics.totalGross,
              incomeMetrics.grossByCurrency,
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            incomeMetrics.totalGross,
            incomeMetrics.grossByCurrency,
            settings
          ) && (
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                incomeMetrics.totalGross,
                incomeMetrics.grossByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400">
            {incomes.length} {incomes.length === 1 ? 'record' : 'records'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Expenses
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-rose-600 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              incomeMetrics.totalAllExpenses,
              incomeMetrics.expensesByCurrency,
              settings,
              { prefix: '-' }
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            incomeMetrics.totalAllExpenses,
            incomeMetrics.expensesByCurrency,
            settings,
            { prefix: '-' }
          ) && (
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                incomeMetrics.totalAllExpenses,
                incomeMetrics.expensesByCurrency,
                settings,
                { prefix: '-' }
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400">
            {incomeMetrics.totalExpensesCount} expense items
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Savings Accumulated
          </div>
          <div
            className="mt-1.5 font-mono text-xl font-semibold tabular-nums break-words"
            style={{ color: colorConfig.primary }}
          >
            {formatTotalByCurrencyMode(
              incomeMetrics.totalSavings,
              incomeMetrics.savingsByCurrency,
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            incomeMetrics.totalSavings,
            incomeMetrics.savingsByCurrency,
            settings
          ) && (
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                incomeMetrics.totalSavings,
                incomeMetrics.savingsByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400">
            {formatPercent(incomeMetrics.savingsRate)} of gross
          </div>
        </div>
      </div>

      {/* Visual Allocation Bar Conforming to Active App Color */}
      {incomeMetrics.totalGross > 0 && (
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-display font-semibold text-slate-900">
              Allocation Flow
            </span>
            <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] tabular-nums">
              <span className="flex items-center gap-1.5 text-slate-700">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorConfig.primary }}
                />
                Net {formatPercent(incomeMetrics.netRate)}
              </span>
              <span className="flex items-center gap-1.5 text-slate-700">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorConfig.chartSecondary }}
                />
                Savings Accumulated {formatPercent(incomeMetrics.savingsRate)}
              </span>
              <span className="flex items-center gap-1.5 text-slate-700">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorConfig.chartTertiary }}
                />
                Deduction Expenses {formatPercent(incomeMetrics.otherRate)}
              </span>
            </div>
          </div>

          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full transition-all"
              style={{
                width: `${incomeMetrics.netRate}%`,
                backgroundColor: colorConfig.primary,
              }}
            />
            <div
              className="h-full transition-all"
              style={{
                width: `${incomeMetrics.savingsRate}%`,
                backgroundColor: colorConfig.chartSecondary,
              }}
            />
            <div
              className="h-full transition-all"
              style={{
                width: `${incomeMetrics.otherRate}%`,
                backgroundColor: colorConfig.chartTertiary,
              }}
            />
          </div>
        </div>
      )}

      {/* Two-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: Collapsible Recent Income & Recent Expenses Records */}
        <div className="lg:col-span-7 space-y-4 min-w-0">
          {/* Group By Bar for Overview Records */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-700">
              Group Recent Records By
            </span>
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
                  onClick={() => setRecordGroupBy(g.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    recordGroupBy === g.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 min-w-0">
            <div
              onClick={() => setIsRecentIncomesCollapsed((prev) => !prev)}
              className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
                isRecentIncomesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Recent Income ({recentIncomes.length})
              </h2>
              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onNavigateToTab('income_log')}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
                >
                  View All
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecentIncomesCollapsed((prev) => !prev)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <span>{isRecentIncomesCollapsed ? 'Expand' : 'Collapse'}</span>
                  <svg
                    className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                      isRecentIncomesCollapsed ? '' : 'rotate-180'
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
            </div>

            {!isRecentIncomesCollapsed && (
              <>
                {recentIncomes.length === 0 ? (
                  <div className="py-8 text-center space-y-2.5">
                    <p className="text-xs font-medium text-slate-600">
                      No income records in selected range
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigateToTab('income_log')}
                      className="inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      + Record Income
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupRecordsByPeriod(recentIncomes, recordGroupBy).map((group) => (
                      <div key={group.key} className="space-y-2">
                        {recordGroupBy !== 'none' && (
                          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700">
                            {group.label} ({group.items.length})
                          </div>
                        )}
                        <div className="divide-y divide-slate-100">
                          {group.items.map((inc) => {
                            const resolvedAccId = resolveValidAccountId(
                              inc.accountId,
                              accounts,
                              settings
                            );
                            const acc =
                              accounts.find((a) => a.id === resolvedAccId) || defaultAccount;
                            const netDestId = getEffectiveNetTransferAccountId(
                              inc,
                              settings,
                              accounts
                            );
                            const netDestAcc = netDestId
                              ? accounts.find((a) => a.id === netDestId)
                              : undefined;
                            const {
                              baseGross,
                              nativeGross,
                              currency: incCurr,
                            } = getIncomeBaseGross(inc, settings, accounts, fxSnapshot);
                            const deds = getEffectiveIncomeDeductions(inc, settings);
                            const nativeDedTotal =
                              Math.round(
                                deds.reduce((sum, d) => sum + d.amount, 0) * 100
                              ) / 100;
                            const nativeNetAmt =
                              Math.round((nativeGross - nativeDedTotal) * 100) / 100;

                            const showInOriginal =
                              settings.totalsCurrencyMode === 'original';
                            const dispCurr = showInOriginal ? incCurr : currency;
                            const dispGross = showInOriginal ? nativeGross : baseGross;
                            const dispDed = showInOriginal
                              ? nativeDedTotal
                              : convertCurrency2dp(
                                  nativeDedTotal,
                                  incCurr,
                                  currency,
                                  fxSnapshot
                                ).convertedAmount;
                            const dispNet = showInOriginal
                              ? nativeNetAmt
                              : convertCurrency2dp(
                                  nativeNetAmt,
                                  incCurr,
                                  currency,
                                  fxSnapshot
                                ).convertedAmount;

                            return (
                              <div key={inc.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-display text-sm font-semibold text-slate-900 break-words">
                                      {inc.clientOrSource}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                      <span className="font-mono tabular-nums">
                                        {formatDateTimeDDMMYYYY(inc.date, inc.createdAt)}
                                      </span>
                                      {inc.notes && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="break-words">{inc.notes}</span>
                                        </>
                                      )}
                                      <span aria-hidden="true">·</span>
                                      <span className="font-medium text-slate-700 break-words">
                                        {netDestAcc
                                          ? `${acc?.name || 'Account'} → Net to ${netDestAcc.name}`
                                          : acc?.name || 'Account'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="text-right font-mono shrink-0 tabular-nums">
                                    <div className="text-sm font-semibold text-slate-900">
                                      {formatAmount(dispGross, dispCurr)}
                                    </div>
                                    {incCurr !== currency && (
                                      <div className="text-[11px] text-slate-400">
                                        {showInOriginal
                                          ? `≈ ${formatAmount(baseGross, currency)}`
                                          : formatAmount(nativeGross, incCurr)}
                                      </div>
                                    )}
                                    {dispDed > 0 && (
                                      <div className="text-xs text-rose-600">
                                        -{formatAmount(dispDed, dispCurr)}
                                      </div>
                                    )}
                                    <div
                                      className="text-xs font-medium"
                                      style={{ color: colorConfig.primary }}
                                    >
                                      Net: {formatAmount(dispNet, dispCurr)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Collapsible Recent Expenses with Edit Action */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 min-w-0">
            <div
              onClick={() => setIsRecentExpensesCollapsed((prev) => !prev)}
              className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
                isRecentExpensesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                Recent Expenses ({recentExpenses.length})
              </h2>
              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onNavigateToTab('flexible_expenses')}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
                >
                  View All
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecentExpensesCollapsed((prev) => !prev)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <span>{isRecentExpensesCollapsed ? 'Expand' : 'Collapse'}</span>
                  <svg
                    className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                      isRecentExpensesCollapsed ? '' : 'rotate-180'
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
            </div>

            {!isRecentExpensesCollapsed && (
              <>
                {recentExpenses.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No expenses recorded in selected range.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupRecordsByPeriod(recentExpenses, recordGroupBy).map((group) => (
                      <div key={group.key} className="space-y-2">
                        {recordGroupBy !== 'none' && (
                          <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700">
                            {group.label} ({group.items.length})
                          </div>
                        )}
                        <div className="divide-y divide-slate-100">
                          {group.items.map((exp) => {
                            const acc =
                              accounts.find((a) => a.id === exp.accountId) ||
                              defaultAccount;
                            return (
                              <div
                                key={exp.id}
                                className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-display text-xs sm:text-sm font-semibold text-slate-900 break-words">
                                    {exp.recipient || exp.description || exp.category}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                                    <span className="font-mono tabular-nums">
                                      {formatDateTimeDDMMYYYY(exp.date, exp.createdAt)}
                                    </span>
                                    <span>·</span>
                                    <span>{exp.subcategory || exp.category}</span>
                                    <span>·</span>
                                    <span className="font-medium text-slate-700">
                                      {acc?.name || 'Account'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span
                                    className={`font-mono text-xs sm:text-sm font-semibold tabular-nums ${
                                      exp.vaultAction === 'credit'
                                        ? 'text-emerald-700'
                                        : 'text-rose-600'
                                    }`}
                                  >
                                    {exp.vaultAction === 'credit' ? '+' : '-'}
                                    {formatAmount(exp.amount, currency)}
                                  </span>
                                  {onEditExpense && (
                                    <button
                                      type="button"
                                      onClick={() => onEditExpense(exp)}
                                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Collapsible Accounts */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5 min-w-0">
          <div
            onClick={() => setIsAccountsCollapsed((prev) => !prev)}
            className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
              isAccountsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
            }`}
          >
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Accounts ({summaries.length})
            </h2>
            <div
              className="flex items-center gap-2 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => onNavigateToTab('accounts')}
                className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 whitespace-nowrap"
              >
                Manage
              </button>
              <button
                type="button"
                onClick={() => setIsAccountsCollapsed((prev) => !prev)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <span>{isAccountsCollapsed ? 'Expand' : 'Collapse'}</span>
                <svg
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                    isAccountsCollapsed ? '' : 'rotate-180'
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
          </div>

          {!isAccountsCollapsed && (
            <div className="space-y-3.5">
              <div className="divide-y divide-slate-100">
                {summaries.map((s, idx) => {
                  const balDisplay = formatAccountCardBalanceByMode(
                    s,
                    settings,
                    fxSnapshot
                  );
                  return (
                    <div
                      key={s.account.id}
                      onClick={() => onNavigateToTab('accounts')}
                      className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                colorConfig.chartPalette[
                                  idx % colorConfig.chartPalette.length
                                ],
                            }}
                          />
                          <div className="font-display text-sm font-semibold text-slate-900 break-words">
                            {isSavingsVaultAccount(s.account, settings)
                              ? getVaultCleanName(s.account.name)
                              : s.account.name}
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono shrink-0 tabular-nums">
                        <div
                          className={`text-sm font-semibold ${
                            balDisplay.isNegative
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {balDisplay.primaryText}
                        </div>
                        {balDisplay.secondaryText && (
                          <div className="text-[11px] text-slate-400">
                            {balDisplay.secondaryText}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onNavigateToTab('accounts')}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                >
                  + New Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
