/**
 * Budget Evaluation, Subcategory Residual Visuals, and Real-Time Spend & Account Check Engine
 */

import {
  FinancialBudget,
  FlexibleExpense,
  IncomeReceipt,
  FinancialAccount,
  AccountTransfer,
  UserSettings,
} from '../types/finance.ts';
import {
  calculateAccountSummaries,
  getIncomeDeductionExpenses,
  getSavingsSplitTransfers,
  isSavingsVaultAccount,
  resolveIntuitiveSubcategoryColor,
} from './calculations.ts';
import {
  convertCurrency2dp,
  getAccountCurrency,
  getAccountNativeBalance,
  roundTo2Decimals,
  MarketFxSnapshot,
} from './currencyService.ts';
import {
  parseLocalCalendarDate,
  formatDateDDMMYYYY,
  sortRecordsByArrivalTime,
} from './dateFilters.ts';

export type BudgetHealthStatus = 'healthy' | 'warning' | 'at_limit' | 'exceeded';

export interface BudgetPeriodWindow {
  startDate: Date;
  endDate: Date;
  startYmd: string;
  endYmd: string;
  label: string;
  periodBadge: string;
  daysRemaining: number;
  totalDays: number;
}

export interface BudgetSubcategoryBreakdown {
  subcategory: string;
  color: string;
  spentAmount: number; // In budget.currency
  spentAmountBase: number; // In settings.currency
  shareOfBudgetPercent: number; // % of total budget limit consumed by this subcategory
  shareOfSpentPercent: number; // % of total spent consumed by this subcategory
  transactionCount: number;
}

export interface EvaluatedBudget {
  budget: FinancialBudget;
  purposeType: 'budget' | 'goal';
  periodWindow: BudgetPeriodWindow;
  budgetLimit: number; // In budget.currency
  budgetLimitBase: number; // In settings.currency
  spentAmount: number; // In budget.currency (for Goal: achieved/funded amount)
  spentAmountBase: number; // In settings.currency
  residualAmount: number; // budgetLimit - spentAmount (for Goal: remaining to target)
  residualAmountBase: number; // budgetLimitBase - spentAmountBase
  usagePercentage: number; // (spentAmount / budgetLimit) * 100
  clampedProgressPercent: number; // 0..100
  residualPercent: number; // 100 - clampedProgressPercent
  overageAmount: number; // max(0, spentAmount - budgetLimit)
  overagePercent: number; // max(0, usagePercentage - 100)
  alertThresholdPercent: number;
  status: BudgetHealthStatus;
  isGoalMet: boolean;
  isExpired: boolean;
  isDisabledFromReach: boolean;
  recreateDays: number;
  conversionRateToBase: number;
  inverseConversionRateToBase: number;
  subcategoryBreakdowns: BudgetSubcategoryBreakdown[];
  matchedExpenses: FlexibleExpense[];
  matchedTransfers: AccountTransfer[];
  linkedAccount?: FinancialAccount;
}

export interface SpendBudgetCheckItem {
  budget: FinancialBudget;
  periodLabel: string;
  budgetLimit: number;
  spentBefore: number;
  additionalSpend: number;
  projectedSpent: number;
  residualBefore: number;
  projectedResidual: number;
  percentageBefore: number;
  projectedPercentage: number;
  statusBefore: BudgetHealthStatus;
  projectedStatus: BudgetHealthStatus;
}

export interface SpendAccountCheckResult {
  account: FinancialAccount;
  accountCurrency: string;
  balanceBefore: number;
  spendInAccountCurrency: number;
  projectedBalance: number;
  status: 'sufficient' | 'low_balance' | 'overdrawn';
  custodianAccount?: FinancialAccount;
  custodianCurrency?: string;
  custodianBalanceBefore?: number;
  custodianProjectedBalance?: number;
}

export interface SpendCheckEvaluation {
  accountCheck: SpendAccountCheckResult | null;
  budgetChecks: SpendBudgetCheckItem[];
  hasOverdrawnAccount: boolean;
  hasLowBalanceAccount: boolean;
  hasExceededBudget: boolean;
  hasWarningBudget: boolean;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDate(d: Date): string {
  return formatDateDDMMYYYY(toYmd(d));
}

export function getDefaultRecreateDaysForPeriod(
  periodType: 'weekly' | 'monthly' | 'yearly' | 'custom',
  customStartDate?: string,
  customEndDate?: string
): number {
  if (periodType === 'weekly') return 7;
  if (periodType === 'monthly') return 30;
  if (periodType === 'yearly') return 365;
  if (customStartDate && customEndDate) {
    const s = parseLocalCalendarDate(customStartDate);
    const e = parseLocalCalendarDate(customEndDate);
    if (s && e && e.getTime() >= s.getTime()) {
      return Math.max(
        1,
        Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
      );
    }
  }
  return 30;
}

/**
 * Computes the exact start and end dates for a recurring period ('weekly', 'monthly', or 'yearly')
 * relative to a given reference date.
 */
export function computeRecurringPeriodBounds(
  periodType: 'weekly' | 'monthly' | 'yearly',
  referenceDate: Date = new Date()
): { startDate: Date; endDate: Date; startYmd: string; endYmd: string; periodBadge: string } {
  const refDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0
  );

  let startDate: Date;
  let endDate: Date;
  let periodBadge = 'Monthly';

  if (periodType === 'weekly') {
    periodBadge = 'Weekly';
    const dayOfWeek = refDay.getDay(); // 0 (Sun) .. 6 (Sat)
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate = new Date(refDay);
    startDate.setDate(refDay.getDate() + diffToMonday);
    startDate.setHours(0, 0, 0, 0);

    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
  } else if (periodType === 'yearly') {
    periodBadge = 'Yearly';
    startDate = new Date(refDay.getFullYear(), 0, 1, 0, 0, 0, 0);
    endDate = new Date(refDay.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else {
    periodBadge = 'Monthly';
    startDate = new Date(refDay.getFullYear(), refDay.getMonth(), 1, 0, 0, 0, 0);
    endDate = new Date(
      refDay.getFullYear(),
      refDay.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
  }

  return {
    startDate,
    endDate,
    startYmd: toYmd(startDate),
    endYmd: toYmd(endDate),
    periodBadge,
  };
}

/**
 * Resolves the active start and end calendar dates for a budget:
 * - 'weekly': Monday 00:00:00 through Sunday 23:59:59 (or locked activePeriodStart..activePeriodEnd)
 * - 'monthly': 1st of month through last day of month (or locked activePeriodStart..activePeriodEnd)
 * - 'yearly': Jan 1 through Dec 31 of the year (or locked activePeriodStart..activePeriodEnd)
 * - 'custom': budget.customStartDate through budget.customEndDate (or activePeriodStart..activePeriodEnd)
 */
export function resolveBudgetPeriodWindow(
  budget: FinancialBudget,
  referenceDate: Date = new Date()
): BudgetPeriodWindow {
  const refDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0
  );

  let startDate: Date;
  let endDate: Date;
  let periodBadge = 'Monthly';

  if (budget.periodType === 'custom') {
    periodBadge = 'Custom Period';
    const rawStart = budget.activePeriodStart || budget.customStartDate;
    const rawEnd = budget.activePeriodEnd || budget.customEndDate;
    const parsedStart = rawStart ? parseLocalCalendarDate(rawStart) : null;
    const parsedEnd = rawEnd ? parseLocalCalendarDate(rawEnd) : null;

    startDate = parsedStart
      ? new Date(
          parsedStart.getFullYear(),
          parsedStart.getMonth(),
          parsedStart.getDate(),
          0,
          0,
          0,
          0
        )
      : new Date(refDay.getFullYear(), refDay.getMonth(), 1, 0, 0, 0, 0);

    endDate = parsedEnd
      ? new Date(
          parsedEnd.getFullYear(),
          parsedEnd.getMonth(),
          parsedEnd.getDate(),
          23,
          59,
          59,
          999
        )
      : new Date(refDay.getFullYear(), refDay.getMonth() + 1, 0, 23, 59, 59, 999);

    if (endDate.getTime() < startDate.getTime()) {
      const temp = startDate;
      startDate = endDate;
      endDate = new Date(
        temp.getFullYear(),
        temp.getMonth(),
        temp.getDate(),
        23,
        59,
        59,
        999
      );
    }
  } else {
    const recurringType: 'weekly' | 'monthly' | 'yearly' =
      budget.periodType === 'weekly' || budget.periodType === 'yearly'
        ? budget.periodType
        : 'monthly';
    const computed = computeRecurringPeriodBounds(recurringType, refDay);
    periodBadge = computed.periodBadge;

    const lockedStart = budget.activePeriodStart
      ? parseLocalCalendarDate(budget.activePeriodStart)
      : null;
    const lockedEnd = budget.activePeriodEnd
      ? parseLocalCalendarDate(budget.activePeriodEnd)
      : null;

    if (lockedStart && lockedEnd) {
      startDate = new Date(
        lockedStart.getFullYear(),
        lockedStart.getMonth(),
        lockedStart.getDate(),
        0,
        0,
        0,
        0
      );
      endDate = new Date(
        lockedEnd.getFullYear(),
        lockedEnd.getMonth(),
        lockedEnd.getDate(),
        23,
        59,
        59,
        999
      );
    } else {
      startDate = computed.startDate;
      endDate = computed.endDate;
    }
  }

  const endMidnight = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    0,
    0,
    0,
    0
  );
  const startMidnight = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    0,
    0,
    0,
    0
  );

  const totalDays = Math.max(
    1,
    Math.round(
      (endMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
  );
  const daysRemaining =
    refDay.getTime() > endMidnight.getTime()
      ? 0
      : Math.max(
          0,
          Math.round(
            (endMidnight.getTime() - refDay.getTime()) / (1000 * 60 * 60 * 24)
          ) + 1
        );

  return {
    startDate,
    endDate,
    startYmd: toYmd(startDate),
    endYmd: toYmd(endDate),
    label: `${formatShortDate(startDate)} – ${formatShortDate(endDate)}`,
    periodBadge,
    daysRemaining,
    totalDays,
  };
}

/**
 * Reconciles budgets and goals when their active date period expires:
 * - If `autoRecreate` is enabled, recreates the budget/goal for the configured `recreateDays` duration
 *   (or standard period bounds) and archives the completed period.
 * - If `autoRecreate` is NOT enabled (`!b.autoRecreate`), marks the expired budget as `isExpiredDisabled: true`
 *   so it is disabled from active reach and placed in the Expired / Disabled tab.
 */
export function reconcileRecurringBudgets(
  budgets: FinancialBudget[],
  referenceDate: Date = new Date()
): {
  nextBudgets: FinancialBudget[];
  changedBudgets: FinancialBudget[];
  hasChanges: boolean;
} {
  const todayYmd = toYmd(referenceDate);
  const nowIso = referenceDate.toISOString();
  const nextBudgets: FinancialBudget[] = [];
  const changedBudgets: FinancialBudget[] = [];
  const newlyCreatedBudgets: FinancialBudget[] = [];

  for (let i = 0; i < budgets.length; i++) {
    const b = budgets[i];
    if (b.isArchivedPeriod) {
      nextBudgets.push(b);
      continue;
    }

    const window = resolveBudgetPeriodWindow(b, referenceDate);
    let assignedStart = b.activePeriodStart || window.startYmd;
    let assignedEnd = b.activePeriodEnd || window.endYmd;

    if (b.periodType !== 'custom' && (!b.activePeriodStart || !b.activePeriodEnd)) {
      const recurringType: 'weekly' | 'monthly' | 'yearly' =
        b.periodType === 'weekly' || b.periodType === 'yearly'
          ? b.periodType
          : 'monthly';
      const createdDate = b.createdAt
        ? parseLocalCalendarDate(b.createdAt.substring(0, 10))
        : null;
      const initialBounds = computeRecurringPeriodBounds(
        recurringType,
        createdDate || referenceDate
      );
      assignedStart = initialBounds.startYmd;
      assignedEnd = initialBounds.endYmd;
    }

    // Check if the budget's period has expired (todayYmd > assignedEnd)
    // Weekly, Monthly, and Yearly periods recreate automatically; Custom periods require explicit autoRecreate
    if (todayYmd > assignedEnd) {
      const shouldAutoRecreate =
        b.periodType !== 'custom' ? true : Boolean(b.autoRecreate);

      if (!shouldAutoRecreate) {
        // Without autoRecreate enabled (Custom period): disable from active reach and place in Expired tab
        if (!b.isExpiredDisabled || b.activePeriodStart !== assignedStart || b.activePeriodEnd !== assignedEnd) {
          const expiredBudget: FinancialBudget = {
            ...b,
            activePeriodStart: assignedStart,
            activePeriodEnd: assignedEnd,
            isExpiredDisabled: true,
            updatedAt: nowIso,
          };
          nextBudgets.push(expiredBudget);
          changedBudgets.push(expiredBudget);
        } else {
          nextBudgets.push(b);
        }
        continue;
      }

      // Auto-recreate is enabled: compute new period window using recreateDays (or periodType bounds)
      const configuredDays =
        b.recreateDays !== undefined && Number(b.recreateDays) > 0
          ? Math.max(1, Math.round(Number(b.recreateDays)))
          : getDefaultRecreateDaysForPeriod(
              b.periodType,
              b.customStartDate,
              b.customEndDate
            );

      let newStartYmd: string;
      let newEndYmd: string;

      const prevEndDate = parseLocalCalendarDate(assignedEnd);
      if (b.periodType !== 'custom') {
        const recurringType: 'weekly' | 'monthly' | 'yearly' =
          b.periodType === 'weekly' || b.periodType === 'yearly'
            ? b.periodType
            : 'monthly';
        const currentBounds = computeRecurringPeriodBounds(
          recurringType,
          referenceDate
        );
        newStartYmd = currentBounds.startYmd;
        newEndYmd = currentBounds.endYmd;
      } else if (b.recreateDays !== undefined && Number(b.recreateDays) > 0) {
        // Advance in increments of configuredDays until the new window covers todayYmd
        let cycleStart = prevEndDate
          ? new Date(
              prevEndDate.getFullYear(),
              prevEndDate.getMonth(),
              prevEndDate.getDate() + 1,
              0,
              0,
              0,
              0
            )
          : new Date(
              referenceDate.getFullYear(),
              referenceDate.getMonth(),
              referenceDate.getDate(),
              0,
              0,
              0,
              0
            );
        let cycleEnd = new Date(cycleStart);
        cycleEnd.setDate(cycleStart.getDate() + configuredDays - 1);

        while (toYmd(cycleEnd) < todayYmd) {
          cycleStart = new Date(cycleEnd);
          cycleStart.setDate(cycleEnd.getDate() + 1);
          cycleEnd = new Date(cycleStart);
          cycleEnd.setDate(cycleStart.getDate() + configuredDays - 1);
        }

        newStartYmd = toYmd(cycleStart);
        newEndYmd = toYmd(cycleEnd);
      } else {
        const startD = new Date(
          referenceDate.getFullYear(),
          referenceDate.getMonth(),
          referenceDate.getDate(),
          0,
          0,
          0,
          0
        );
        const endD = new Date(startD);
        endD.setDate(startD.getDate() + configuredDays - 1);
        newStartYmd = toYmd(startD);
        newEndYmd = toYmd(endD);
      }

      const archivedBudget: FinancialBudget = {
        ...b,
        activePeriodStart: assignedStart,
        activePeriodEnd: assignedEnd,
        isArchivedPeriod: true,
        isExpiredDisabled: false,
        updatedAt: nowIso,
      };
      nextBudgets.push(archivedBudget);
      changedBudgets.push(archivedBudget);

      const seriesRootId = b.parentRecurringBudgetId || b.id;
      const alreadyRecreated =
        budgets.some(
          (other) =>
            !other.isArchivedPeriod &&
            other.activePeriodStart === newStartYmd &&
            other.activePeriodEnd === newEndYmd &&
            (other.parentRecurringBudgetId === seriesRootId ||
              other.name.toLowerCase() === b.name.toLowerCase())
        ) ||
        newlyCreatedBudgets.some(
          (nb) =>
            nb.activePeriodStart === newStartYmd &&
            nb.activePeriodEnd === newEndYmd &&
            nb.parentRecurringBudgetId === seriesRootId
        );

      if (!alreadyRecreated) {
        const recreatedBudget: FinancialBudget = {
          ...b,
          id: `bgt_rec_${Date.now()}_${i}`,
          customStartDate:
            b.periodType === 'custom' ? newStartYmd : b.customStartDate,
          customEndDate:
            b.periodType === 'custom' ? newEndYmd : b.customEndDate,
          activePeriodStart: newStartYmd,
          activePeriodEnd: newEndYmd,
          autoRecreate: true,
          recreateDays: configuredDays,
          parentRecurringBudgetId: seriesRootId,
          isArchivedPeriod: false,
          isExpiredDisabled: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        newlyCreatedBudgets.push(recreatedBudget);
        changedBudgets.push(recreatedBudget);
      }
    } else if (
      b.activePeriodStart !== assignedStart ||
      b.activePeriodEnd !== assignedEnd ||
      b.isExpiredDisabled
    ) {
      const stampedBudget: FinancialBudget = {
        ...b,
        activePeriodStart: assignedStart,
        activePeriodEnd: assignedEnd,
        isExpiredDisabled: false,
      };
      nextBudgets.push(stampedBudget);
      changedBudgets.push(stampedBudget);
    } else {
      nextBudgets.push(b);
    }
  }

  const combined = [...newlyCreatedBudgets, ...nextBudgets];
  return {
    nextBudgets: combined,
    changedBudgets,
    hasChanges: changedBudgets.length > 0,
  };
}

export function isDateWithinBudgetWindow(
  dateStr: string | undefined | null,
  window: BudgetPeriodWindow
): boolean {
  if (!dateStr) return false;
  const parsed = parseLocalCalendarDate(dateStr);
  if (!parsed) return false;
  const t = parsed.getTime();
  return t >= window.startDate.getTime() && t <= window.endDate.getTime();
}

export function normalizeSubcategoryKey(sub?: string): string {
  return (sub || '').trim().toLowerCase();
}

function getExpenseAmountInCurrency(
  exp: FlexibleExpense,
  targetCurrency: string,
  baseCurrency: string,
  accounts: FinancialAccount[],
  fxSnapshot?: MarketFxSnapshot
): number {
  const targetUpper = (targetCurrency || baseCurrency).toUpperCase();
  const baseUpper = (baseCurrency || 'GHS').toUpperCase();
  const matchedAcc = exp.accountId
    ? accounts.find((a) => a.id === exp.accountId)
    : undefined;
  const expCurr = (
    exp.currency || getAccountCurrency(matchedAcc, baseUpper)
  ).toUpperCase();
  const rawNativeAmt =
    exp.originalAmount !== undefined && exp.originalAmount > 0
      ? Number(exp.originalAmount)
      : Number(exp.amount || 0);

  if (expCurr === targetUpper) {
    return roundTo2Decimals(rawNativeAmt);
  }
  if (
    targetUpper === baseUpper &&
    exp.originalAmount !== undefined &&
    exp.originalAmount > 0 &&
    exp.amount > 0 &&
    Math.abs(exp.amount - exp.originalAmount) > 0.001
  ) {
    return roundTo2Decimals(Number(exp.amount));
  }
  return convertCurrency2dp(rawNativeAmt, expCurr, targetUpper, fxSnapshot)
    .convertedAmount;
}

function getTransferAmountInCurrency(
  tr: AccountTransfer,
  targetCurrency: string,
  baseCurrency: string,
  accounts: FinancialAccount[],
  fxSnapshot?: MarketFxSnapshot
): number {
  const targetUpper = (targetCurrency || baseCurrency).toUpperCase();
  const baseUpper = (baseCurrency || 'GHS').toUpperCase();
  const destAcc = tr.destinationAccountId
    ? accounts.find((a) => a.id === tr.destinationAccountId)
    : undefined;
  const srcAcc = tr.sourceAccountId
    ? accounts.find((a) => a.id === tr.sourceAccountId)
    : undefined;

  if (
    tr.destinationAmount !== undefined &&
    tr.destinationAmount > 0 &&
    tr.destinationCurrency
  ) {
    const destCurr = tr.destinationCurrency.toUpperCase();
    if (destCurr === targetUpper) {
      return roundTo2Decimals(Number(tr.destinationAmount));
    }
    if (
      tr.sourceCurrency &&
      tr.sourceCurrency.toUpperCase() === targetUpper &&
      tr.sourceAmount !== undefined &&
      tr.sourceAmount > 0
    ) {
      return roundTo2Decimals(Number(tr.sourceAmount));
    }
    return convertCurrency2dp(
      Number(tr.destinationAmount),
      destCurr,
      targetUpper,
      fxSnapshot
    ).convertedAmount;
  }

  if (
    tr.sourceAmount !== undefined &&
    tr.sourceAmount > 0 &&
    tr.sourceCurrency
  ) {
    const srcCurr = tr.sourceCurrency.toUpperCase();
    if (srcCurr === targetUpper) {
      return roundTo2Decimals(Number(tr.sourceAmount));
    }
    return convertCurrency2dp(
      Number(tr.sourceAmount),
      srcCurr,
      targetUpper,
      fxSnapshot
    ).convertedAmount;
  }

  const trCurr = (
    tr.sourceCurrency ||
    getAccountCurrency(destAcc || srcAcc, baseUpper)
  ).toUpperCase();
  const rawAmt = Number(tr.amount || 0);
  if (trCurr === targetUpper) {
    return roundTo2Decimals(rawAmt);
  }
  return convertCurrency2dp(rawAmt, trCurr, targetUpper, fxSnapshot)
    .convertedAmount;
}

export function evaluateBudgetProgress(
  budget: FinancialBudget,
  expenses: FlexibleExpense[],
  incomes: IncomeReceipt[],
  accounts: FinancialAccount[],
  settings: UserSettings,
  fxSnapshot?: MarketFxSnapshot,
  referenceDate: Date = new Date(),
  transfers: AccountTransfer[] = []
): EvaluatedBudget {
  const baseCurrency = (settings.currency || 'GHS').toUpperCase();
  const budgetCurrency = (budget.currency || baseCurrency).toUpperCase();
  const purposeType: 'budget' | 'goal' =
    budget.purposeType === 'goal' ? 'goal' : 'budget';
  const periodWindow = resolveBudgetPeriodWindow(budget, referenceDate);
  const todayYmd = toYmd(referenceDate);
  const isExpired =
    Boolean(budget.isExpiredDisabled) || todayYmd > periodWindow.endYmd;
  const effectiveAutoRecreate =
    budget.periodType !== 'custom' ? true : Boolean(budget.autoRecreate);
  const isDisabledFromReach = isExpired && !effectiveAutoRecreate;
  const recreateDays =
    budget.recreateDays !== undefined && Number(budget.recreateDays) > 0
      ? Math.max(1, Math.round(Number(budget.recreateDays)))
      : getDefaultRecreateDaysForPeriod(
          budget.periodType,
          budget.customStartDate,
          budget.customEndDate
        );

  const budgetLimit = roundTo2Decimals(Math.max(0, Number(budget.amount || 0)));
  const conversionToBase =
    budgetCurrency === baseCurrency
      ? { convertedAmount: budgetLimit, exchangeRate2dp: 1 }
      : convertCurrency2dp(budgetLimit, budgetCurrency, baseCurrency, fxSnapshot);
  const budgetLimitBase = conversionToBase.convertedAmount;
  const conversionRateToBase =
    budgetCurrency === baseCurrency
      ? 1
      : convertCurrency2dp(1, budgetCurrency, baseCurrency, fxSnapshot)
          .exchangeRate2dp;
  const inverseConversionRateToBase =
    budgetCurrency === baseCurrency
      ? 1
      : convertCurrency2dp(1, baseCurrency, budgetCurrency, fxSnapshot)
          .exchangeRate2dp;

  const linkedAccount = budget.accountId
    ? accounts.find((a) => a.id === budget.accountId)
    : undefined;

  if (purposeType === 'goal') {
    // Goal evaluation: attached to transfers and/or savings allocations to meet a target for a cause
    const sourceType = budget.goalSourceType || 'savings_and_transfers';
    const savingsSplitTransfers =
      sourceType === 'transfers_only'
        ? []
        : getSavingsSplitTransfers(incomes, settings, accounts);
    const manualTransfers =
      sourceType === 'savings_only' ? [] : transfers || [];
    const candidateTransfers = [...manualTransfers, ...savingsSplitTransfers];

    const goalCauseLower = (budget.goalCause || '').trim().toLowerCase();
    const matchedTransfers: AccountTransfer[] = [];
    const sourceBreakdownMap = new Map<
      string,
      { spent: number; spentBase: number; count: number; color: string }
    >();

    for (const tr of candidateTransfers) {
      if (!isDateWithinBudgetWindow(tr.date, periodWindow)) continue;

      if (budget.accountId) {
        if (tr.destinationAccountId !== budget.accountId) continue;
      } else if (goalCauseLower) {
        const descMatch = (tr.description || '')
          .toLowerCase()
          .includes(goalCauseLower);
        const destAcc = accounts.find((a) => a.id === tr.destinationAccountId);
        const destNameMatch = (destAcc?.name || '')
          .toLowerCase()
          .includes(goalCauseLower);
        const isSavingsAlloc =
          tr.transferType === 'savings_deduction' ||
          (destAcc ? isSavingsVaultAccount(destAcc, settings) : false);
        if (!descMatch && !destNameMatch && !isSavingsAlloc) continue;
      }

      matchedTransfers.push(tr);

      const amtInGoalCurr = getTransferAmountInCurrency(
        tr,
        budgetCurrency,
        baseCurrency,
        accounts,
        fxSnapshot
      );
      const amtInBaseCurr = getTransferAmountInCurrency(
        tr,
        baseCurrency,
        baseCurrency,
        accounts,
        fxSnapshot
      );

      const destAcc = accounts.find((a) => a.id === tr.destinationAccountId);
      const label =
        destAcc?.name ||
        (tr.transferType === 'savings_deduction'
          ? 'Savings Allocation'
          : 'Account Transfer');
      const bucket = sourceBreakdownMap.get(label) || {
        spent: 0,
        spentBase: 0,
        count: 0,
        color: destAcc?.color || '#10b981',
      };
      bucket.spent = roundTo2Decimals(bucket.spent + amtInGoalCurr);
      bucket.spentBase = roundTo2Decimals(bucket.spentBase + amtInBaseCurr);
      bucket.count += 1;
      sourceBreakdownMap.set(label, bucket);
    }

    let achievedAmount = 0;
    let achievedAmountBase = 0;
    for (const item of sourceBreakdownMap.values()) {
      achievedAmount += item.spent;
      achievedAmountBase += item.spentBase;
    }
    achievedAmount = roundTo2Decimals(achievedAmount);
    achievedAmountBase = roundTo2Decimals(achievedAmountBase);

    const residualAmount = roundTo2Decimals(
      Math.max(0, budgetLimit - achievedAmount)
    );
    const residualAmountBase = roundTo2Decimals(
      Math.max(0, budgetLimitBase - achievedAmountBase)
    );
    const usagePercentage =
      budgetLimit > 0
        ? roundTo2Decimals((achievedAmount / budgetLimit) * 100)
        : 0;
    const clampedProgressPercent = Math.min(100, Math.max(0, usagePercentage));
    const residualPercent = Math.max(
      0,
      roundTo2Decimals(100 - clampedProgressPercent)
    );
    const overageAmount =
      achievedAmount > budgetLimit
        ? roundTo2Decimals(achievedAmount - budgetLimit)
        : 0;
    const overagePercent =
      usagePercentage > 100 ? roundTo2Decimals(usagePercentage - 100) : 0;

    const alertThresholdPercent = Math.min(
      100,
      Math.max(1, Number(budget.alertThresholdPercent ?? 80))
    );

    const isGoalMet = budgetLimit > 0 && achievedAmount >= budgetLimit;
    let status: BudgetHealthStatus = 'healthy';
    if (isGoalMet) {
      status = 'at_limit';
    } else if (usagePercentage >= alertThresholdPercent) {
      status = 'warning';
    }

    const subcategoryBreakdowns: BudgetSubcategoryBreakdown[] = Array.from(
      sourceBreakdownMap.entries()
    ).map(([label, stat]) => ({
      subcategory: label,
      color: stat.color,
      spentAmount: stat.spent,
      spentAmountBase: stat.spentBase,
      shareOfBudgetPercent:
        budgetLimit > 0
          ? roundTo2Decimals((stat.spent / budgetLimit) * 100)
          : 0,
      shareOfSpentPercent:
        achievedAmount > 0
          ? roundTo2Decimals((stat.spent / achievedAmount) * 100)
          : 0,
      transactionCount: stat.count,
    }));

    return {
      budget,
      purposeType: 'goal',
      periodWindow,
      budgetLimit,
      budgetLimitBase,
      spentAmount: achievedAmount,
      spentAmountBase: achievedAmountBase,
      residualAmount,
      residualAmountBase,
      usagePercentage,
      clampedProgressPercent,
      residualPercent,
      overageAmount,
      overagePercent,
      alertThresholdPercent,
      status,
      isGoalMet,
      isExpired,
      isDisabledFromReach,
      recreateDays,
      conversionRateToBase,
      inverseConversionRateToBase,
      subcategoryBreakdowns,
      matchedExpenses: [],
      matchedTransfers: sortRecordsByArrivalTime(matchedTransfers),
      linkedAccount,
    };
  }

  // Standard Budget evaluation (linked to expenses)
  const deductionExpenses = getIncomeDeductionExpenses(
    incomes,
    settings,
    accounts,
    expenses
  );
  const standaloneExpenses = expenses.filter(
    (e) => !e.id.startsWith('exp_cut_') && !e.id.startsWith('exp_ded_')
  );
  const allExpenses = [...standaloneExpenses, ...deductionExpenses];

  const targetSubMap = new Map<string, string>();
  for (const sub of budget.subcategories || []) {
    const trimmed = sub.trim();
    if (trimmed) {
      targetSubMap.set(normalizeSubcategoryKey(trimmed), trimmed);
    }
  }

  const matchedExpenses: FlexibleExpense[] = [];
  const subSpentMap = new Map<
    string,
    { spent: number; spentBase: number; count: number; categoryHint?: string }
  >();

  for (const [, canonicalSub] of targetSubMap.entries()) {
    subSpentMap.set(normalizeSubcategoryKey(canonicalSub), {
      spent: 0,
      spentBase: 0,
      count: 0,
    });
  }

  for (const exp of allExpenses) {
    if (exp.vaultAction === 'credit') continue;
    if (!isDateWithinBudgetWindow(exp.date, periodWindow)) continue;

    if (budget.accountId && exp.accountId !== budget.accountId) {
      continue;
    }

    const expSubKey = normalizeSubcategoryKey(exp.subcategory);
    const expCatKey = normalizeSubcategoryKey(exp.category);

    const matchedKey = targetSubMap.has(expSubKey)
      ? expSubKey
      : !expSubKey && targetSubMap.has(expCatKey)
      ? expCatKey
      : null;

    if (!matchedKey) continue;

    matchedExpenses.push(exp);

    const amtInBudgetCurr = getExpenseAmountInCurrency(
      exp,
      budgetCurrency,
      baseCurrency,
      accounts,
      fxSnapshot
    );
    const amtInBaseCurr = getExpenseAmountInCurrency(
      exp,
      baseCurrency,
      baseCurrency,
      accounts,
      fxSnapshot
    );

    const bucket = subSpentMap.get(matchedKey) || {
      spent: 0,
      spentBase: 0,
      count: 0,
    };
    bucket.spent = roundTo2Decimals(bucket.spent + amtInBudgetCurr);
    bucket.spentBase = roundTo2Decimals(bucket.spentBase + amtInBaseCurr);
    bucket.count += 1;
    if (exp.category && !bucket.categoryHint) {
      bucket.categoryHint = exp.category;
    }
    subSpentMap.set(matchedKey, bucket);
  }

  let spentAmount = 0;
  let spentAmountBase = 0;
  for (const item of subSpentMap.values()) {
    spentAmount += item.spent;
    spentAmountBase += item.spentBase;
  }
  spentAmount = roundTo2Decimals(spentAmount);
  spentAmountBase = roundTo2Decimals(spentAmountBase);

  const residualAmount = roundTo2Decimals(budgetLimit - spentAmount);
  const residualAmountBase = roundTo2Decimals(budgetLimitBase - spentAmountBase);
  const usagePercentage =
    budgetLimit > 0 ? roundTo2Decimals((spentAmount / budgetLimit) * 100) : 0;
  const clampedProgressPercent = Math.min(100, Math.max(0, usagePercentage));
  const residualPercent = Math.max(
    0,
    roundTo2Decimals(100 - clampedProgressPercent)
  );
  const overageAmount =
    spentAmount > budgetLimit ? roundTo2Decimals(spentAmount - budgetLimit) : 0;
  const overagePercent =
    usagePercentage > 100 ? roundTo2Decimals(usagePercentage - 100) : 0;

  const alertThresholdPercent = Math.min(
    100,
    Math.max(1, Number(budget.alertThresholdPercent ?? 80))
  );

  let status: BudgetHealthStatus = 'healthy';
  if (budgetLimit > 0 && spentAmount > budgetLimit) {
    status = 'exceeded';
  } else if (budgetLimit > 0 && spentAmount === budgetLimit) {
    status = 'at_limit';
  } else if (usagePercentage >= alertThresholdPercent) {
    status = 'warning';
  }

  const subcategoryBreakdowns: BudgetSubcategoryBreakdown[] = Array.from(
    targetSubMap.entries()
  ).map(([key, canonicalName]) => {
    const stat = subSpentMap.get(key) || { spent: 0, spentBase: 0, count: 0 };
    const color = resolveIntuitiveSubcategoryColor(
      canonicalName,
      stat.categoryHint || budget.categories?.[0] || '',
      settings,
      expenses
    );
    const shareOfBudgetPercent =
      budgetLimit > 0
        ? roundTo2Decimals((stat.spent / budgetLimit) * 100)
        : 0;
    const shareOfSpentPercent =
      spentAmount > 0
        ? roundTo2Decimals((stat.spent / spentAmount) * 100)
        : 0;

    return {
      subcategory: canonicalName,
      color,
      spentAmount: stat.spent,
      spentAmountBase: stat.spentBase,
      shareOfBudgetPercent,
      shareOfSpentPercent,
      transactionCount: stat.count,
    };
  });

  const sortedMatchedExpenses = sortRecordsByArrivalTime(matchedExpenses);

  return {
    budget,
    purposeType: 'budget',
    periodWindow,
    budgetLimit,
    budgetLimitBase,
    spentAmount,
    spentAmountBase,
    residualAmount,
    residualAmountBase,
    usagePercentage,
    clampedProgressPercent,
    residualPercent,
    overageAmount,
    overagePercent,
    alertThresholdPercent,
    status,
    isGoalMet: false,
    isExpired,
    isDisabledFromReach,
    recreateDays,
    conversionRateToBase,
    inverseConversionRateToBase,
    subcategoryBreakdowns,
    matchedExpenses: sortedMatchedExpenses,
    matchedTransfers: [],
    linkedAccount,
  };
}

export function evaluateAllBudgets(
  budgets: FinancialBudget[],
  expenses: FlexibleExpense[],
  incomes: IncomeReceipt[],
  accounts: FinancialAccount[],
  settings: UserSettings,
  fxSnapshot?: MarketFxSnapshot,
  referenceDate: Date = new Date(),
  includeArchived: boolean = false,
  transfers: AccountTransfer[] = []
): EvaluatedBudget[] {
  return budgets
    .filter((b) => includeArchived || !b.isArchivedPeriod)
    .map((b) =>
      evaluateBudgetProgress(
        b,
        expenses,
        incomes,
        accounts,
        settings,
        fxSnapshot,
        referenceDate,
        transfers
      )
    );
}

/**
 * Real-time spend validation against both the selected Account (and its attached Main Account)
 * and any Budgets covering the selected Subcategory & Date.
 */
export function checkSpendAgainstBudgetsAndAccount(params: {
  date: string;
  accountId: string;
  category?: string;
  subcategory?: string;
  amount: number;
  currency: string;
  budgets: FinancialBudget[];
  expenses: FlexibleExpense[];
  incomes: IncomeReceipt[];
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  settings: UserSettings;
  fxSnapshot?: MarketFxSnapshot;
}): SpendCheckEvaluation {
  const {
    date,
    accountId,
    category,
    subcategory,
    amount,
    currency: spendCurrency,
    budgets,
    expenses,
    incomes,
    accounts,
    transfers,
    settings,
    fxSnapshot,
  } = params;

  const baseCurrency = (settings.currency || 'GHS').toUpperCase();
  const cleanAmount = roundTo2Decimals(Math.max(0, Number(amount || 0)));

  // 1. Account Balance Check
  let accountCheck: SpendAccountCheckResult | null = null;
  const selectedAccount = accounts.find((a) => a.id === accountId);

  if (selectedAccount) {
    const { summaries } = calculateAccountSummaries(
      accounts,
      incomes,
      expenses,
      settings,
      transfers,
      fxSnapshot
    );
    const accSummary = summaries.find((s) => s.account.id === selectedAccount.id);
    const accCurr = getAccountCurrency(selectedAccount, baseCurrency);
    const nativeBalObj = getAccountNativeBalance(
      accSummary?.currentCashBalance ?? 0,
      selectedAccount,
      baseCurrency,
      fxSnapshot
    );
    const balanceBefore =
      accSummary?.nativeCurrentCashBalance !== undefined
        ? accSummary.nativeCurrentCashBalance
        : nativeBalObj.amount;

    const spendInAccountCurrency =
      spendCurrency.toUpperCase() === accCurr.toUpperCase()
        ? cleanAmount
        : convertCurrency2dp(cleanAmount, spendCurrency, accCurr, fxSnapshot)
            .convertedAmount;

    const projectedBalance = roundTo2Decimals(
      balanceBefore - spendInAccountCurrency
    );

    let accStatus: 'sufficient' | 'low_balance' | 'overdrawn' = 'sufficient';
    if (cleanAmount > 0 && projectedBalance < 0) {
      accStatus = 'overdrawn';
    } else if (
      cleanAmount > 0 &&
      balanceBefore > 0 &&
      spendInAccountCurrency / balanceBefore >= 0.8
    ) {
      accStatus = 'low_balance';
    }

    // Check attached Main Account if this is a virtual account
    let custodianAccount: FinancialAccount | undefined;
    let custodianCurrency: string | undefined;
    let custodianBalanceBefore: number | undefined;
    let custodianProjectedBalance: number | undefined;

    if (selectedAccount.isVirtual && selectedAccount.custodianAccountId) {
      const custAcc = accounts.find(
        (a) => a.id === selectedAccount.custodianAccountId
      );
      if (custAcc) {
        custodianAccount = custAcc;
        const custSummary = summaries.find((s) => s.account.id === custAcc.id);
        custodianCurrency = getAccountCurrency(custAcc, baseCurrency);
        const custNativeBal =
          custSummary?.nativeCurrentCashBalance ??
          getAccountNativeBalance(
            custSummary?.currentCashBalance ?? 0,
            custAcc,
            baseCurrency,
            fxSnapshot
          ).amount;
        custodianBalanceBefore = custNativeBal;
        const spendInCustCurr =
          spendCurrency.toUpperCase() === custodianCurrency.toUpperCase()
            ? cleanAmount
            : convertCurrency2dp(
                cleanAmount,
                spendCurrency,
                custodianCurrency,
                fxSnapshot
              ).convertedAmount;
        custodianProjectedBalance = roundTo2Decimals(
          custNativeBal - spendInCustCurr
        );
        if (cleanAmount > 0 && custodianProjectedBalance < 0) {
          accStatus = 'overdrawn';
        }
      }
    }

    accountCheck = {
      account: selectedAccount,
      accountCurrency: accCurr,
      balanceBefore,
      spendInAccountCurrency,
      projectedBalance,
      status: accStatus,
      custodianAccount,
      custodianCurrency,
      custodianBalanceBefore,
      custodianProjectedBalance,
    };
  }

  // 2. Budget Checks for the selected Subcategory & Date
  const refDate = (date ? parseLocalCalendarDate(date) : null) || new Date();
  const subKey = normalizeSubcategoryKey(subcategory);
  const catKey = normalizeSubcategoryKey(category);

  const budgetChecks: SpendBudgetCheckItem[] = [];

  if (subKey || catKey) {
    for (const budget of budgets) {
      if (
        budget.isArchivedPeriod ||
        budget.isExpiredDisabled ||
        budget.purposeType === 'goal'
      ) {
        continue;
      }
      // Check if budget tracks this subcategory
      const tracksSub = (budget.subcategories || []).some((s) => {
        const k = normalizeSubcategoryKey(s);
        return (subKey && k === subKey) || (!subKey && catKey && k === catKey);
      });
      if (!tracksSub) continue;

      // If budget is scoped to a specific account, check account match
      if (budget.accountId && accountId && budget.accountId !== accountId) {
        continue;
      }

      const evaluated = evaluateBudgetProgress(
        budget,
        expenses,
        incomes,
        accounts,
        settings,
        fxSnapshot,
        refDate
      );

      if (evaluated.isDisabledFromReach || evaluated.isExpired) {
        continue;
      }

      // Verify the expense date falls inside the budget's period window
      if (date && !isDateWithinBudgetWindow(date, evaluated.periodWindow)) {
        continue;
      }

      const budgetCurr = (budget.currency || baseCurrency).toUpperCase();
      const additionalSpend =
        spendCurrency.toUpperCase() === budgetCurr
          ? cleanAmount
          : convertCurrency2dp(cleanAmount, spendCurrency, budgetCurr, fxSnapshot)
              .convertedAmount;

      const spentBefore = evaluated.spentAmount;
      const projectedSpent = roundTo2Decimals(spentBefore + additionalSpend);
      const residualBefore = evaluated.residualAmount;
      const projectedResidual = roundTo2Decimals(
        evaluated.budgetLimit - projectedSpent
      );
      const percentageBefore = evaluated.usagePercentage;
      const projectedPercentage =
        evaluated.budgetLimit > 0
          ? roundTo2Decimals((projectedSpent / evaluated.budgetLimit) * 100)
          : 0;

      let projectedStatus: BudgetHealthStatus = 'healthy';
      if (evaluated.budgetLimit > 0 && projectedSpent > evaluated.budgetLimit) {
        projectedStatus = 'exceeded';
      } else if (
        evaluated.budgetLimit > 0 &&
        projectedSpent === evaluated.budgetLimit
      ) {
        projectedStatus = 'at_limit';
      } else if (projectedPercentage >= evaluated.alertThresholdPercent) {
        projectedStatus = 'warning';
      }

      budgetChecks.push({
        budget,
        periodLabel: `${evaluated.periodWindow.periodBadge} (${evaluated.periodWindow.label})`,
        budgetLimit: evaluated.budgetLimit,
        spentBefore,
        additionalSpend,
        projectedSpent,
        residualBefore,
        projectedResidual,
        percentageBefore,
        projectedPercentage,
        statusBefore: evaluated.status,
        projectedStatus,
      });
    }
  }

  return {
    accountCheck,
    budgetChecks,
    hasOverdrawnAccount: accountCheck?.status === 'overdrawn',
    hasLowBalanceAccount: accountCheck?.status === 'low_balance',
    hasExceededBudget: budgetChecks.some(
      (b) => b.projectedStatus === 'exceeded'
    ),
    hasWarningBudget: budgetChecks.some(
      (b) =>
        b.projectedStatus === 'warning' || b.projectedStatus === 'at_limit'
    ),
  };
}
