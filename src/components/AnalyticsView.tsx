import React, { useState, useEffect, useMemo } from 'react';
import {
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  FinancialBudget,
  UserSettings,
  Quarter,
} from '../types/finance.ts';
import {
  calculateAccountSummaries,
  formatAmount,
  formatPercent,
  getEffectiveIncomeDeductions,
  isSavingsDeduction,
  computeSavingsBreakdownForDeduction,
  getIncomeDeductionExpenses,
  getSavingsSplitTransfers,
  getEffectiveSavingsPillars,
  isSavingsVaultAccount,
  getSavingsVaultAccountIds,
  getQuarterFromDate,
  resolveIntuitiveSubcategoryColor,
  getSubcategoryBadgeStyle,
  getIncomeBaseGross,
  getExpenseNativeAndBaseAmount,
  addCurrencyBucketAmount,
  mapToCurrencyBucketTotals,
  formatTotalByCurrencyMode,
  getSecondaryCurrencyModeCaption,
  getManualSavingsVaultTransfersBreakdown,
} from '../lib/calculations.ts';
import { evaluateAllBudgets } from '../lib/budgetCalculations.ts';
import {
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  convertCurrency2dp,
  getAccountCurrency,
  getAccountNativeBalance,
  roundTo2Decimals,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { getColorThemeConfig } from '../lib/colorThemes.ts';
import {
  TimeRangePreset,
  CustomDateRange,
  getPresetLabel,
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  sortRecordsByArrivalTime,
} from '../lib/dateFilters.ts';
import { ActiveTab } from './Navigation.tsx';
import { RecordCard, ExpenseDetailPopupModal } from './RecordCard.tsx';

interface AnalyticsViewProps {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  budgets?: FinancialBudget[];
  settings: UserSettings;
  currency: string;
  timeRange?: TimeRangePreset;
  customDateRange?: CustomDateRange;
  onNavigateToTab: (tab: ActiveTab) => void;
  onEditExpense?: (expense: FlexibleExpense) => void;
  onDeleteExpense?: (id: string) => void;
}

interface PieSliceDatum {
  id: string;
  label: string;
  group: 'vault' | 'expense' | 'net';
  amount: number;
  color: string;
}

function describePieWedge(
  cx: number,
  cy: number,
  r: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const startRad = ((startAngleDeg - 90) * Math.PI) / 180;
  const endRad = ((endAngleDeg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${x1} ${y1}`,
    `A ${r} ${r} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
    'Z',
  ].join(' ');
}

const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatMonthShortLabel(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split('-').map(Number);
  const mName = MONTH_SHORT_NAMES[(m || 1) - 1] || ym;
  return `${mName} '${String(y).slice(-2)}`;
}

function getPreviousYearMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return 'Prev';
  const [y, m] = ym.split('-').map(Number);
  if (m <= 1) {
    return `${y - 1}-12`;
  }
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function formatCompactBarAmount(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) {
    return `${(val / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(val / 1_000).toFixed(1)}k`;
  }
  return val.toFixed(0);
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  incomes,
  expenses,
  accounts,
  transfers,
  budgets = [],
  settings,
  currency,
  timeRange = 'all',
  customDateRange,
  onNavigateToTab,
  onEditExpense,
  onDeleteExpense,
}) => {
  const [selectedPopupExpense, setSelectedPopupExpense] =
    useState<FlexibleExpense | null>(null);
  const [accountScopeFilter, setAccountScopeFilter] = useState<
    'all' | 'operating' | 'vaults'
  >('all');
  const [isAccountsPerfCollapsed, setIsAccountsPerfCollapsed] = useState(false);
  const [isKeyMetricsCollapsed, setIsKeyMetricsCollapsed] = useState(false);
  const [isPieSectionCollapsed, setIsPieSectionCollapsed] = useState(true);
  const [selectedPieQuarter, setSelectedPieQuarter] = useState<'ALL' | Quarter>('ALL');
  const [pieDetailMode, setPieDetailMode] = useState<'detailed' | 'summary'>('detailed');
  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);
  const [expenseFilterMode, setExpenseFilterMode] = useState<'all' | 'recorded' | 'deductions'>('all');
  const [isMoMCategoriesCollapsed, setIsMoMCategoriesCollapsed] = useState(true);
  const [momChartMode, setMomChartMode] = useState<'by_category' | 'by_month'>('by_category');
  const [momFilterCreepingOnly, setMomFilterCreepingOnly] = useState(false);
  const [hoveredMoMBar, setHoveredMoMBar] = useState<{
    category: string;
    monthLabel: string;
    amount: number;
  } | null>(null);
  const [isExpenseCategoriesCollapsed, setIsExpenseCategoriesCollapsed] = useState(true);
  const [isRecipientsCollapsed, setIsRecipientsCollapsed] = useState(true);
  const [isVaultsCollapsed, setIsVaultsCollapsed] = useState(true);
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(true);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(true);
  const [isRecentExpensesCollapsed, setIsRecentExpensesCollapsed] = useState(true);
  const [visibleRecentCount, setVisibleRecentCount] = useState(30);

  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const colorConfig = useMemo(
    () => getColorThemeConfig(settings.colorTheme),
    [settings.colorTheme]
  );

  const effectiveSavingsPillars = useMemo(
    () => getEffectiveSavingsPillars(settings),
    [settings]
  );

  const {
    summaries,
    totalCashAcrossAllAccounts,
    cashByCurrency,
    operatingCashByCurrency,
    savingsVaultCashByCurrency,
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

  const operatingSummaries = useMemo(
    () => summaries.filter((s) => !isSavingsVaultAccount(s.account, settings)),
    [summaries, settings]
  );

  const savingsSummaries = useMemo(
    () => summaries.filter((s) => isSavingsVaultAccount(s.account, settings)),
    [summaries, settings]
  );

  const vaultIdSet = useMemo(
    () => getSavingsVaultAccountIds(settings),
    [settings]
  );

  // Derived Income Deduction Expenses & Savings Split Transfers
  const deductionExpenses = useMemo(
    () => getIncomeDeductionExpenses(incomes, settings, accounts, expenses),
    [incomes, settings, accounts, expenses]
  );

  const savingsSplitTransfers = useMemo(
    () => getSavingsSplitTransfers(incomes, settings, accounts),
    [incomes, settings, accounts]
  );

  const recordedExpensesOnly = useMemo(
    () => expenses.filter((e) => e.vaultAction !== 'credit'),
    [expenses]
  );

  const allCombinedExpenses = useMemo(
    () => [...recordedExpensesOnly, ...deductionExpenses],
    [recordedExpensesOnly, deductionExpenses]
  );

  const filteredExpensesForAnalysis = useMemo(() => {
    const base =
      expenseFilterMode === 'recorded'
        ? recordedExpensesOnly
        : expenseFilterMode === 'deductions'
        ? deductionExpenses
        : allCombinedExpenses;
    return sortRecordsByArrivalTime(base);
  }, [expenseFilterMode, recordedExpensesOnly, deductionExpenses, allCombinedExpenses]);

  const analytics = useMemo(() => {
    let totalGross = 0;
    let totalDeductions = 0;
    let totalSavingsSplitRouted = 0;
    let totalDeductionExpenses = 0;

    const grossByCurrencyMap = new Map<string, number>();
    const allExpensesByCurrencyMap = new Map<string, number>();
    const savingsByCurrencyMap = new Map<string, number>();

    const sourceMap = new Map<
      string,
      {
        source: string;
        count: number;
        gross: number;
        deductionExpenses: number;
        savingsTransferred: number;
        netRetained: number;
      }
    >();

    const pillarTotals = new Map<
      string,
      { count: number; transferredIn: number; causeCreditsOut: number }
    >();
    for (const p of effectiveSavingsPillars) {
      pillarTotals.set(p.accountId, {
        count: 0,
        transferredIn: 0,
        causeCreditsOut: 0,
      });
    }

    const createEmptyVaultMap = (): Record<string, number> => {
      const rec: Record<string, number> = {};
      for (const p of effectiveSavingsPillars) {
        rec[p.accountId] = 0;
      }
      return rec;
    };

    const quarterMap: Record<
      Quarter,
      {
        quarter: Quarter;
        count: number;
        gross: number;
        deductionExpenses: number;
        recordedExpenses: number;
        savings: number;
        net: number;
        vaultShares: Record<string, number>;
      }
    > = {
      Q1: {
        quarter: 'Q1',
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
        vaultShares: createEmptyVaultMap(),
      },
      Q2: {
        quarter: 'Q2',
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
        vaultShares: createEmptyVaultMap(),
      },
      Q3: {
        quarter: 'Q3',
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
        vaultShares: createEmptyVaultMap(),
      },
      Q4: {
        quarter: 'Q4',
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
        vaultShares: createEmptyVaultMap(),
      },
    };

    const monthMap = new Map<
      string,
      {
        month: string;
        count: number;
        gross: number;
        deductionExpenses: number;
        recordedExpenses: number;
        savings: number;
        net: number;
      }
    >();

    const recordSeries: {
      id: string;
      label: string;
      date: string;
      gross: number;
      savings: number;
      deductionExp: number;
      net: number;
    }[] = [];

    const chronological = [...incomes].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '')
    );

    for (const inc of chronological) {
      const { baseGross: gross, nativeGross, currency: nativeCurrency } =
        getIncomeBaseGross(inc, settings, accounts, fxSnapshot);
      totalGross += gross;
      addCurrencyBucketAmount(grossByCurrencyMap, nativeCurrency, nativeGross);

      const deds = getEffectiveIncomeDeductions(inc, settings);
      let incDedTotal = 0;
      let incSavingsTotal = 0;
      let incDedExpenseTotal = 0;

      const incQuarter: Quarter = inc.quarter || getQuarterFromDate(inc.date);

      for (const d of deds) {
        const nativeDedAmt = Number(d.amount) || 0;
        const { convertedAmount: amt } = convertCurrency2dp(
          nativeDedAmt,
          nativeCurrency,
          currency,
          fxSnapshot
        );
        incDedTotal += amt;
        totalDeductions += amt;

        if (isSavingsDeduction(d)) {
          incSavingsTotal += amt;
          totalSavingsSplitRouted += amt;
          addCurrencyBucketAmount(savingsByCurrencyMap, nativeCurrency, nativeDedAmt);

          const shares = computeSavingsBreakdownForDeduction(d, amt, accounts, settings);
          for (const share of shares) {
            const prevPillar = pillarTotals.get(share.accountId) || {
              count: 0,
              transferredIn: 0,
              causeCreditsOut: 0,
            };
            pillarTotals.set(share.accountId, {
              ...prevPillar,
              count: prevPillar.count + 1,
              transferredIn:
                Math.round((prevPillar.transferredIn + share.amount) * 100) / 100,
            });
            if (quarterMap[incQuarter]) {
              const prevQShare =
                quarterMap[incQuarter].vaultShares[share.accountId] || 0;
              quarterMap[incQuarter].vaultShares[share.accountId] =
                Math.round((prevQShare + share.amount) * 100) / 100;
            }
          }
        } else {
          incDedExpenseTotal += amt;
          totalDeductionExpenses += amt;
          addCurrencyBucketAmount(
            allExpensesByCurrencyMap,
            nativeCurrency,
            nativeDedAmt
          );
        }
      }

      const incNet = Math.round((gross - incDedTotal) * 100) / 100;

      recordSeries.push({
        id: inc.id,
        label: inc.clientOrSource || 'Income',
        date: inc.date || '',
        gross,
        savings: incSavingsTotal,
        deductionExp: incDedExpenseTotal,
        net: Math.max(0, incNet),
      });

      const srcName = (inc.clientOrSource || 'Unspecified').trim();
      const prevSrc = sourceMap.get(srcName) || {
        source: srcName,
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        savingsTransferred: 0,
        netRetained: 0,
      };
      sourceMap.set(srcName, {
        source: srcName,
        count: prevSrc.count + 1,
        gross: Math.round((prevSrc.gross + gross) * 100) / 100,
        deductionExpenses:
          Math.round((prevSrc.deductionExpenses + incDedExpenseTotal) * 100) / 100,
        savingsTransferred:
          Math.round((prevSrc.savingsTransferred + incSavingsTotal) * 100) / 100,
        netRetained: Math.round((prevSrc.netRetained + incNet) * 100) / 100,
      });

      if (quarterMap[incQuarter]) {
        quarterMap[incQuarter].count += 1;
        quarterMap[incQuarter].gross =
          Math.round((quarterMap[incQuarter].gross + gross) * 100) / 100;
        quarterMap[incQuarter].deductionExpenses =
          Math.round((quarterMap[incQuarter].deductionExpenses + incDedExpenseTotal) * 100) / 100;
        quarterMap[incQuarter].savings =
          Math.round((quarterMap[incQuarter].savings + incSavingsTotal) * 100) / 100;
        quarterMap[incQuarter].net =
          Math.round((quarterMap[incQuarter].net + incNet) * 100) / 100;
      }

      const monthKey = (inc.date || '').slice(0, 7) || 'Unknown';
      const prevMonth = monthMap.get(monthKey) || {
        month: monthKey,
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
      };
      monthMap.set(monthKey, {
        ...prevMonth,
        count: prevMonth.count + 1,
        gross: Math.round((prevMonth.gross + gross) * 100) / 100,
        deductionExpenses:
          Math.round((prevMonth.deductionExpenses + incDedExpenseTotal) * 100) / 100,
        savings: Math.round((prevMonth.savings + incSavingsTotal) * 100) / 100,
        net: Math.round((prevMonth.net + incNet) * 100) / 100,
      });
    }

    // Track recorded expenses in quarters, months, and vault cause debits/credits
    let totalRecordedExpenses = 0;
    for (const exp of expenses) {
      const { baseAmount: amt, accountAmount, accountCurrency } =
        getExpenseNativeAndBaseAmount(exp, settings, accounts, fxSnapshot);
      const isVaultCredit = exp.vaultAction === 'credit';

      if (exp.accountId && pillarTotals.has(exp.accountId)) {
        const prevPillar = pillarTotals.get(exp.accountId)!;
        pillarTotals.set(exp.accountId, {
          ...prevPillar,
          causeCreditsOut: isVaultCredit
            ? Math.max(0, Math.round((prevPillar.causeCreditsOut - amt) * 100) / 100)
            : Math.round((prevPillar.causeCreditsOut + amt) * 100) / 100,
        });
      }

      if (isVaultCredit) {
        continue;
      }

      totalRecordedExpenses += amt;
      addCurrencyBucketAmount(
        allExpensesByCurrencyMap,
        accountCurrency,
        accountAmount
      );

      const monthStr = (exp.date || '').slice(0, 7) || 'Unknown';
      const mNum = Number((exp.date || '').slice(5, 7)) || 1;
      const q: Quarter =
        mNum <= 3 ? 'Q1' : mNum <= 6 ? 'Q2' : mNum <= 9 ? 'Q3' : 'Q4';
      if (quarterMap[q]) {
        quarterMap[q].recordedExpenses =
          Math.round((quarterMap[q].recordedExpenses + amt) * 100) / 100;
      }

      const prevM = monthMap.get(monthStr) || {
        month: monthStr,
        count: 0,
        gross: 0,
        deductionExpenses: 0,
        recordedExpenses: 0,
        savings: 0,
        net: 0,
      };
      monthMap.set(monthStr, {
        ...prevM,
        recordedExpenses:
          Math.round((prevM.recordedExpenses + amt) * 100) / 100,
      });
    }

    // Expense Category & Subcategory aggregation on `filteredExpensesForAnalysis`
    let filteredExpenseSum = 0;
    const expMonthsSet = new Set<string>();
    const categoryMap = new Map<
      string,
      {
        category: string;
        total: number;
        count: number;
        deductionCount: number;
        recordedCount: number;
        subcategories: Map<string, { name: string; total: number; count: number }>;
        monthlySpend: Map<string, number>;
      }
    >();

    const recipientMap = new Map<
      string,
      {
        recipient: string;
        total: number;
        count: number;
        categories: Set<string>;
        isVaultCause: boolean;
      }
    >();

    const accountOutflowMap = new Map<
      string,
      {
        accountId: string;
        accountName: string;
        isVault: boolean;
        total: number;
        count: number;
      }
    >();

    for (const exp of filteredExpensesForAnalysis) {
      const { baseAmount: amt } = getExpenseNativeAndBaseAmount(
        exp,
        settings,
        accounts,
        fxSnapshot
      );
      filteredExpenseSum += amt;

      const isDedExp =
        exp.id.startsWith('exp_ded_') || exp.id.startsWith('inc_ded_exp_');
      const catName = (exp.category || 'Uncategorized').trim() || 'Uncategorized';
      const subName = (exp.subcategory || '').trim();
      const expMonthKey = (exp.date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(expMonthKey)) {
        expMonthsSet.add(expMonthKey);
      }

      const prevCat = categoryMap.get(catName) || {
        category: catName,
        total: 0,
        count: 0,
        deductionCount: 0,
        recordedCount: 0,
        subcategories: new Map(),
        monthlySpend: new Map(),
      };
      prevCat.total = Math.round((prevCat.total + amt) * 100) / 100;
      prevCat.count += 1;
      if (isDedExp) {
        prevCat.deductionCount += 1;
      } else {
        prevCat.recordedCount += 1;
      }

      if (/^\d{4}-\d{2}$/.test(expMonthKey)) {
        const prevMonthAmt = prevCat.monthlySpend.get(expMonthKey) || 0;
        prevCat.monthlySpend.set(
          expMonthKey,
          Math.round((prevMonthAmt + amt) * 100) / 100
        );
      }

      if (subName) {
        const prevSub = prevCat.subcategories.get(subName) || {
          name: subName,
          total: 0,
          count: 0,
        };
        prevCat.subcategories.set(subName, {
          name: subName,
          total: Math.round((prevSub.total + amt) * 100) / 100,
          count: prevSub.count + 1,
        });
      }
      categoryMap.set(catName, prevCat);

      // Recipient / Cause ("To")
      const recName =
        (exp.recipient || exp.subcategory || exp.category || 'General').trim();
      const isVault = Boolean(exp.accountId && vaultIdSet.has(exp.accountId));
      const prevRec = recipientMap.get(recName) || {
        recipient: recName,
        total: 0,
        count: 0,
        categories: new Set<string>(),
        isVaultCause: false,
      };
      prevRec.total = Math.round((prevRec.total + amt) * 100) / 100;
      prevRec.count += 1;
      prevRec.categories.add(catName);
      if (isVault) prevRec.isVaultCause = true;
      recipientMap.set(recName, prevRec);

      // Account Outflow
      const accObj = accounts.find((a) => a.id === exp.accountId);
      const accId = accObj?.id || exp.accountId || 'unassigned';
      const accName = accObj?.name || 'Primary Operating Account';
      const prevAcc = accountOutflowMap.get(accId) || {
        accountId: accId,
        accountName: accName,
        isVault,
        total: 0,
        count: 0,
      };
      prevAcc.total = Math.round((prevAcc.total + amt) * 100) / 100;
      prevAcc.count += 1;
      accountOutflowMap.set(accId, prevAcc);
    }

    // Also include user-defined preference categories with 0 spend so user sees all configured categories
    for (const pref of settings.expenseCategoryPreferences || []) {
      const name = pref.name.trim();
      if (name && !categoryMap.has(name)) {
        const subMap = new Map<string, { name: string; total: number; count: number }>();
        for (const s of pref.subcategories || []) {
          subMap.set(s, { name: s, total: 0, count: 0 });
        }
        categoryMap.set(name, {
          category: name,
          total: 0,
          count: 0,
          deductionCount: 0,
          recordedCount: 0,
          subcategories: subMap,
          monthlySpend: new Map(),
        });
      }
    }

    const manualVaultBreakdown = getManualSavingsVaultTransfersBreakdown(
      transfers,
      accounts,
      settings,
      incomes,
      fxSnapshot
    );
    totalSavingsSplitRouted += manualVaultBreakdown.netManualToVaultBase;
    for (const [mCurr, mAmt] of manualVaultBreakdown.netByCurrencyMap.entries()) {
      addCurrencyBucketAmount(savingsByCurrencyMap, mCurr, mAmt);
    }
    for (const [vId, vStat] of manualVaultBreakdown.perVaultStats.entries()) {
      if (vStat.inCount === 0 && vStat.netBase === 0) continue;
      const prevP = pillarTotals.get(vId) || {
        count: 0,
        transferredIn: 0,
        causeCreditsOut: 0,
      };
      pillarTotals.set(vId, {
        ...prevP,
        count: prevP.count + vStat.inCount,
        transferredIn:
          Math.round((prevP.transferredIn + vStat.netBase) * 100) / 100,
      });
    }
    for (const qKey of ['Q1', 'Q2', 'Q3', 'Q4'] as Quarter[]) {
      const qManual = manualVaultBreakdown.byQuarter[qKey];
      if (!qManual) continue;
      quarterMap[qKey].savings =
        Math.round((quarterMap[qKey].savings + qManual.base) * 100) / 100;
      for (const [vId, vAmt] of Object.entries(qManual.perVault)) {
        quarterMap[qKey].vaultShares[vId] =
          Math.round(
            ((quarterMap[qKey].vaultShares[vId] || 0) + vAmt) * 100
          ) / 100;
      }
    }
    for (const [mKey, mSav] of manualVaultBreakdown.byMonth.entries()) {
      const prevM = monthMap.get(mKey);
      if (prevM) {
        monthMap.set(mKey, {
          ...prevM,
          savings: Math.round((prevM.savings + mSav) * 100) / 100,
        });
      }
    }

    totalGross = Math.round(totalGross * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    totalSavingsSplitRouted = Math.round(totalSavingsSplitRouted * 100) / 100;
    totalDeductionExpenses = Math.round(totalDeductionExpenses * 100) / 100;
    totalRecordedExpenses = Math.round(totalRecordedExpenses * 100) / 100;
    const totalAllExpenses =
      Math.round((totalDeductionExpenses + totalRecordedExpenses) * 100) / 100;

    const netRetainedAfterAll = Math.round(
      (totalGross - totalSavingsSplitRouted - totalAllExpenses) * 100
    ) / 100;
    const netRetainedFromIncome = Math.round((totalGross - totalDeductions) * 100) / 100;

    const avgIncomePerRecord = incomes.length > 0 ? totalGross / incomes.length : 0;
    const effectiveSavingsRate =
      totalGross > 0 ? (totalSavingsSplitRouted / totalGross) * 100 : 0;
    const deductionExpenseRate =
      totalGross > 0 ? (totalDeductionExpenses / totalGross) * 100 : 0;
    const recordedExpenseRate =
      totalGross > 0 ? (totalRecordedExpenses / totalGross) * 100 : 0;
    const totalExpenseRate =
      totalGross > 0 ? (totalAllExpenses / totalGross) * 100 : 0;
    const netRetentionRate =
      totalGross > 0
        ? Math.max(0, (netRetainedAfterAll / totalGross) * 100)
        : 0;

    const expenseCategoriesList = Array.from(categoryMap.values())
      .map((c) => ({
        ...c,
        subcategoriesList: Array.from(c.subcategories.values()).sort(
          (a, b) => b.total - a.total
        ),
      }))
      .sort((a, b) => b.total - a.total);

    // Build chronological Month-over-Month window (up to last 6 months, minimum 2 months)
    for (const mKey of monthMap.keys()) {
      if (/^\d{4}-\d{2}$/.test(mKey)) {
        expMonthsSet.add(mKey);
      }
    }
    let sortedMoMMonths = Array.from(expMonthsSet).sort((a, b) =>
      a.localeCompare(b)
    );
    if (sortedMoMMonths.length === 0) {
      const currentYm = new Date().toISOString().slice(0, 7);
      sortedMoMMonths = [getPreviousYearMonth(currentYm), currentYm];
    } else if (sortedMoMMonths.length === 1) {
      sortedMoMMonths = [
        getPreviousYearMonth(sortedMoMMonths[0]),
        sortedMoMMonths[0],
      ];
    } else if (sortedMoMMonths.length > 6) {
      sortedMoMMonths = sortedMoMMonths.slice(-6);
    }

    const latestMoMMonth = sortedMoMMonths[sortedMoMMonths.length - 1];
    const prevMoMMonth = sortedMoMMonths[sortedMoMMonths.length - 2];

    const categoryMoMList = expenseCategoriesList
      .map((c, idx) => {
        const series = sortedMoMMonths.map((m) => ({
          month: m,
          label: formatMonthShortLabel(m),
          amount: Math.round((c.monthlySpend.get(m) || 0) * 100) / 100,
        }));
        const latestAmount =
          series[series.length - 1]?.amount ?? 0;
        const prevAmount =
          series[series.length - 2]?.amount ?? 0;
        const deltaAmount =
          Math.round((latestAmount - prevAmount) * 100) / 100;
        const deltaPct =
          prevAmount > 0
            ? ((latestAmount - prevAmount) / prevAmount) * 100
            : latestAmount > 0
            ? 100
            : 0;
        const sumWindow = series.reduce((s, item) => s + item.amount, 0);
        const avgMonthly =
          series.length > 0
            ? Math.round((sumWindow / series.length) * 100) / 100
            : 0;
        const peakMonthly = Math.max(0, ...series.map((item) => item.amount));
        return {
          category: c.category,
          total: c.total,
          count: c.count,
          color:
            colorConfig.chartPalette[idx % colorConfig.chartPalette.length],
          series,
          latestAmount,
          prevAmount,
          deltaAmount,
          deltaPct,
          avgMonthly,
          peakMonthly,
          isCreeping: deltaAmount > 0,
        };
      })
      .sort((a, b) => {
        if (b.deltaAmount !== a.deltaAmount) {
          return b.deltaAmount - a.deltaAmount;
        }
        return b.total - a.total;
      });

    const momTotalLatest = Math.round(
      categoryMoMList.reduce((s, c) => s + c.latestAmount, 0) * 100
    ) / 100;
    const momTotalPrev = Math.round(
      categoryMoMList.reduce((s, c) => s + c.prevAmount, 0) * 100
    ) / 100;
    const momTotalDelta = Math.round((momTotalLatest - momTotalPrev) * 100) / 100;
    const momTotalDeltaPct =
      momTotalPrev > 0
        ? ((momTotalLatest - momTotalPrev) / momTotalPrev) * 100
        : momTotalLatest > 0
        ? 100
        : 0;

    const recipientsList = Array.from(recipientMap.values())
      .map((r) => ({
        ...r,
        categoryList: Array.from(r.categories),
      }))
      .sort((a, b) => b.total - a.total);

    const accountOutflowsList = Array.from(accountOutflowMap.values()).sort(
      (a, b) => b.total - a.total
    );

    const sourcesList = Array.from(sourceMap.values()).sort(
      (a, b) => b.gross - a.gross
    );
    const monthsList = Array.from(monthMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    const operatingCashTotal = operatingSummaries.reduce(
      (s, item) => s + item.currentCashBalance,
      0
    );
    const savingsVaultCashTotal = savingsSummaries.reduce(
      (s, item) => s + item.currentCashBalance,
      0
    );

    return {
      totalGross,
      totalDeductions,
      totalSavingsSplitRouted,
      manualVaultTransferCount: manualVaultBreakdown.manualToVaultCount,
      manualVaultTransferNet: manualVaultBreakdown.netManualToVaultBase,
      totalDeductionExpenses,
      totalRecordedExpenses,
      totalAllExpenses,
      filteredExpenseSum: Math.round(filteredExpenseSum * 100) / 100,
      netRetainedAfterAll,
      netRetainedFromIncome,
      avgIncomePerRecord,
      effectiveSavingsRate,
      deductionExpenseRate,
      recordedExpenseRate,
      totalExpenseRate,
      netRetentionRate,
      expenseCategoriesList,
      momMonths: sortedMoMMonths.map((m) => ({
        month: m,
        label: formatMonthShortLabel(m),
      })),
      latestMoMLabel: formatMonthShortLabel(latestMoMMonth),
      prevMoMLabel: formatMonthShortLabel(prevMoMMonth),
      categoryMoMList,
      momTotalLatest,
      momTotalPrev,
      momTotalDelta,
      momTotalDeltaPct,
      recipientsList,
      accountOutflowsList,
      sourcesList,
      pillarTotals,
      quartersList: Object.values(quarterMap),
      monthsList,
      recordSeries: recordSeries.slice(-8),
      operatingCashTotal,
      savingsVaultCashTotal,
      grossByCurrency: mapToCurrencyBucketTotals(grossByCurrencyMap, currency),
      allExpensesByCurrency: mapToCurrencyBucketTotals(
        allExpensesByCurrencyMap,
        currency
      ),
      savingsByCurrency: mapToCurrencyBucketTotals(
        savingsByCurrencyMap,
        currency
      ),
    };
  }, [
    incomes,
    expenses,
    filteredExpensesForAnalysis,
    settings,
    accounts,
    effectiveSavingsPillars,
    operatingSummaries,
    savingsSummaries,
    fxSnapshot,
    currency,
    colorConfig.chartPalette,
    vaultIdSet,
  ]);

  const accountByIdMap = useMemo(() => {
    const map = new Map<string, FinancialAccount>();
    for (const acc of accounts) {
      map.set(acc.id, acc);
    }
    return map;
  }, [accounts]);

  // Accounts Income vs. Expenses Performance (derived strictly from active summaries)
  const accountPerformance = useMemo(() => {
    const rows = summaries.map((s) => {
      const isVault = isSavingsVaultAccount(s.account, settings);
      const directIncome = roundTo2Decimals(s.grossDeposited || 0);
      const incomingAllocationsAndTransfers = roundTo2Decimals(
        (s.incomingDeductionAllocations || 0) +
          (s.netIncomeTransferredIn || 0) +
          (s.transfersIn || 0) +
          (s.vaultCreditsIn || 0)
      );
      const totalInflows = roundTo2Decimals(
        directIncome + incomingAllocationsAndTransfers
      );

      const directExpenses = roundTo2Decimals(
        (s.expensesPaid || 0) +
          (s.mandatoryCutsIncurred || 0) +
          (s.vaultDebitsOut || 0)
      );
      const outgoingAllocationsAndTransfers = roundTo2Decimals(
        (s.savingsAllocatedIncurred || 0) +
          (s.netIncomeTransferredOut || 0) +
          (s.transfersOut || 0)
      );
      const totalOutflows = roundTo2Decimals(
        directExpenses + outgoingAllocationsAndTransfers
      );

      const netFlow = roundTo2Decimals(totalInflows - totalOutflows);
      const expenseRatio =
        totalInflows > 0
          ? roundTo2Decimals((directExpenses / totalInflows) * 100)
          : directExpenses > 0
          ? 100
          : 0;
      const accCurr = getAccountCurrency(s.account, currency);
      const nativeBal = getAccountNativeBalance(
        s.currentCashBalance,
        s.account,
        currency,
        fxSnapshot
      );

      return {
        id: s.account.id,
        name: s.account.name,
        type: s.account.type || (isVault ? 'Savings' : 'Operating'),
        isVault,
        color: s.account.color || colorConfig.primary,
        currency: accCurr,
        directIncome,
        incomingAllocationsAndTransfers,
        totalInflows,
        directExpenses,
        outgoingAllocationsAndTransfers,
        totalOutflows,
        netFlow,
        expenseRatio,
        currentBalance: roundTo2Decimals(s.currentCashBalance),
        nativeBalance: nativeBal.amount,
        nativeCurrency: nativeBal.currency,
        incomeCount: s.incomeCount || 0,
      };
    });

    const filtered = rows
      .filter((r) => {
        if (accountScopeFilter === 'operating') return !r.isVault;
        if (accountScopeFilter === 'vaults') return r.isVault;
        return true;
      })
      .sort(
        (a, b) =>
          b.totalInflows +
          b.totalOutflows -
          (a.totalInflows + a.totalOutflows)
      );

    const maxFlow = Math.max(
      1,
      ...filtered.map((r) => Math.max(r.totalInflows, r.totalOutflows))
    );
    const sumInflows = roundTo2Decimals(
      filtered.reduce((acc, r) => acc + r.totalInflows, 0)
    );
    const sumDirectIncome = roundTo2Decimals(
      filtered.reduce((acc, r) => acc + r.directIncome, 0)
    );
    const sumDirectExpenses = roundTo2Decimals(
      filtered.reduce((acc, r) => acc + r.directExpenses, 0)
    );
    const sumOutflows = roundTo2Decimals(
      filtered.reduce((acc, r) => acc + r.totalOutflows, 0)
    );
    const sumNetFlow = roundTo2Decimals(sumInflows - sumOutflows);

    return {
      rows: filtered,
      maxFlow,
      sumInflows,
      sumDirectIncome,
      sumDirectExpenses,
      sumOutflows,
      sumNetFlow,
    };
  }, [summaries, settings, accountScopeFilter, currency, fxSnapshot, colorConfig.primary]);

  // Key Financial Performance & Efficiency Metrics (derived strictly from active ledger & budgets)
  const keyMetrics = useMemo(() => {
    const activeDates = new Set<string>();
    for (const exp of allCombinedExpenses) {
      if (exp.date) activeDates.add(exp.date.slice(0, 10));
    }
    for (const inc of incomes) {
      if (inc.date) activeDates.add(inc.date.slice(0, 10));
    }

    const sortedDates = Array.from(activeDates).sort();
    let spanDays = 1;
    if (sortedDates.length >= 2) {
      const startMs = new Date(`${sortedDates[0]}T00:00:00`).getTime();
      const endMs = new Date(`${sortedDates[sortedDates.length - 1]}T00:00:00`).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
        spanDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
      }
    }

    const activeMonthsCount = Math.max(1, analytics.monthsList.length);
    const avgDailySpend = roundTo2Decimals(analytics.totalAllExpenses / spanDays);
    const avgMonthlySpend = roundTo2Decimals(
      analytics.totalAllExpenses / activeMonthsCount
    );
    const avgMonthlyIncome = roundTo2Decimals(
      analytics.totalGross / activeMonthsCount
    );
    const cashRunwayMonths =
      avgMonthlySpend > 0 && analytics.operatingCashTotal > 0
        ? roundTo2Decimals(analytics.operatingCashTotal / avgMonthlySpend)
        : null;

    let largestExpense: {
      label: string;
      category: string;
      amount: number;
      date: string;
    } | null = null;
    for (const exp of allCombinedExpenses) {
      const { baseAmount } = getExpenseNativeAndBaseAmount(
        exp,
        settings,
        accounts,
        fxSnapshot
      );
      if (!largestExpense || baseAmount > largestExpense.amount) {
        largestExpense = {
          label: exp.subcategory || exp.category || 'Expense',
          category: exp.category || 'Uncategorized',
          amount: roundTo2Decimals(baseAmount),
          date: exp.date,
        };
      }
    }

    let largestIncome: {
      source: string;
      amount: number;
      date: string;
    } | null = null;
    for (const inc of incomes) {
      const { baseGross } = getIncomeBaseGross(inc, settings, accounts, fxSnapshot);
      if (!largestIncome || baseGross > largestIncome.amount) {
        largestIncome = {
          source: inc.clientOrSource || 'Income',
          amount: roundTo2Decimals(baseGross),
          date: inc.date,
        };
      }
    }

    const topCategory = analytics.expenseCategoriesList[0] || null;
    const topCategorySharePct =
      topCategory && analytics.totalAllExpenses > 0
        ? roundTo2Decimals((topCategory.total / analytics.totalAllExpenses) * 100)
        : 0;

    const evaluatedBudgets =
      budgets.length > 0
        ? evaluateAllBudgets(
            budgets,
            expenses,
            incomes,
            accounts,
            settings,
            fxSnapshot,
            new Date(),
            false,
            transfers
          )
        : [];
    const activeBudgets = evaluatedBudgets.filter(
      (b) => !b.budget.isExpiredDisabled
    );
    const healthyBudgets = activeBudgets.filter(
      (b) => b.status === 'healthy'
    ).length;
    const alertBudgets = activeBudgets.filter(
      (b) => b.status === 'warning' || b.status === 'at_limit' || b.status === 'exceeded'
    ).length;
    const totalBudgetLimitBase = roundTo2Decimals(
      activeBudgets.reduce((s, b) => s + (b.budgetLimitBase || 0), 0)
    );
    const totalBudgetSpentBase = roundTo2Decimals(
      activeBudgets.reduce((s, b) => s + (b.spentAmountBase || 0), 0)
    );
    const budgetUtilizationPct =
      totalBudgetLimitBase > 0
        ? roundTo2Decimals((totalBudgetSpentBase / totalBudgetLimitBase) * 100)
        : 0;

    const vaultDebitsTotal = roundTo2Decimals(
      savingsSummaries.reduce((s, item) => s + (item.vaultDebitsOut || 0), 0)
    );
    const netVaultGrowth = roundTo2Decimals(
      analytics.totalSavingsSplitRouted - vaultDebitsTotal
    );

    const manualTransfersCount = transfers.filter(
      (t) =>
        !t.id.startsWith('trans_auto_') &&
        !t.id.startsWith('trans_sav_') &&
        !t.id.startsWith('trans_net_')
    ).length;
    const manualTransfersVolume = roundTo2Decimals(
      transfers
        .filter(
          (t) =>
            !t.id.startsWith('trans_auto_') &&
            !t.id.startsWith('trans_sav_') &&
            !t.id.startsWith('trans_net_')
        )
        .reduce((s, t) => s + (t.amount || 0), 0)
    );

    return {
      spanDays,
      activeMonthsCount,
      avgDailySpend,
      avgMonthlySpend,
      avgMonthlyIncome,
      cashRunwayMonths,
      largestExpense,
      largestIncome,
      topCategory,
      topCategorySharePct,
      activeBudgetsCount: activeBudgets.length,
      healthyBudgets,
      alertBudgets,
      totalBudgetLimitBase,
      totalBudgetSpentBase,
      budgetUtilizationPct,
      vaultDebitsTotal,
      netVaultGrowth,
      manualTransfersCount,
      manualTransfersVolume,
    };
  }, [
    allCombinedExpenses,
    incomes,
    expenses,
    accounts,
    transfers,
    budgets,
    settings,
    fxSnapshot,
    analytics,
    savingsSummaries,
  ]);

  const maxQuarterGross = useMemo(
    () => Math.max(...analytics.quartersList.map((q) => q.gross), 1),
    [analytics.quartersList]
  );

  const recentExpensesSlice = useMemo(
    () => filteredExpensesForAnalysis.slice(0, visibleRecentCount),
    [filteredExpensesForAnalysis, visibleRecentCount]
  );

  const recentSubcategoryColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const exp of recentExpensesSlice) {
      const subLabel =
        exp.subcategory?.trim() || exp.category?.trim() || 'Expense';
      const key = `${exp.category || ''}::${subLabel}`;
      if (!map.has(key)) {
        map.set(
          key,
          resolveIntuitiveSubcategoryColor(
            subLabel,
            exp.category,
            settings,
            expenses
          )
        );
      }
    }
    return map;
  }, [recentExpensesSlice, settings, expenses]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 break-words">
            Analytics & Insights
          </h1>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {getPresetLabel(timeRange, customDateRange)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => onNavigateToTab('flexible_expenses')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 text-center whitespace-nowrap"
          >
            + Record Expense
          </button>
          <button
            type="button"
            onClick={() => onNavigateToTab('income_log')}
            className="rounded-lg bg-slate-900 px-3.5 py-2 sm:py-1.5 text-xs font-semibold text-white hover:bg-slate-800 text-center whitespace-nowrap"
          >
            + Record Income
          </button>
        </div>
      </div>

      {/* Top 4-Card Analytical KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Income</div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-emerald-700 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              analytics.totalGross,
              analytics.grossByCurrency,
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            analytics.totalGross,
            analytics.grossByCurrency,
            settings
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                analytics.totalGross,
                analytics.grossByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400 break-words">
            {incomes.length} records · Avg{' '}
            {formatAmount(analytics.avgIncomePerRecord, currency)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Expenses (All)
          </div>
          <div className="mt-1.5 font-mono text-xl font-semibold text-rose-600 tabular-nums break-words">
            {formatTotalByCurrencyMode(
              analytics.totalAllExpenses,
              analytics.allExpensesByCurrency,
              settings,
              { prefix: '-' }
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            analytics.totalAllExpenses,
            analytics.allExpensesByCurrency,
            settings,
            { prefix: '-' }
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                analytics.totalAllExpenses,
                analytics.allExpensesByCurrency,
                settings,
                { prefix: '-' }
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400 break-words">
            {recordedExpensesOnly.length} recorded · {deductionExpenses.length} deduction expenses
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
              analytics.totalSavingsSplitRouted,
              analytics.savingsByCurrency,
              settings
            )}
          </div>
          {getSecondaryCurrencyModeCaption(
            analytics.totalSavingsSplitRouted,
            analytics.savingsByCurrency,
            settings
          ) && (
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                analytics.totalSavingsSplitRouted,
                analytics.savingsByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400 break-words">
            {formatPercent(analytics.effectiveSavingsRate)} of gross ·{' '}
            {savingsSplitTransfers.length} split transfers
            {analytics.manualVaultTransferCount > 0
              ? ` · ${analytics.manualVaultTransferCount} manual transfer${
                  analytics.manualVaultTransferCount === 1 ? '' : 's'
                }`
              : ''}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/90 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Cash Liquidity
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
            <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums break-words">
              {getSecondaryCurrencyModeCaption(
                totalCashAcrossAllAccounts,
                cashByCurrency,
                settings
              )}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-400 break-words">
            Op:{' '}
            {formatTotalByCurrencyMode(
              analytics.operatingCashTotal,
              operatingCashByCurrency,
              settings
            )}{' '}
            · Vaults:{' '}
            {formatTotalByCurrencyMode(
              analytics.savingsVaultCashTotal,
              savingsVaultCashByCurrency,
              settings
            )}
          </div>
        </div>
      </div>

      {/* Quarterly Income Distribution: Savings Vaults vs. Flexible Expenses (Pie Chart) */}
      {(() => {
        const selectedQuarterObj =
          selectedPieQuarter === 'ALL'
            ? null
            : analytics.quartersList.find((q) => q.quarter === selectedPieQuarter) ||
              null;

        const periodGross = selectedQuarterObj
          ? selectedQuarterObj.gross
          : analytics.totalGross;
        const periodSavings = selectedQuarterObj
          ? selectedQuarterObj.savings
          : analytics.totalSavingsSplitRouted;
        const periodRecordedExp = selectedQuarterObj
          ? selectedQuarterObj.recordedExpenses
          : analytics.totalRecordedExpenses;
        const periodDeductionExp = selectedQuarterObj
          ? selectedQuarterObj.deductionExpenses
          : analytics.totalDeductionExpenses;
        const periodFlexibleAndDedExp =
          Math.round((periodRecordedExp + periodDeductionExp) * 100) / 100;
        const periodNetRetained = Math.max(
          0,
          Math.round(
            (periodGross - periodSavings - periodFlexibleAndDedExp) * 100
          ) / 100
        );

        const rawSlices: PieSliceDatum[] =
          pieDetailMode === 'detailed'
            ? [
                ...effectiveSavingsPillars.map((pillar, idx) => {
                  const vaultAmt = selectedQuarterObj
                    ? selectedQuarterObj.vaultShares[pillar.accountId] || 0
                    : analytics.pillarTotals.get(pillar.accountId)?.transferredIn || 0;
                  return {
                    id: `vault_${pillar.accountId}`,
                    label: `${pillar.baseName} (${pillar.percentage}%)`,
                    group: 'vault' as const,
                    amount: Math.round(vaultAmt * 100) / 100,
                    color:
                      pillar.color ||
                      colorConfig.chartPalette[idx % colorConfig.chartPalette.length],
                  };
                }),
                {
                  id: 'exp_flexible_recorded',
                  label: 'Flexible Expenses (Recorded)',
                  group: 'expense' as const,
                  amount: periodRecordedExp,
                  color: '#e11d48',
                },
                ...(periodDeductionExp > 0
                  ? [
                      {
                        id: 'exp_income_deductions',
                        label: 'Income Deduction Expenses',
                        group: 'expense' as const,
                        amount: periodDeductionExp,
                        color: '#f97316',
                      },
                    ]
                  : []),
              ]
            : [
                {
                  id: 'sum_savings_vaults',
                  label: 'Savings Vaults',
                  group: 'vault' as const,
                  amount: periodSavings,
                  color: colorConfig.primary,
                },
                {
                  id: 'sum_flexible_expenses',
                  label: 'Flexible & Deduction Expenses',
                  group: 'expense' as const,
                  amount: periodFlexibleAndDedExp,
                  color: '#e11d48',
                },
                {
                  id: 'sum_net_retained',
                  label: 'Unspent Net Income Retained',
                  group: 'net' as const,
                  amount: periodNetRetained,
                  color: '#64748b',
                },
              ];

        const activeSlices = rawSlices.filter((s) => s.amount > 0);
        const totalDistributed = activeSlices.reduce((s, item) => s + item.amount, 0);

        let runningDeg = 0;
        const computedPieSlices = activeSlices.map((s) => {
          const sharePct =
            totalDistributed > 0 ? (s.amount / totalDistributed) * 100 : 0;
          const grossPct = periodGross > 0 ? (s.amount / periodGross) * 100 : 0;
          const sweepDeg = (sharePct / 100) * 360;
          const startDeg = runningDeg;
          const endDeg = runningDeg + sweepDeg;
          runningDeg = endDeg;
          return {
            ...s,
            sharePct,
            grossPct,
            startDeg,
            endDeg,
            isFullCircle: sweepDeg >= 359.9,
          };
        });

        const focusedSlice =
          computedPieSlices.find((s) => s.id === hoveredSliceId) || null;

        return (
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
            <div
              onClick={() => setIsPieSectionCollapsed((prev) => !prev)}
              className={`flex items-start justify-between gap-3 cursor-pointer select-none ${
                isPieSectionCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: colorConfig.primary }}
                  />
                  <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                    Quarterly Income Distribution: Savings Vaults vs. Flexible Expenses
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 pl-4 break-words">
                  Compare how quarterly income is distributed across your savings vaults versus flexible expenses
                </p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPieSectionCollapsed((prev) => !prev);
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <span>{isPieSectionCollapsed ? 'Expand' : 'Collapse'}</span>
                <svg
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                    isPieSectionCollapsed ? '' : 'rotate-180'
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

            {!isPieSectionCollapsed && (
              <div className="space-y-5">
                {/* Mobile-Safe Filter Bar: Quarter Filter Pills + Breakdown Mode Toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="grid grid-cols-5 sm:flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                    {(['ALL', 'Q1', 'Q2', 'Q3', 'Q4'] as const).map((qTab) => (
                      <button
                        key={qTab}
                        type="button"
                        onClick={() => setSelectedPieQuarter(qTab)}
                        className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors text-center ${
                          selectedPieQuarter === qTab
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {qTab === 'ALL' ? 'All' : qTab}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setPieDetailMode('detailed')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center ${
                        pieDetailMode === 'detailed'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Vaults vs. Expenses
                    </button>
                    <button
                      type="button"
                      onClick={() => setPieDetailMode('summary')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center ${
                        pieDetailMode === 'summary'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Summary Split
                    </button>
                  </div>
                </div>
                {/* Main Pie Chart + Legend Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                  {/* Left: SVG Pie Chart & Active Slice Readout */}
                  <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50/40 p-5 space-y-3">
                    <div className="relative h-52 w-52 flex items-center justify-center">
                      {computedPieSlices.length === 0 ? (
                        <svg className="h-48 w-48" viewBox="0 0 200 200">
                          <circle
                            cx="100"
                            cy="100"
                            r="84"
                            fill="#f1f5f9"
                            stroke="#e2e8f0"
                            strokeWidth="2"
                          />
                        </svg>
                      ) : (
                        <svg className="h-52 w-52 overflow-visible" viewBox="0 0 200 200">
                          {computedPieSlices.map((slice) => {
                            const isHovered = hoveredSliceId === slice.id;
                            const r = isHovered ? 88 : 84;
                            if (slice.isFullCircle) {
                              return (
                                <circle
                                  key={slice.id}
                                  cx="100"
                                  cy="100"
                                  r={r}
                                  fill={slice.color}
                                  stroke="#ffffff"
                                  strokeWidth="1.5"
                                  className="cursor-pointer transition-all duration-150"
                                  onMouseEnter={() => setHoveredSliceId(slice.id)}
                                  onMouseLeave={() => setHoveredSliceId(null)}
                                >
                                  <title>
                                    {`${slice.label}: ${formatAmount(slice.amount, currency)} (${formatPercent(slice.sharePct)})`}
                                  </title>
                                </circle>
                              );
                            }
                            return (
                              <path
                                key={slice.id}
                                d={describePieWedge(
                                  100,
                                  100,
                                  r,
                                  slice.startDeg,
                                  slice.endDeg
                                )}
                                fill={slice.color}
                                stroke="#ffffff"
                                strokeWidth="1.5"
                                className="cursor-pointer transition-all duration-150"
                                onMouseEnter={() => setHoveredSliceId(slice.id)}
                                onMouseLeave={() => setHoveredSliceId(null)}
                              >
                                <title>
                                  {`${slice.label}: ${formatAmount(slice.amount, currency)} (${formatPercent(slice.sharePct)})`}
                                </title>
                              </path>
                            );
                          })}
                        </svg>
                      )}
                    </div>

                    {/* Focused Slice or Period Summary Readout */}
                    <div className="w-full rounded-lg border border-slate-200/80 bg-white px-3.5 py-2.5 text-center space-y-0.5">
                      {focusedSlice ? (
                        <>
                          <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-900">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: focusedSlice.color }}
                            />
                            <span className="break-words">{focusedSlice.label}</span>
                          </div>
                          <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                            {formatAmount(focusedSlice.amount, currency)} (
                            {formatPercent(focusedSlice.sharePct)} of chart ·{' '}
                            {formatPercent(focusedSlice.grossPct)} of gross)
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            {selectedPieQuarter === 'ALL'
                              ? 'All Quarters Combined'
                              : `${selectedPieQuarter} Allocation Summary`}
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-xs tabular-nums pt-0.5">
                            <span className="text-slate-700">
                              Total Income:{' '}
                              <strong className="text-slate-900">
                                {formatAmount(periodGross, currency)}
                              </strong>
                            </span>
                            <span style={{ color: colorConfig.primary }}>
                              Vaults:{' '}
                              <strong>{formatAmount(periodSavings, currency)}</strong>
                            </span>
                            <span className="text-rose-600">
                              Expenses:{' '}
                              <strong>
                                {formatAmount(periodFlexibleAndDedExp, currency)}
                              </strong>
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Detailed Vaults vs. Flexible Expenses Table / Legend */}
                  <div className="lg:col-span-7 space-y-2.5 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800">
                        {selectedPieQuarter === 'ALL'
                          ? 'Distribution Across Savings Vaults & Flexible Expenses'
                          : `${selectedPieQuarter} Distribution Across Savings Vaults & Flexible Expenses`}
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        Distributed Total: {formatAmount(totalDistributed, currency)}
                      </span>
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
                      {rawSlices.map((item) => {
                        const sharePct =
                          totalDistributed > 0
                            ? (item.amount / totalDistributed) * 100
                            : 0;
                        const grossPct =
                          periodGross > 0 ? (item.amount / periodGross) * 100 : 0;
                        const isHovered = hoveredSliceId === item.id;
                        return (
                          <div
                            key={item.id}
                            onMouseEnter={() =>
                              item.amount > 0 && setHoveredSliceId(item.id)
                            }
                            onMouseLeave={() => setHoveredSliceId(null)}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 px-3.5 py-2.5 text-xs transition-colors ${
                              isHovered ? 'bg-slate-50' : ''
                            }`}
                          >
                            <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                              <span
                                className="mt-0.5 sm:mt-0 h-3 w-3 rounded-sm shrink-0"
                                style={{ backgroundColor: item.color }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-slate-900 break-words">
                                  {item.label}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {item.group === 'vault'
                                    ? 'Savings Vault Allocation'
                                    : item.group === 'expense'
                                    ? 'Flexible / Deduction Outflow'
                                    : 'Retained Operating Cash'}
                                </div>
                              </div>
                            </div>

                            <div className="pl-5 sm:pl-0 sm:text-right font-mono tabular-nums shrink-0 flex sm:block items-baseline justify-between gap-2">
                              <div className="font-semibold text-slate-900">
                                {formatAmount(item.amount, currency)}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {formatPercent(sharePct)} of pie ·{' '}
                                {formatPercent(grossPct)} of gross
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 4-Quarter Pattern Comparison Strip (Q1, Q2, Q3, Q4 Mini Pie Cards) */}
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800">
                      Quarterly Allocation Pattern Comparison (Tap Quarter to Inspect)
                    </span>
                    {selectedPieQuarter !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setSelectedPieQuarter('ALL')}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline"
                      >
                        Show All Quarters Combined
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {analytics.quartersList.map((qItem) => {
                      const qExp =
                        Math.round(
                          (qItem.recordedExpenses + qItem.deductionExpenses) * 100
                        ) / 100;
                      const qSav = qItem.savings;
                      const qDistTotal = qSav + qExp;
                      const qSavAngle =
                        qDistTotal > 0 ? (qSav / qDistTotal) * 360 : 0;
                      const isSelectedQ = selectedPieQuarter === qItem.quarter;

                      return (
                        <button
                          key={qItem.quarter}
                          type="button"
                          onClick={() =>
                            setSelectedPieQuarter(
                              isSelectedQ ? 'ALL' : qItem.quarter
                            )
                          }
                          className={`rounded-xl border p-3 text-left transition-all flex items-center gap-3 ${
                            isSelectedQ
                              ? 'border-slate-900 bg-slate-900/5 ring-1 ring-slate-900'
                              : 'border-slate-200/80 bg-slate-50/50 hover:border-slate-300'
                          }`}
                        >
                          {/* Mini Pie Chart for this Quarter */}
                          <div className="h-12 w-12 shrink-0">
                            <svg className="h-12 w-12" viewBox="0 0 60 60">
                              {qDistTotal <= 0 ? (
                                <circle
                                  cx="30"
                                  cy="30"
                                  r="26"
                                  fill="#e2e8f0"
                                />
                              ) : qSavAngle >= 359.9 ? (
                                <circle
                                  cx="30"
                                  cy="30"
                                  r="26"
                                  fill={colorConfig.primary}
                                />
                              ) : qSavAngle <= 0.1 ? (
                                <circle cx="30" cy="30" r="26" fill="#e11d48" />
                              ) : (
                                <>
                                  <path
                                    d={describePieWedge(
                                      30,
                                      30,
                                      26,
                                      0,
                                      qSavAngle
                                    )}
                                    fill={colorConfig.primary}
                                    stroke="#ffffff"
                                    strokeWidth="1"
                                  />
                                  <path
                                    d={describePieWedge(
                                      30,
                                      30,
                                      26,
                                      qSavAngle,
                                      360
                                    )}
                                    fill="#e11d48"
                                    stroke="#ffffff"
                                    strokeWidth="1"
                                  />
                                </>
                              )}
                            </svg>
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-display font-bold text-slate-900">
                                {qItem.quarter}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                                {qItem.count} {qItem.count === 1 ? 'rec' : 'recs'}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-700 tabular-nums truncate">
                              Vaults: {formatAmount(qSav, currency)}
                            </div>
                            <div className="font-mono text-[11px] text-rose-600 tabular-nums truncate">
                              Expenses: {formatAmount(qExp, currency)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Section 1: Accounts Income vs. Expenses Performance */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsAccountsPerfCollapsed((prev) => !prev)}
          className={`flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none ${
            isAccountsPerfCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Accounts: Income &amp; Expenses
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Per-account inflows, outflows, net flow, and current balance
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!isAccountsPerfCollapsed && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center rounded-lg bg-slate-100 p-0.5"
              >
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'operating', label: 'Operating' },
                    { id: 'vaults', label: 'Vaults' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAccountScopeFilter(tab.id)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      accountScopeFilter === tab.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAccountsPerfCollapsed((prev) => !prev);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <span>{isAccountsPerfCollapsed ? 'Expand' : 'Collapse'}</span>
              <svg
                className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                  isAccountsPerfCollapsed ? '' : 'rotate-180'
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

        {!isAccountsPerfCollapsed && (
          <div className="space-y-4">
            {/* Compact Totals Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Account Inflows (Direct Income)
                </div>
                <div className="mt-0.5 font-mono text-sm font-bold text-emerald-700 tabular-nums">
                  +{formatAmount(accountPerformance.sumInflows, currency)}
                </div>
                <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Direct income: {formatAmount(accountPerformance.sumDirectIncome, currency)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Account Outflows (Direct Expenses)
                </div>
                <div className="mt-0.5 font-mono text-sm font-bold text-rose-600 tabular-nums">
                  -{formatAmount(accountPerformance.sumOutflows, currency)}
                </div>
                <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Direct expenses: {formatAmount(accountPerformance.sumDirectExpenses, currency)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Net Account Flow
                </div>
                <div
                  className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                    accountPerformance.sumNetFlow < 0
                      ? 'text-rose-600'
                      : 'text-emerald-700'
                  }`}
                >
                  {accountPerformance.sumNetFlow >= 0 ? '+' : ''}
                  {formatAmount(accountPerformance.sumNetFlow, currency)}
                </div>
                <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {accountPerformance.rows.length}{' '}
                  {accountPerformance.rows.length === 1 ? 'account' : 'accounts'} shown
                </div>
              </div>
            </div>

            {accountPerformance.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
                No accounts match this filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
                {accountPerformance.rows.map((acc) => {
                  const inflowWidthPct = Math.min(
                    100,
                    Math.round((acc.totalInflows / accountPerformance.maxFlow) * 100)
                  );
                  const outflowWidthPct = Math.min(
                    100,
                    Math.round((acc.totalOutflows / accountPerformance.maxFlow) * 100)
                  );
                  return (
                    <div key={acc.id} className="p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: acc.color }}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {acc.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {acc.isVault ? 'Savings Vault' : acc.type} · {acc.currency}
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div
                            className={`text-sm font-bold ${
                              acc.currentBalance < 0
                                ? 'text-rose-600'
                                : 'text-slate-900'
                            }`}
                          >
                            {formatAmount(acc.currentBalance, currency)}
                          </div>
                          {acc.nativeCurrency !== currency && (
                            <div className="text-[11px] text-slate-500">
                              {formatAmount(acc.nativeBalance, acc.nativeCurrency)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Paired Comparative Bars */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-16 text-[11px] font-medium text-slate-500 shrink-0">
                            Inflows
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-600 transition-all"
                              style={{ width: `${inflowWidthPct}%` }}
                            />
                          </div>
                          <span className="w-28 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums shrink-0">
                            +{formatAmount(acc.totalInflows, currency)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="w-16 text-[11px] font-medium text-slate-500 shrink-0">
                            Outflows
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-rose-500 transition-all"
                              style={{ width: `${outflowWidthPct}%` }}
                            />
                          </div>
                          <span className="w-28 text-right font-mono text-xs font-semibold text-rose-600 tabular-nums shrink-0">
                            -{formatAmount(acc.totalOutflows, currency)}
                          </span>
                        </div>
                      </div>

                      {/* Detail Footer Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums pt-0.5">
                        <span>
                          Income: {formatAmount(acc.directIncome, currency)} · Expenses:{' '}
                          {formatAmount(acc.directExpenses, currency)}
                        </span>
                        <span
                          className={`font-semibold ${
                            acc.netFlow < 0 ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          Net: {acc.netFlow >= 0 ? '+' : ''}
                          {formatAmount(acc.netFlow, currency)} · Expense Ratio:{' '}
                          {formatPercent(acc.expenseRatio)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Key Financial Performance & Efficiency Metrics */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsKeyMetricsCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isKeyMetricsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Key Financial Performance Metrics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Efficiency ratios, burn velocity, cash runway, top cost driver, and budget adherence
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsKeyMetricsCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isKeyMetricsCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isKeyMetricsCollapsed ? '' : 'rotate-180'
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

        {!isKeyMetricsCollapsed && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Metric 1: Savings & Expense Ratios */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Efficiency &amp; Retention
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Savings Rate</span>
                  <span className="font-semibold text-emerald-700">
                    {formatPercent(analytics.effectiveSavingsRate)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Expense / Income</span>
                  <span className="font-semibold text-rose-600">
                    {formatPercent(analytics.totalExpenseRate)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Net Retention</span>
                  <span className="font-semibold text-slate-900">
                    {formatPercent(analytics.netRetentionRate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Metric 2: Spending Velocity & Cash Runway */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Burn Velocity &amp; Runway
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Avg Daily Spend</span>
                  <span className="font-semibold text-slate-900">
                    {formatAmount(keyMetrics.avgDailySpend, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Avg Monthly Spend</span>
                  <span className="font-semibold text-rose-600">
                    {formatAmount(keyMetrics.avgMonthlySpend, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Operating Runway</span>
                  <span className="font-semibold text-emerald-700">
                    {keyMetrics.cashRunwayMonths !== null
                      ? `${keyMetrics.cashRunwayMonths} mo`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Metric 3: Top Cost Driver & Peak Transactions */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Top Driver &amp; Peaks
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 truncate">
                    Top: {keyMetrics.topCategory?.category || '—'}
                  </span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                    {keyMetrics.topCategory
                      ? `${formatPercent(keyMetrics.topCategorySharePct)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 truncate">
                    Peak Exp:{' '}
                    {keyMetrics.largestExpense
                      ? `${keyMetrics.largestExpense.label} (${formatDateDDMMYYYY(
                          keyMetrics.largestExpense.date
                        )})`
                      : '—'}
                  </span>
                  <span className="font-mono font-semibold text-rose-600 tabular-nums shrink-0">
                    {keyMetrics.largestExpense
                      ? formatAmount(keyMetrics.largestExpense.amount, currency)
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 truncate">
                    Peak Inc:{' '}
                    {keyMetrics.largestIncome
                      ? `${keyMetrics.largestIncome.source} (${formatDateDDMMYYYY(
                          keyMetrics.largestIncome.date
                        )})`
                      : '—'}
                  </span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums shrink-0">
                    {keyMetrics.largestIncome
                      ? formatAmount(keyMetrics.largestIncome.amount, currency)
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Metric 4: Budget Adherence & Vault Growth */}
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Budgets &amp; Vault Growth
              </div>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Active Budgets</span>
                  <span className="font-semibold text-slate-900">
                    {keyMetrics.activeBudgetsCount > 0
                      ? `${keyMetrics.healthyBudgets}/${keyMetrics.activeBudgetsCount} on track (${formatPercent(
                          keyMetrics.budgetUtilizationPct
                        )})`
                      : 'None active'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Net Vault Growth</span>
                  <span
                    className={`font-semibold ${
                      keyMetrics.netVaultGrowth < 0
                        ? 'text-rose-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {keyMetrics.netVaultGrowth >= 0 ? '+' : ''}
                    {formatAmount(keyMetrics.netVaultGrowth, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-slate-500">Account Transfers</span>
                  <span className="font-semibold text-blue-600">
                    {keyMetrics.manualTransfersCount} ·{' '}
                    {formatAmount(keyMetrics.manualTransfersVolume, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Month-over-Month Category Spending Bar Chart (Creeping Expense Tracker) */}
      {(() => {
        const activeCategories = analytics.categoryMoMList.filter(
          (c) => c.total > 0 || c.peakMonthly > 0
        );
        const creepingCategories = activeCategories.filter((c) => c.isCreeping);
        const displayedCategories = momFilterCreepingOnly
          ? creepingCategories
          : activeCategories.length > 0
          ? activeCategories
          : analytics.categoryMoMList;
        const globalMaxCategoryMonth = Math.max(
          1,
          ...displayedCategories.map((c) => c.peakMonthly)
        );
        const topCreepingCategory = creepingCategories[0] || null;

        return (
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
            <div
              onClick={() => setIsMoMCategoriesCollapsed((prev) => !prev)}
              className={`flex items-start justify-between gap-3 cursor-pointer select-none ${
                isMoMCategoriesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
              }`}
            >
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-semibold text-slate-900 break-words">
                  Month-over-Month Category Spending
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 break-words">
                  Compare monthly spending by category to spot creeping expenses early ({analytics.prevMoMLabel} vs. {analytics.latestMoMLabel})
                </p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMoMCategoriesCollapsed((prev) => !prev);
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
              >
                <span>{isMoMCategoriesCollapsed ? 'Expand' : 'Collapse'}</span>
                <svg
                  className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                    isMoMCategoriesCollapsed ? '' : 'rotate-180'
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

            {!isMoMCategoriesCollapsed && (
              <div className="space-y-4">
                {/* Mobile-Safe Control Bar: Creeping Filter Toggle + Orientation Mode */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="grid grid-cols-2 sm:flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setMomFilterCreepingOnly(false)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center whitespace-nowrap ${
                        !momFilterCreepingOnly
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All Categories ({activeCategories.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMomFilterCreepingOnly(true)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center whitespace-nowrap ${
                        momFilterCreepingOnly
                          ? 'bg-rose-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Creeping Up ({creepingCategories.length})
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setMomChartMode('by_category')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center whitespace-nowrap ${
                        momChartMode === 'by_category'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      By Category
                    </button>
                    <button
                      type="button"
                      onClick={() => setMomChartMode('by_month')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center whitespace-nowrap ${
                        momChartMode === 'by_month'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      By Month
                    </button>
                  </div>
                </div>
                {/* 3-Metric Creeping Expense Summary Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5">
                  <div>
                    <div className="text-xs text-slate-500">
                      Month-over-Month Total ({analytics.prevMoMLabel} → {analytics.latestMoMLabel})
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-2 font-mono tabular-nums">
                      <span className="text-base font-semibold text-slate-900">
                        {formatAmount(analytics.momTotalLatest, currency)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          analytics.momTotalDelta > 0
                            ? 'text-rose-600'
                            : analytics.momTotalDelta < 0
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {analytics.momTotalDelta > 0 ? '+' : ''}
                        {formatAmount(analytics.momTotalDelta, currency)} (
                        {analytics.momTotalDelta > 0 ? '+' : ''}
                        {formatPercent(analytics.momTotalDeltaPct)})
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">
                      Top Creeping Category
                    </div>
                    {topCreepingCategory ? (
                      <div className="mt-1 flex flex-wrap items-baseline gap-2">
                        <span className="font-display text-sm font-semibold text-slate-900 break-words">
                          {topCreepingCategory.category}
                        </span>
                        <span className="font-mono text-xs font-semibold text-rose-600 tabular-nums">
                          +{formatAmount(topCreepingCategory.deltaAmount, currency)} (+
                          {formatPercent(topCreepingCategory.deltaPct)})
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs font-medium text-emerald-700">
                        No creeping categories in {analytics.latestMoMLabel}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">
                      Creeping Status
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {creepingCategories.length} of {activeCategories.length}{' '}
                      <span className="font-sans text-xs font-normal text-slate-500">
                        categories increased MoM
                      </span>
                    </div>
                    {hoveredMoMBar && (
                      <div className="mt-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {hoveredMoMBar.category} · {hoveredMoMBar.monthLabel}:{' '}
                        {formatAmount(hoveredMoMBar.amount, currency)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Empty / Populated Bar Chart Canvas */}
                {displayedCategories.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-8 px-4 text-center space-y-2">
                    <p className="text-xs text-slate-500">
                      {momFilterCreepingOnly
                        ? `No categories increased in ${analytics.latestMoMLabel} compared to ${analytics.prevMoMLabel}.`
                        : 'Record expenses across categories to compare month-over-month spending.'}
                    </p>
                    {momFilterCreepingOnly && (
                      <button
                        type="button"
                        onClick={() => setMomFilterCreepingOnly(false)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Show All Categories
                      </button>
                    )}
                  </div>
                ) : momChartMode === 'by_category' ? (
                  /* MODE 1: Grouped Monthly Bars per Category (Best for spotting creeping trajectory) */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {displayedCategories.map((cat) => {
                      const catMax = Math.max(1, cat.peakMonthly);
                      const avgLinePct =
                        cat.peakMonthly > 0
                          ? Math.min(96, Math.max(6, Math.round((cat.avgMonthly / catMax) * 100)))
                          : 0;

                      return (
                        <div
                          key={cat.category}
                          className="rounded-xl border border-slate-200/80 bg-white p-3.5 space-y-3 flex flex-col justify-between"
                        >
                          {/* Category Header & MoM Delta Indicator — Mobile-Safe Stacked Layout */}
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                                  style={{ backgroundColor: cat.color }}
                                />
                                <span className="font-display text-sm font-semibold text-slate-900 break-words">
                                  {cat.category}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 pl-4 font-mono tabular-nums">
                                <span>
                                  {analytics.prevMoMLabel}: {formatAmount(cat.prevAmount, currency)}
                                </span>
                                <span>→</span>
                                <span className="font-semibold text-slate-800">
                                  {analytics.latestMoMLabel}: {formatAmount(cat.latestAmount, currency)}
                                </span>
                              </div>
                            </div>

                            <div className="pl-4 sm:pl-0 sm:text-right font-mono tabular-nums shrink-0 flex sm:block flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-1.5 sm:border-0 sm:pt-0">
                              <div
                                className={`text-xs font-semibold ${
                                  cat.deltaAmount > 0
                                    ? 'text-rose-600'
                                    : cat.deltaAmount < 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-500'
                                }`}
                              >
                                {cat.deltaAmount > 0
                                  ? `+${formatAmount(cat.deltaAmount, currency)} (+${formatPercent(cat.deltaPct)})`
                                  : cat.deltaAmount < 0
                                  ? `${formatAmount(cat.deltaAmount, currency)} (${formatPercent(cat.deltaPct)})`
                                  : 'No change MoM'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {cat.deltaAmount > 0
                                  ? 'Creeping Up'
                                  : cat.deltaAmount < 0
                                  ? 'Decreased'
                                  : 'Stable'}{' '}
                                · Avg {formatAmount(cat.avgMonthly, currency)}/mo
                              </div>
                            </div>
                          </div>

                          {/* Multi-Month Vertical Bar Chart for this Category */}
                          <div className="relative rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 sm:px-3 pt-5 pb-2">
                            {/* Dashed Monthly Average Reference Line */}
                            {cat.avgMonthly > 0 && (
                              <div
                                className="pointer-events-none absolute left-2 right-2 border-t border-dashed border-slate-300/90"
                                style={{ bottom: `calc(${avgLinePct * 0.68}% + 22px)` }}
                                title={`Monthly Average: ${formatAmount(cat.avgMonthly, currency)}`}
                              />
                            )}

                            <div className="flex items-end justify-between gap-1.5 sm:gap-2 h-24">
                              {cat.series.map((pt, mIdx) => {
                                const isLatest = mIdx === cat.series.length - 1;
                                const heightPct =
                                  pt.amount > 0
                                    ? Math.max(8, Math.round((pt.amount / catMax) * 100))
                                    : 3;
                                const barColor =
                                  isLatest && cat.isCreeping
                                    ? '#e11d48'
                                    : cat.color;

                                return (
                                  <div
                                    key={pt.month}
                                    className="flex-1 flex flex-col items-center justify-end h-full min-w-0 group"
                                    onMouseEnter={() =>
                                      setHoveredMoMBar({
                                        category: cat.category,
                                        monthLabel: pt.label,
                                        amount: pt.amount,
                                      })
                                    }
                                    onMouseLeave={() => setHoveredMoMBar(null)}
                                  >
                                    <span className="font-mono text-[9px] text-slate-500 tabular-nums mb-1 truncate max-w-full">
                                      {pt.amount > 0 ? (
                                        <>
                                          <span className="sm:hidden">
                                            {formatCompactBarAmount(pt.amount)}
                                          </span>
                                          <span className="hidden sm:inline">
                                            {formatAmount(pt.amount, currency)}
                                          </span>
                                        </>
                                      ) : (
                                        '—'
                                      )}
                                    </span>
                                    <div className="w-full flex items-end justify-center flex-1">
                                      <div
                                        className="w-full max-w-[28px] rounded-t transition-opacity group-hover:opacity-85"
                                        style={{
                                          height: `${heightPct}%`,
                                          backgroundColor:
                                            pt.amount > 0 ? barColor : '#cbd5e1',
                                          opacity:
                                            pt.amount === 0
                                              ? 0.45
                                              : isLatest
                                              ? 1
                                              : 0.72,
                                        }}
                                        title={`${cat.category} (${pt.label}): ${formatAmount(pt.amount, currency)}`}
                                      />
                                    </div>
                                    <span
                                      className={`mt-1.5 font-mono text-[9px] sm:text-[10px] tabular-nums truncate max-w-full ${
                                        isLatest
                                          ? 'font-semibold text-slate-900'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {pt.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* MODE 2: Clustered Category Bars by Month */
                  <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-4">
                    {/* Category Color Legend */}
                    <div className="flex flex-wrap items-center gap-3 text-xs pb-2 border-b border-slate-200/60">
                      {displayedCategories.map((cat) => (
                        <div key={cat.category} className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="font-medium text-slate-700">
                            {cat.category}
                          </span>
                          {cat.isCreeping && (
                            <span className="font-mono text-[10px] font-semibold text-rose-600 tabular-nums">
                              (+{formatPercent(cat.deltaPct)})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Month Columns with Side-by-Side Category Bars */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
                      {analytics.momMonths.map((mObj) => {
                        const monthTotal = displayedCategories.reduce((sum, cat) => {
                          const match = cat.series.find((s) => s.month === mObj.month);
                          return sum + (match?.amount || 0);
                        }, 0);

                        return (
                          <div
                            key={mObj.month}
                            className="rounded-lg border border-slate-200/80 bg-white p-3 space-y-2 flex flex-col justify-between"
                          >
                            <div className="flex items-end justify-center gap-1 h-28 px-1.5 pt-2 bg-slate-50 rounded-md">
                              {displayedCategories.slice(0, 8).map((cat) => {
                                const match = cat.series.find(
                                  (s) => s.month === mObj.month
                                );
                                const amt = match?.amount || 0;
                                const hPct =
                                  amt > 0
                                    ? Math.max(
                                        8,
                                        Math.round(
                                          (amt / globalMaxCategoryMonth) * 100
                                        )
                                      )
                                    : 4;
                                return (
                                  <div
                                    key={cat.category}
                                    className="flex-1 flex flex-col justify-end h-full"
                                    onMouseEnter={() =>
                                      setHoveredMoMBar({
                                        category: cat.category,
                                        monthLabel: mObj.label,
                                        amount: amt,
                                      })
                                    }
                                    onMouseLeave={() => setHoveredMoMBar(null)}
                                  >
                                    <div
                                      className="w-full rounded-t transition-opacity hover:opacity-80"
                                      style={{
                                        height: `${hPct}%`,
                                        backgroundColor:
                                          amt > 0 ? cat.color : '#e2e8f0',
                                      }}
                                      title={`${mObj.label} · ${cat.category}: ${formatAmount(amt, currency)}`}
                                    />
                                  </div>
                                );
                              })}
                            </div>

                            <div className="text-center">
                              <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                {mObj.label}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500 tabular-nums">
                                {formatAmount(monthTotal, currency)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Section 2: Visual Expense Analytics per Category & Subcategory */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsExpenseCategoriesCollapsed((prev) => !prev)}
          className={`flex items-start justify-between gap-3 cursor-pointer select-none ${
            isExpenseCategoriesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Expenses by Category & Subcategory ({analytics.expenseCategoriesList.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Visual breakdown across custom expense categories, subcategories, and income deduction expenses
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpenseCategoriesCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isExpenseCategoriesCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isExpenseCategoriesCollapsed ? '' : 'rotate-180'
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

        {!isExpenseCategoriesCollapsed && (
          <div className="space-y-4">
            {/* Mobile-Safe Expense Source Filter Bar */}
            <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
              {(
                [
                  { id: 'all', label: 'All Expenses' },
                  { id: 'recorded', label: 'Recorded' },
                  { id: 'deductions', label: 'Deductions' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setExpenseFilterMode(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors text-center ${
                    expenseFilterMode === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Multi-Category Stacked Distribution Bar */}
            {analytics.filteredExpenseSum > 0 && (
              <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800">
                    Category Share Distribution
                  </span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    Total: {formatAmount(analytics.filteredExpenseSum, currency)}
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200/70 gap-0.5 p-0.5">
                  {analytics.expenseCategoriesList
                    .filter((c) => c.total > 0)
                    .map((cat, idx) => {
                      const pct =
                        analytics.filteredExpenseSum > 0
                          ? (cat.total / analytics.filteredExpenseSum) * 100
                          : 0;
                      return (
                        <div
                          key={cat.category}
                          className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                          style={{
                            width: `${Math.max(2, pct)}%`,
                            backgroundColor:
                              colorConfig.chartPalette[
                                idx % colorConfig.chartPalette.length
                              ],
                          }}
                          title={`${cat.category}: ${formatAmount(cat.total, currency)} (${formatPercent(pct)})`}
                        />
                      );
                    })}
                </div>
              </div>
            )}

            {analytics.expenseCategoriesList.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-slate-500">
                  No expense categories or recorded expenses yet.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('settings')}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Configure Categories in Settings
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {analytics.expenseCategoriesList.map((cat, idx) => {
                  const shareOfExpenses =
                    analytics.filteredExpenseSum > 0
                      ? (cat.total / analytics.filteredExpenseSum) * 100
                      : 0;
                  const shareOfGross =
                    analytics.totalGross > 0
                      ? (cat.total / analytics.totalGross) * 100
                      : 0;
                  const barColor =
                    colorConfig.chartPalette[
                      idx % colorConfig.chartPalette.length
                    ];

                  return (
                    <div
                      key={cat.category}
                      className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 space-y-2.5 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1.5 sm:gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: barColor }}
                              />
                              <span className="font-display text-sm font-semibold text-slate-900 break-words">
                                {cat.category}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 pl-4">
                              <span>
                                {cat.count} {cat.count === 1 ? 'item' : 'items'}
                              </span>
                              {cat.deductionCount > 0 && (
                                <>
                                  <span>·</span>
                                  <span>{cat.deductionCount} from income deductions</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="pl-4 sm:pl-0 sm:text-right font-mono tabular-nums shrink-0 flex sm:block flex-wrap items-baseline justify-between gap-2">
                            <div className="text-sm font-semibold text-rose-600">
                              -{formatAmount(cat.total, currency)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {formatPercent(shareOfExpenses)} of expenses ·{' '}
                              {formatPercent(shareOfGross)} of gross
                            </div>
                          </div>
                        </div>

                        <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${
                                cat.total > 0
                                  ? Math.min(100, Math.max(3, shareOfExpenses))
                                  : 0
                              }%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                      </div>

                      {/* Subcategory Visual Breakdown */}
                      {cat.subcategoriesList.length > 0 && (
                        <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Subcategories ({cat.subcategoriesList.length})
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {cat.subcategoriesList.map((sub) => {
                              const subPct =
                                cat.total > 0 ? (sub.total / cat.total) * 100 : 0;
                              const subColor = resolveIntuitiveSubcategoryColor(
                                sub.name,
                                cat.category,
                                settings,
                                expenses
                              );
                              const subBadge = getSubcategoryBadgeStyle(subColor);
                              return (
                                <div
                                  key={sub.name}
                                  style={{
                                    backgroundColor: subBadge.backgroundColor,
                                    borderColor: subBadge.borderColor,
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]"
                                >
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: subColor }}
                                  />
                                  <span
                                    className="font-semibold break-words"
                                    style={{ color: subBadge.color }}
                                  >
                                    {sub.name}
                                  </span>
                                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                    {formatAmount(sub.total, currency)}
                                  </span>
                                  {cat.total > 0 && (
                                    <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                                      ({formatPercent(subPct)})
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Causes / Recipients ("To") & Deducted Account Distribution */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsRecipientsCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isRecipientsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Causes, Recipients ("To") & Account Outflows ({analytics.recipientsList.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Where expenses and savings vault causes (e.g. Treasury Bond, Mutual Funds, Lands) are deployed
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsRecipientsCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isRecipientsCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isRecipientsCollapsed ? '' : 'rotate-180'
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

        {!isRecipientsCollapsed && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT: Recipients / Causes ("To") */}
            <div className="lg:col-span-7 space-y-2.5 min-w-0">
              <div className="text-xs font-semibold text-slate-700">
                Top Causes & Recipients ("To")
              </div>
              {analytics.recipientsList.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No recipient or cause transactions in selected range
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
                  {analytics.recipientsList.slice(0, 10).map((rec, idx) => {
                    const share =
                      analytics.filteredExpenseSum > 0
                        ? (rec.total / analytics.filteredExpenseSum) * 100
                        : 0;
                    const barColor =
                      colorConfig.chartPalette[
                        idx % colorConfig.chartPalette.length
                      ];
                    return (
                      <div key={rec.recipient} className="p-3 text-xs space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-slate-900 break-words">
                                To: {rec.recipient}
                              </span>
                              {rec.isVaultCause && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Vault Cause Deployment
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 break-words">
                              {rec.categoryList.join(', ')} · {rec.count}x
                            </div>
                          </div>

                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-semibold text-rose-600">
                              -{formatAmount(rec.total, currency)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatPercent(share)}
                            </div>
                          </div>
                        </div>

                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(3, share))}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT: Outflows by Deducted Account */}
            <div className="lg:col-span-5 space-y-2.5 min-w-0">
              <div className="text-xs font-semibold text-slate-700">
                Expenses Deducted per Account
              </div>
              {analytics.accountOutflowsList.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  No account outflows in selected range
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
                  {analytics.accountOutflowsList.map((accOut, idx) => {
                    const share =
                      analytics.filteredExpenseSum > 0
                        ? (accOut.total / analytics.filteredExpenseSum) * 100
                        : 0;
                    const barColor =
                      colorConfig.chartPalette[
                        idx % colorConfig.chartPalette.length
                      ];
                    return (
                      <div key={accOut.accountId} className="p-3 text-xs space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 break-words">
                              {accOut.accountName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {accOut.isVault ? 'Savings Vault' : 'Operating Account'} ·{' '}
                              {accOut.count} items
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-semibold text-rose-600">
                              -{formatAmount(accOut.total, currency)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatPercent(share)}
                            </div>
                          </div>
                        </div>

                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(3, share))}%`,
                              backgroundColor: barColor,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 4: 7-Vault Savings Split Transfers & Holding Accounts (30 · 15 · 5 · 20 · 10 · 15 · 5) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsVaultsCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isVaultsCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Savings Split Transfers & Vaults
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Transfers from savings deductions, holding accounts, cause deployments, and available vault balances
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsVaultsCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isVaultsCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isVaultsCollapsed ? '' : 'rotate-180'
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

        {!isVaultsCollapsed && (
          <div className="space-y-4">
            {/* Visual 7-Pillar Proportional Split Bar */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 gap-0.5">
              {effectiveSavingsPillars.map((pillar, idx) => (
                <div
                  key={pillar.bucketId}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                  style={{
                    width: `${pillar.percentage}%`,
                    backgroundColor:
                      colorConfig.chartPalette[
                        idx % colorConfig.chartPalette.length
                      ],
                  }}
                  title={`${pillar.name}: ${pillar.percentage}%`}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {effectiveSavingsPillars.map((pillar, idx) => {
                const summary = summaries.find(
                  (s) => s.account.id === pillar.accountId
                );
                const pillarStat = analytics.pillarTotals.get(pillar.accountId) || {
                  count: 0,
                  transferredIn: 0,
                  causeCreditsOut: 0,
                };
                const currentBalance = summary ? summary.currentCashBalance : 0;
                const custodianId =
                  settings.vaultCustodianAccounts?.[pillar.accountId] ||
                  summary?.account.custodianAccountId;
                const custodianAcc = accounts.find((a) => a.id === custodianId);
                const barColor =
                  colorConfig.chartPalette[idx % colorConfig.chartPalette.length];

                return (
                  <div
                    key={pillar.bucketId}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: barColor }}
                          />
                          <span className="font-display font-semibold text-slate-900 break-words">
                            {pillar.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 pl-4 break-words">
                          {custodianAcc
                            ? `Saved in: ${custodianAcc.name}`
                            : 'Holding account unassigned'}
                        </div>
                      </div>
                      <span className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 shrink-0">
                        {pillar.percentage}%
                      </span>
                    </div>

                    <div className="space-y-1 font-mono text-[11px] tabular-nums pt-2 border-t border-slate-200/60">
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-slate-500">
                          Transferred In ({pillarStat.count}x)
                        </span>
                        <span
                          className="font-semibold"
                          style={{ color: colorConfig.primary }}
                        >
                          +{formatAmount(pillarStat.transferredIn, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-slate-500">
                          Net Debited to Causes
                        </span>
                        <span className="text-rose-600">
                          -{formatAmount(pillarStat.causeCreditsOut, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 pt-1 border-t border-slate-200/60 font-semibold">
                        <span className="font-sans text-slate-800">
                          Vault Balance
                        </span>
                        <span
                          className={
                            currentBalance < 0
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }
                        >
                          {formatAmount(currentBalance, currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Section 5: Income Sources */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsSourcesCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isSourcesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <h2 className="font-display text-base font-semibold text-slate-900 break-words">
            Income Sources ({analytics.sourcesList.length})
          </h2>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSourcesCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isSourcesCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isSourcesCollapsed ? '' : 'rotate-180'
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

        {!isSourcesCollapsed && (
          <>
            {analytics.sourcesList.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                No income sources in selected range
              </div>
            ) : (
              <div className="space-y-2.5">
                {analytics.sourcesList.map((src, idx) => {
                  const sharePct =
                    analytics.totalGross > 0
                      ? (src.gross / analytics.totalGross) * 100
                      : 0;
                  const barColor =
                    colorConfig.chartPalette[idx % colorConfig.chartPalette.length];
                  return (
                    <div
                      key={src.source}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/40 p-3.5 space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: barColor }}
                          />
                          <span className="font-display text-sm font-semibold text-slate-900 break-words">
                            {src.source}
                          </span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500 shrink-0">
                            {src.count} {src.count === 1 ? 'record' : 'records'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-x-3 gap-y-1 pl-4 sm:pl-0 font-mono text-xs tabular-nums">
                          <span className="font-semibold text-slate-900">
                            {formatAmount(src.gross, currency)} ({formatPercent(sharePct)})
                          </span>
                          <span
                            className="font-medium"
                            style={{ color: colorConfig.primary }}
                          >
                            Savings: {formatAmount(src.savingsTransferred, currency)}
                          </span>
                          <span className="text-rose-600">
                            Expenses: -{formatAmount(src.deductionExpenses, currency)}
                          </span>
                          <span className="font-semibold text-slate-900">
                            Net: {formatAmount(src.netRetained, currency)}
                          </span>
                        </div>
                      </div>

                      <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(2, sharePct))}%`,
                            backgroundColor: barColor,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Section 6: Quarterly & Monthly Summary (Collapsed by Default) */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsTimelineCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isTimelineCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <h2 className="font-display text-base font-semibold text-slate-900 break-words">
            Quarterly & Monthly Ledger Breakdown
          </h2>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsTimelineCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <span>{isTimelineCollapsed ? 'Expand' : 'Collapse'}</span>
            <svg
              className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
                isTimelineCollapsed ? '' : 'rotate-180'
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

        {!isTimelineCollapsed && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {analytics.quartersList.map((q) => {
                const shareOfPeak =
                  maxQuarterGross > 0
                    ? Math.round((q.gross / maxQuarterGross) * 100)
                    : 0;
                const totalQExp = q.deductionExpenses + q.recordedExpenses;
                return (
                  <div
                    key={q.quarter}
                    className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-bold text-slate-900">
                        {q.quarter}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {q.count} {q.count === 1 ? 'record' : 'records'}
                      </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-slate-200/70 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${q.gross > 0 ? Math.max(4, shareOfPeak) : 0}%`,
                          backgroundColor: colorConfig.primary,
                        }}
                      />
                    </div>

                    <div className="space-y-1 font-mono text-xs tabular-nums pt-1 border-t border-slate-200/60">
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-slate-500">Total Income</span>
                        <span className="font-medium text-slate-900">
                          {formatAmount(q.gross, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-slate-500">
                          Savings Accumulated
                        </span>
                        <span style={{ color: colorConfig.primary }}>
                          +{formatAmount(q.savings, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="font-sans text-slate-500">
                          Total Expenses
                        </span>
                        <span className="text-rose-600">
                          -{formatAmount(totalQExp, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 pt-1 border-t border-slate-200/60 font-semibold">
                        <span className="font-sans text-slate-700">Net</span>
                        <span className="text-slate-900">
                          {formatAmount(q.net, currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Section 7: Recent Expense Transactions with Direct Edit */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 sm:p-5">
        <div
          onClick={() => setIsRecentExpensesCollapsed((prev) => !prev)}
          className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
            isRecentExpensesCollapsed ? '' : 'border-b border-slate-100 pb-3.5 mb-4'
          }`}
        >
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 break-words">
              Expense Transactions ({filteredExpensesForAnalysis.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              Sorted by arrival time (dd/mm/yyyy) · Edit any expense transaction directly
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsRecentExpensesCollapsed((prev) => !prev);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
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

        {!isRecentExpensesCollapsed && (
          <div className="space-y-2">
            {recentExpensesSlice.map((exp) => {
              const acc = exp.accountId
                ? accountByIdMap.get(exp.accountId)
                : undefined;
              const { baseAmount } = getExpenseNativeAndBaseAmount(
                exp,
                settings,
                accounts,
                fxSnapshot
              );
              const subLabel =
                exp.subcategory?.trim() ||
                exp.category?.trim() ||
                'Expense';
              const subColor =
                recentSubcategoryColorMap.get(
                  `${exp.category || ''}::${subLabel}`
                ) || '#e11d48';
              return (
                <RecordCard
                  key={exp.id}
                  topLeftSubcategory={subLabel}
                  subcategoryColor={subColor}
                  bottomLeftAccount={acc?.name || 'Account'}
                  topRightAmount={`-${formatAmount(baseAmount, currency)}`}
                  recordType="expense"
                  bottomRightDate={formatDateDDMMYYYY(exp.date)}
                  onClick={() => setSelectedPopupExpense(exp)}
                />
              );
            })}

            {filteredExpensesForAnalysis.length > visibleRecentCount && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
                <span className="font-mono text-slate-600 tabular-nums">
                  Showing {recentExpensesSlice.length} of{' '}
                  {filteredExpensesForAnalysis.length} expenses
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleRecentCount((prev) => prev + 30)}
                    className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    Load 30 More
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleRecentCount(filteredExpensesForAnalysis.length)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    Show All
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expense Record Detail Pop-Up Modal */}
      <ExpenseDetailPopupModal
        expense={selectedPopupExpense}
        accounts={accounts}
        settings={settings}
        currency={currency}
        onClose={() => setSelectedPopupExpense(null)}
        onEditExpense={onEditExpense}
        onDeleteExpense={onDeleteExpense}
      />
    </div>
  );
};
