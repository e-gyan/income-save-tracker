import {
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  FinancialBudget,
  UserSettings,
} from '../types/finance.ts';
import {
  calculateAccountSummaries,
  formatAmount,
  getQuarterFromDate,
  isSavingsVaultAccount,
  LEGACY_SEEDED_CUT_IDS,
  getEffectiveExpenseCategoryPreferences,
} from './calculations.ts';
import { evaluateAllBudgets, EvaluatedBudget } from './budgetCalculations.ts';
import { formatDateDDMMYYYY, parseLocalCalendarDate } from './dateFilters.ts';
import {
  AgentRecordAction,
  learnDeductionSuggestions,
} from './deductionIntelligence.ts';
import { ActiveTab } from '../components/Navigation.tsx';

export type AssistantActionKind =
  | 'apply_deduction_rule'
  | 'record_income'
  | 'record_expense'
  | 'navigate';

export interface AppAssistantAction extends Omit<AgentRecordAction, 'kind'> {
  kind: AssistantActionKind;
  targetTab?: ActiveTab;
  actionLabel?: string;
}

export interface DetectedOccurrence {
  id: string;
  kind: 'expense' | 'income';
  label: string;
  category: string;
  subcategory?: string;
  count: number;
  averageAmount: number;
  totalAmount: number;
  averageIntervalDays: number | null;
  lastDate: string;
  lastDateFormatted: string;
  accountId?: string;
}

export interface ProactiveInsight {
  id: string;
  severity: 'alert' | 'warning' | 'positive' | 'info';
  badge: string;
  title: string;
  summary: string;
  detail: string;
  action?: AppAssistantAction;
}

export interface AssistantAccountBalance {
  id: string;
  name: string;
  isVault: boolean;
  currency: string;
  nativeBalance: number;
  baseBalance: number;
}

export interface AppAssistantIntelligence {
  currentQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  todayStr: string;
  currency: string;
  totals: {
    operatingCash: number;
    savingsVaults: number;
    totalBalance: number;
    totalIncome: number;
    totalExpenses: number;
    recent30DayExpenses: number;
    recent30DayIncome: number;
    savingsRatePercent: number;
    activeBudgetsCount: number;
    exceededBudgetsCount: number;
    warningBudgetsCount: number;
  };
  accountBalances: AssistantAccountBalance[];
  evaluatedBudgets: EvaluatedBudget[];
  topCategories: { category: string; amount: number; count: number; sharePercent: number }[];
  topSubcategories: {
    subcategory: string;
    category: string;
    amount: number;
    count: number;
  }[];
  recurringOccurrences: DetectedOccurrence[];
  insights: ProactiveInsight[];
  aiContext: Record<string, unknown>;
}

function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

function computeAverageIntervalDays(datesYmd: string[]): number | null {
  if (datesYmd.length < 2) return null;
  const timestamps = datesYmd
    .map((d) => parseLocalCalendarDate(d)?.getTime())
    .filter((t): t is number => typeof t === 'number' && !Number.isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return null;

  let diffSum = 0;
  let intervals = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const days = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24);
    if (days > 0) {
      diffSum += days;
      intervals++;
    }
  }
  if (intervals === 0) return null;
  return Math.max(1, Math.round(diffSum / intervals));
}

function formatCadenceLabel(days: number | null): string {
  if (!days) return 'Repeating pattern';
  if (days <= 2) return 'Almost daily';
  if (days >= 5 && days <= 9) return 'Weekly';
  if (days >= 12 && days <= 17) return 'Bi-weekly';
  if (days >= 25 && days <= 35) return 'Monthly';
  return `Every ${days} days`;
}

export function buildAppAssistantIntelligence(params: {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  transfers: AccountTransfer[];
  budgets: FinancialBudget[];
  settings: UserSettings;
  currency: string;
  activeTab?: ActiveTab;
}): AppAssistantIntelligence {
  const {
    incomes,
    expenses,
    accounts,
    transfers,
    budgets,
    settings,
    currency,
    activeTab = 'dashboard',
  } = params;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentQuarter = getQuarterFromDate(todayStr);
  const thirtyDaysAgoMs = today.getTime() - 30 * 24 * 60 * 60 * 1000;

  const standaloneExpenses = expenses.filter(
    (e) => e && !e.id?.startsWith('exp_ded_') && !e.id?.startsWith('exp_cut_')
  );

  // 1. Account summaries using app's canonical calculation engine
  const accountReport = calculateAccountSummaries(
    accounts,
    incomes,
    expenses,
    settings,
    transfers
  );

  const accountBalances: AssistantAccountBalance[] = accountReport.summaries.map((s) => ({
    id: s.account.id,
    name: s.account.name,
    isVault: isSavingsVaultAccount(s.account, settings),
    currency: s.accountCurrency || s.account.currency || currency,
    nativeBalance: round2(s.nativeCurrentCashBalance ?? s.currentCashBalance),
    baseBalance: round2(s.currentCashBalance),
  }));

  const operatingCash = round2(
    accountBalances
      .filter((a) => !a.isVault)
      .reduce((sum, a) => sum + a.baseBalance, 0)
  );
  const savingsVaults = round2(
    accountBalances
      .filter((a) => a.isVault)
      .reduce((sum, a) => sum + a.baseBalance, 0)
  );
  const totalBalance = round2(accountReport.totalCashAcrossAllAccounts);

  // 2. Income and Expense totals (overall and trailing 30 days)
  const totalIncome = round2(
    incomes.reduce((sum, inc) => sum + (Number(inc.grossAmount) || 0), 0)
  );
  const totalExpenses = round2(
    standaloneExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0)
  );

  let recent30DayExpenses = 0;
  let recent30DayIncome = 0;

  for (const exp of standaloneExpenses) {
    const dt = parseLocalCalendarDate(exp.date);
    if (dt && dt.getTime() >= thirtyDaysAgoMs) {
      recent30DayExpenses += Number(exp.amount) || 0;
    }
  }
  for (const inc of incomes) {
    const dt = parseLocalCalendarDate(inc.date);
    if (dt && dt.getTime() >= thirtyDaysAgoMs) {
      recent30DayIncome += Number(inc.grossAmount) || 0;
    }
  }
  recent30DayExpenses = round2(recent30DayExpenses);
  recent30DayIncome = round2(recent30DayIncome);

  const savingsRatePercent =
    totalIncome > 0
      ? round2(
          Math.max(
            0,
            ((accountReport.totalIncomeSavingsAccumulated || 0) / totalIncome) * 100
          )
        )
      : 0;

  // 3. Budget and goal evaluations
  const evaluatedBudgets = evaluateAllBudgets(
    budgets,
    expenses,
    incomes,
    accounts,
    settings,
    undefined,
    today,
    false,
    transfers
  );

  const exceededBudgets = evaluatedBudgets.filter(
    (b) => b.purposeType === 'budget' && (b.status === 'exceeded' || b.status === 'at_limit')
  );
  const warningBudgets = evaluatedBudgets.filter(
    (b) => b.purposeType === 'budget' && b.status === 'warning'
  );

  // 4. Category and Subcategory concentration
  const catTotals = new Map<string, { amount: number; count: number }>();
  const subTotals = new Map<
    string,
    { subcategory: string; category: string; amount: number; count: number }
  >();

  for (const exp of standaloneExpenses) {
    const cat = (exp.category || 'Uncategorized').trim() || 'Uncategorized';
    const sub = (exp.subcategory || '').trim();
    const amt = Number(exp.amount) || 0;

    const existingCat = catTotals.get(cat) || { amount: 0, count: 0 };
    existingCat.amount += amt;
    existingCat.count += 1;
    catTotals.set(cat, existingCat);

    if (sub) {
      const subKey = `${cat.toLowerCase()}:::${sub.toLowerCase()}`;
      const existingSub = subTotals.get(subKey) || {
        subcategory: sub,
        category: cat,
        amount: 0,
        count: 0,
      };
      existingSub.amount += amt;
      existingSub.count += 1;
      subTotals.set(subKey, existingSub);
    }
  }

  const topCategories = Array.from(catTotals.entries())
    .map(([category, v]) => ({
      category,
      amount: round2(v.amount),
      count: v.count,
      sharePercent: totalExpenses > 0 ? round2((v.amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const topSubcategories = Array.from(subTotals.values())
    .map((v) => ({
      ...v,
      amount: round2(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  // 5. Occurrence detection (repeating expense and income patterns)
  const expGroups = new Map<
    string,
    {
      label: string;
      category: string;
      subcategory: string;
      amounts: number[];
      dates: string[];
      lastDate: string;
      accountId?: string;
    }
  >();

  for (const exp of standaloneExpenses) {
    const label = (exp.recipient || exp.subcategory || exp.description || '').trim();
    if (!label) continue;
    const sub = (exp.subcategory || '').trim();
    const cat = (exp.category || 'Uncategorized').trim();
    const key = `${label.toLowerCase()}:::${sub.toLowerCase()}`;
    const existing = expGroups.get(key) || {
      label,
      category: cat,
      subcategory: sub,
      amounts: [],
      dates: [],
      lastDate: exp.date,
      accountId: exp.accountId,
    };
    existing.amounts.push(Number(exp.amount) || 0);
    if (exp.date) existing.dates.push(exp.date);
    if (exp.date && exp.date >= existing.lastDate) {
      existing.lastDate = exp.date;
      existing.accountId = exp.accountId || existing.accountId;
    }
    expGroups.set(key, existing);
  }

  const incGroups = new Map<
    string,
    {
      label: string;
      category: string;
      amounts: number[];
      dates: string[];
      lastDate: string;
      accountId?: string;
    }
  >();

  for (const inc of incomes) {
    const label = (inc.clientOrSource || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = incGroups.get(key) || {
      label,
      category: inc.category || 'Salary',
      amounts: [],
      dates: [],
      lastDate: inc.date,
      accountId: inc.accountId,
    };
    existing.amounts.push(Number(inc.grossAmount) || 0);
    if (inc.date) existing.dates.push(inc.date);
    if (inc.date && inc.date >= existing.lastDate) {
      existing.lastDate = inc.date;
      existing.accountId = inc.accountId || existing.accountId;
    }
    incGroups.set(key, existing);
  }

  const recurringExpenseOccurrences: DetectedOccurrence[] = Array.from(expGroups.entries())
    .filter(([, g]) => g.amounts.length >= 2)
    .map(([key, g]) => {
      const totalAmt = round2(g.amounts.reduce((s, a) => s + a, 0));
      const avgAmt = round2(totalAmt / g.amounts.length);
      return {
        id: `occ_exp_${key.replace(/[^a-z0-9]/g, '_')}`,
        kind: 'expense' as const,
        label: g.label,
        category: g.category,
        subcategory: g.subcategory || undefined,
        count: g.amounts.length,
        averageAmount: avgAmt,
        totalAmount: totalAmt,
        averageIntervalDays: computeAverageIntervalDays(g.dates),
        lastDate: g.lastDate,
        lastDateFormatted: formatDateDDMMYYYY(g.lastDate),
        accountId: g.accountId,
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
    .slice(0, 6);

  const recurringIncomeOccurrences: DetectedOccurrence[] = Array.from(incGroups.entries())
    .filter(([, g]) => g.amounts.length >= 2)
    .map(([key, g]) => {
      const totalAmt = round2(g.amounts.reduce((s, a) => s + a, 0));
      const avgAmt = round2(totalAmt / g.amounts.length);
      return {
        id: `occ_inc_${key.replace(/[^a-z0-9]/g, '_')}`,
        kind: 'income' as const,
        label: g.label,
        category: g.category,
        count: g.amounts.length,
        averageAmount: avgAmt,
        totalAmount: totalAmt,
        averageIntervalDays: computeAverageIntervalDays(g.dates),
        lastDate: g.lastDate,
        lastDateFormatted: formatDateDDMMYYYY(g.lastDate),
        accountId: g.accountId,
      };
    })
    .sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount)
    .slice(0, 4);

  const recurringOccurrences = [
    ...recurringExpenseOccurrences,
    ...recurringIncomeOccurrences,
  ];

  // 6. Build prioritized proactive insights
  const insights: ProactiveInsight[] = [];

  for (const b of exceededBudgets.slice(0, 2)) {
    insights.push({
      id: `ins_budget_over_${b.budget.id}`,
      severity: 'alert',
      badge: 'Budget limit',
      title: `${b.budget.name} at ${Math.round(b.usagePercentage)}%`,
      summary: `${formatAmount(b.spentAmount, b.budget.currency)} spent of ${formatAmount(
        b.budgetLimit,
        b.budget.currency
      )}`,
      detail:
        b.overageAmount > 0
          ? `Over limit by ${formatAmount(b.overageAmount, b.budget.currency)} in ${b.periodWindow.label}.`
          : `Reached limit for ${b.periodWindow.label}.`,
      action: {
        id: `act_nav_budget_${b.budget.id}`,
        kind: 'navigate',
        targetTab: 'budgets',
        title: `Open ${b.budget.name}`,
        summary: 'Review budget status and transactions',
        reason: 'Budget reached or exceeded limit',
        actionLabel: 'Open Budgets',
      },
    });
  }

  for (const b of warningBudgets.slice(0, 2)) {
    insights.push({
      id: `ins_budget_warn_${b.budget.id}`,
      severity: 'warning',
      badge: 'Budget watch',
      title: `${b.budget.name} at ${Math.round(b.usagePercentage)}%`,
      summary: `${formatAmount(b.residualAmount, b.budget.currency)} remaining`,
      detail: `${b.periodWindow.daysRemaining} days left in ${b.periodWindow.label}.`,
      action: {
        id: `act_nav_budget_warn_${b.budget.id}`,
        kind: 'navigate',
        targetTab: 'budgets',
        title: `Review ${b.budget.name}`,
        summary: 'Track remaining allowance',
        reason: 'Approaching budget alert threshold',
        actionLabel: 'Open Budgets',
      },
    });
  }

  const uncategorizedCount = standaloneExpenses.filter(
    (e) => !e.category || e.category.trim().toLowerCase() === 'uncategorized'
  ).length;
  if (uncategorizedCount > 0) {
    insights.push({
      id: 'ins_uncategorized',
      severity: 'warning',
      badge: 'Data hygiene',
      title: `${uncategorizedCount} uncategorized expense${uncategorizedCount === 1 ? '' : 's'}`,
      summary: 'Assign categories for accurate analytics and budgets',
      detail: 'Open Expenses to categorize ungrouped records.',
      action: {
        id: 'act_nav_expenses_uncat',
        kind: 'navigate',
        targetTab: 'flexible_expenses',
        title: 'Review uncategorized expenses',
        summary: `${uncategorizedCount} records need a category`,
        reason: 'Improves reporting accuracy',
        actionLabel: 'Open Expenses',
      },
    });
  }

  if (recurringExpenseOccurrences.length > 0) {
    const topOcc = recurringExpenseOccurrences[0];
    insights.push({
      id: `ins_occ_${topOcc.id}`,
      severity: 'info',
      badge: formatCadenceLabel(topOcc.averageIntervalDays),
      title: `Recurring: ${topOcc.label}`,
      summary: `${topOcc.count} occurrences · avg ${formatAmount(topOcc.averageAmount, currency)}`,
      detail: `Last recorded ${topOcc.lastDateFormatted} under ${topOcc.subcategory || topOcc.category}.`,
      action: {
        id: `act_rec_${topOcc.id}`,
        kind: 'record_expense',
        title: topOcc.label,
        summary: `${formatAmount(topOcc.averageAmount, currency)} · ${topOcc.subcategory || topOcc.category}`,
        reason: `Observed ${topOcc.count} times in your ledger`,
        actionLabel: 'Record again',
        expenseDraft: {
          recipient: topOcc.label,
          category: topOcc.category,
          subcategory: topOcc.subcategory || topOcc.category,
          amount: topOcc.averageAmount,
          date: todayStr,
          accountId: topOcc.accountId,
          notes: 'Recorded from App Assistant recurring occurrence',
        },
      },
    });
  }

  if (topCategories.length > 0) {
    const topCat = topCategories[0];
    insights.push({
      id: 'ins_top_cost_driver',
      severity: 'info',
      badge: 'Top spending',
      title: `${topCat.category} leads spend (${topCat.sharePercent}%)`,
      summary: `${formatAmount(topCat.amount, currency)} across ${topCat.count} records`,
      detail: 'Inspect category trends and account outflows in Analytics.',
      action: {
        id: 'act_nav_analytics_top',
        kind: 'navigate',
        targetTab: 'analytics',
        title: 'Open Analytics',
        summary: 'View category and account breakdown',
        reason: 'Top expense category',
        actionLabel: 'Open Analytics',
      },
    });
  }

  if (savingsVaults > 0) {
    insights.push({
      id: 'ins_savings_health',
      severity: 'positive',
      badge: `${currentQuarter} savings`,
      title: `Savings vaults at ${formatAmount(savingsVaults, currency)}`,
      summary: `Operating cash at ${formatAmount(operatingCash, currency)}`,
      detail:
        savingsRatePercent > 0
          ? `Current income allocation rate is ${savingsRatePercent}% across ${accounts.length} accounts.`
          : `Tracked across ${accounts.length} active accounts and vaults.`,
      action: {
        id: 'act_nav_accounts',
        kind: 'navigate',
        targetTab: 'accounts',
        title: 'Open Accounts',
        summary: 'Review operating accounts and vaults',
        reason: 'Live liquidity overview',
        actionLabel: 'Open Accounts',
      },
    });
  }

  // 7. Build structured AI context payload for /api/ai/app-assistant
  const learnedDeductions = learnDeductionSuggestions({
    incomes,
    expenses,
    settings,
    activeDate: todayStr,
  });

  const effectiveCategories = getEffectiveExpenseCategoryPreferences(settings, expenses);

  const aiContext = {
    currency,
    currentQuarter,
    today: formatDateDDMMYYYY(todayStr),
    activeScreen: activeTab,
    totals: {
      operatingCash,
      savingsVaults,
      totalBalance,
      totalIncome,
      totalExpenses,
      recent30DayIncome,
      recent30DayExpenses,
      savingsRatePercent,
      incomeCount: incomes.length,
      expenseCount: standaloneExpenses.length,
      transferCount: transfers.length,
      activeBudgetsCount: evaluatedBudgets.length,
    },
    accounts: accountBalances.slice(0, 14),
    budgets: evaluatedBudgets.slice(0, 10).map((b) => ({
      name: b.budget.name,
      purposeType: b.purposeType,
      currency: b.budget.currency,
      limit: b.budgetLimit,
      spent: b.spentAmount,
      remaining: b.residualAmount,
      usagePercent: round2(b.usagePercentage),
      status: b.status,
      period: b.periodWindow.label,
      daysRemaining: b.periodWindow.daysRemaining,
    })),
    topCategories,
    topSubcategories,
    recurringOccurrences: recurringOccurrences.map((o) => ({
      kind: o.kind,
      label: o.label,
      category: o.category,
      subcategory: o.subcategory,
      count: o.count,
      averageAmount: o.averageAmount,
      cadence: formatCadenceLabel(o.averageIntervalDays),
      lastDate: o.lastDateFormatted,
    })),
    definedDeductions: (settings.customCuts || [])
      .filter((c) => !LEGACY_SEEDED_CUT_IDS.has(c.id))
      .map((c) => ({
        name: c.name,
        type: c.type,
        amount: c.amount,
        quarterlyRates: c.quarterlyRates,
        isSavingsSplit: c.isSavingsSplit,
        expenseCategory: c.expenseCategory,
        expenseSubcategory: c.expenseSubcategory,
      })),
    learnedDeductionPatterns: learnedDeductions.slice(0, 6),
    categories: effectiveCategories.slice(0, 15).map((c) => ({
      name: c.name,
      subcategories: c.subcategories.slice(0, 10),
    })),
    recentExpenses: standaloneExpenses.slice(0, 10).map((e) => ({
      date: formatDateDDMMYYYY(e.date),
      recipient: e.recipient || e.description,
      category: e.category,
      subcategory: e.subcategory,
      amount: e.amount,
    })),
    recentIncomes: incomes.slice(0, 8).map((i) => ({
      date: formatDateDDMMYYYY(i.date),
      source: i.clientOrSource,
      grossAmount: i.grossAmount,
      category: i.category,
    })),
  };

  return {
    currentQuarter,
    todayStr,
    currency,
    totals: {
      operatingCash,
      savingsVaults,
      totalBalance,
      totalIncome,
      totalExpenses,
      recent30DayExpenses,
      recent30DayIncome,
      savingsRatePercent,
      activeBudgetsCount: evaluatedBudgets.length,
      exceededBudgetsCount: exceededBudgets.length,
      warningBudgetsCount: warningBudgets.length,
    },
    accountBalances,
    evaluatedBudgets,
    topCategories,
    topSubcategories,
    recurringOccurrences,
    insights,
    aiContext,
  };
}

/**
 * Deterministic local database agent fallback so the App Assistant always answers
 * accurately with live figures and guided actions even offline or without an API key.
 */
export function answerAppAssistantLocally(
  query: string,
  intel: AppAssistantIntelligence,
  actionableSuggestions: AgentRecordAction[]
): { reply: string; suggestions: AppAssistantAction[] } {
  const q = query.toLowerCase();
  const { totals, currency } = intel;

  // 1. Budgets and goals
  if (q.includes('budget') || q.includes('goal') || q.includes('limit')) {
    if (intel.evaluatedBudgets.length === 0) {
      return {
        reply:
          'You have no active budgets or goals configured yet. Open Budgets to create a spending limit or savings target.',
        suggestions: [
          {
            id: `local_nav_budgets_${Date.now()}`,
            kind: 'navigate',
            targetTab: 'budgets',
            title: 'Create a budget or goal',
            summary: 'Track spending limits and savings targets',
            reason: 'No active budgets found in database',
            actionLabel: 'Open Budgets',
          },
        ],
      };
    }

    const lines = intel.evaluatedBudgets.slice(0, 4).map((b) => {
      const pct = Math.round(b.usagePercentage);
      return `${b.budget.name}: ${formatAmount(b.spentAmount, b.budget.currency)} of ${formatAmount(
        b.budgetLimit,
        b.budget.currency
      )} (${pct}%).`;
    });

    return {
      reply: `You have ${intel.evaluatedBudgets.length} active budgets and goals (${totals.exceededBudgetsCount} at or over limit, ${totals.warningBudgetsCount} on watch).\n${lines.join('\n')}`,
      suggestions: [
        {
          id: `local_nav_budgets_${Date.now()}`,
          kind: 'navigate',
          targetTab: 'budgets',
          title: 'Review Budgets and Goals',
          summary: `${intel.evaluatedBudgets.length} active trackers`,
          reason: 'Live budget evaluation',
          actionLabel: 'Open Budgets',
        },
      ],
    };
  }

  // 2. Account balances and liquidity
  if (
    q.includes('account') ||
    q.includes('balance') ||
    q.includes('vault') ||
    q.includes('cash') ||
    q.includes('liquidity')
  ) {
    const topAccounts = intel.accountBalances
      .slice(0, 5)
      .map(
        (a) =>
          `${a.name}${a.isVault ? ' (Vault)' : ''}: ${formatAmount(a.nativeBalance, a.currency)}`
      )
      .join('\n');

    return {
      reply: `Operating cash is ${formatAmount(totals.operatingCash, currency)} and savings vaults hold ${formatAmount(
        totals.savingsVaults,
        currency
      )}.\n${topAccounts}`,
      suggestions: [
        {
          id: `local_nav_accounts_${Date.now()}`,
          kind: 'navigate',
          targetTab: 'accounts',
          title: 'Open Accounts and Vaults',
          summary: `${intel.accountBalances.length} active accounts`,
          reason: 'Inspect balances and transfer funds',
          actionLabel: 'Open Accounts',
        },
      ],
    };
  }

  // 3. Recurring occurrences and patterns
  if (
    q.includes('recur') ||
    q.includes('occur') ||
    q.includes('pattern') ||
    q.includes('frequent') ||
    q.includes('habit')
  ) {
    if (intel.recurringOccurrences.length === 0) {
      return {
        reply:
          'No repeating transaction patterns have been detected yet. As you record more entries, recurring expenses and income cadences will appear here automatically.',
        suggestions: [],
      };
    }

    const lines = intel.recurringOccurrences.slice(0, 4).map((o) => {
      const cadence = formatCadenceLabel(o.averageIntervalDays);
      return `${o.label} (${o.kind}): ${o.count} times, avg ${formatAmount(
        o.averageAmount,
        currency
      )}, ${cadence.toLowerCase()}, last on ${o.lastDateFormatted}.`;
    });

    const firstExp = intel.recurringOccurrences.find((o) => o.kind === 'expense');
    const suggestions: AppAssistantAction[] = firstExp
      ? [
          {
            id: `local_rec_occ_${Date.now()}`,
            kind: 'record_expense',
            title: `Record ${firstExp.label}`,
            summary: `${formatAmount(firstExp.averageAmount, currency)} · ${
              firstExp.subcategory || firstExp.category
            }`,
            reason: `Detected ${firstExp.count} occurrences`,
            actionLabel: 'Record',
            expenseDraft: {
              recipient: firstExp.label,
              category: firstExp.category,
              subcategory: firstExp.subcategory || firstExp.category,
              amount: firstExp.averageAmount,
              date: intel.todayStr,
              accountId: firstExp.accountId,
            },
          },
        ]
      : [];

    return {
      reply: `Top detected occurrences in your database:\n${lines.join('\n')}`,
      suggestions,
    };
  }

  // 4. Spending, expenses, top categories
  if (
    q.includes('spend') ||
    q.includes('expense') ||
    q.includes('cost') ||
    q.includes('where') ||
    q.includes('category')
  ) {
    const topLines = intel.topCategories
      .slice(0, 4)
      .map(
        (c) =>
          `${c.category}: ${formatAmount(c.amount, currency)} (${c.sharePercent}%, ${c.count} records).`
      )
      .join('\n');

    return {
      reply: `Total recorded expenses are ${formatAmount(
        totals.totalExpenses,
        currency
      )}, with ${formatAmount(totals.recent30DayExpenses, currency)} in the last 30 days.\n${
        topLines || 'No categorized expenses recorded yet.'
      }`,
      suggestions: [
        {
          id: `local_nav_analytics_${Date.now()}`,
          kind: 'navigate',
          targetTab: 'analytics',
          title: 'Open Analytics',
          summary: 'Inspect category and account spending trends',
          reason: 'Detailed spend breakdown',
          actionLabel: 'Open Analytics',
        },
      ],
    };
  }

  // 5. Deductions and savings rate
  if (q.includes('deduction') || q.includes('saving') || q.includes('rate') || q.includes('income')) {
    return {
      reply: `Total recorded income is ${formatAmount(
        totals.totalIncome,
        currency
      )} (${formatAmount(totals.recent30DayIncome, currency)} in the last 30 days). Savings vaults hold ${formatAmount(
        totals.savingsVaults,
        currency
      )} with a ${totals.savingsRatePercent}% allocation rate for ${intel.currentQuarter}.`,
      suggestions: actionableSuggestions.slice(0, 2).map((s) => ({
        ...s,
        actionLabel: 'Record',
      })),
    };
  }

  // 6. How-to / App guidance
  if (
    q.includes('how') ||
    q.includes('import') ||
    q.includes('drive') ||
    q.includes('rename') ||
    q.includes('setting') ||
    q.includes('guide')
  ) {
    return {
      reply:
        'You can manage categories, subcategories, Google Drive alignment, file imports, deduction rules, and biometric lock in Settings. Use Quick Record for fast income, expense, and transfer entries.',
      suggestions: [
        {
          id: `local_nav_settings_${Date.now()}`,
          kind: 'navigate',
          targetTab: 'settings',
          title: 'Open Settings',
          summary: 'Categories, imports, Drive alignment, and rules',
          reason: 'App configuration and tools',
          actionLabel: 'Open Settings',
        },
      ],
    };
  }

  // 7. Default concise ledger brief
  const alertNote =
    totals.exceededBudgetsCount > 0
      ? ` ${totals.exceededBudgetsCount} budget${totals.exceededBudgetsCount === 1 ? ' is' : 's are'} at or over limit.`
      : '';
  const topCatNote =
    intel.topCategories.length > 0
      ? ` Top spend is ${intel.topCategories[0].category} (${intel.topCategories[0].sharePercent}%).`
      : '';

  return {
    reply: `Ledger brief for ${intel.currentQuarter}: Operating cash is ${formatAmount(
      totals.operatingCash,
      currency
    )}, savings vaults hold ${formatAmount(
      totals.savingsVaults,
      currency
    )}, and 30-day spend is ${formatAmount(
      totals.recent30DayExpenses,
      currency
    )}.${topCatNote}${alertNote}`,
    suggestions: intel.insights
      .map((i) => i.action)
      .filter((a): a is AppAssistantAction => Boolean(a))
      .slice(0, 2),
  };
}
