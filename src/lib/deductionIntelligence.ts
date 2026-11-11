import {
  IncomeReceipt,
  FlexibleExpense,
  UserSettings,
  FinancialAccount,
  CustomDeduction,
  IncomeDeductionItem,
  Quarter,
} from '../types/finance.ts';
import {
  getQuarterFromDate,
  isSavingsDeduction,
  getSavingsCutRateForDate,
  resolveDeductionExpenseMapping,
  computeDeductionAmount,
  formatAmount,
  LEGACY_SEEDED_CUT_IDS,
} from './calculations.ts';

export interface LearnedDeductionSuggestion {
  id: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  quarterlyRates?: {
    Q1: number;
    Q2: number;
    Q3: number;
    Q4: number;
  };
  routeTo: 'expense' | 'savings_split';
  expenseCategory?: string;
  expenseSubcategory?: string;
  reason: string;
  sourceMatch?: string;
  frequency: number;
  isAlreadyDefinedCut: boolean;
  definedCutId?: string;
}

export interface AgentRecordAction {
  id: string;
  kind: 'apply_deduction_rule' | 'record_income' | 'record_expense';
  title: string;
  summary: string;
  reason: string;
  deductionRule?: Omit<CustomDeduction, 'id'>;
  incomeDraft?: {
    clientOrSource: string;
    notes?: string;
    category: string;
    grossAmount: number;
    date: string;
    accountId?: string;
    applySuggestedDeductions: boolean;
  };
  expenseDraft?: {
    recipient: string;
    category: string;
    subcategory?: string;
    amount: number;
    date: string;
    accountId?: string;
    notes?: string;
  };
}

/**
 * Learns deduction patterns across the user's defined rules, historical income deductions,
 * and expense records across the board.
 */
export function learnDeductionSuggestions(params: {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  settings: UserSettings;
  activeDate?: string;
  activeSource?: string;
  activeOrigin?: string;
  grossAmount?: number;
}): LearnedDeductionSuggestion[] {
  const {
    incomes,
    expenses,
    settings,
    activeDate = new Date().toISOString().split('T')[0],
    activeSource = '',
    activeOrigin = '',
  } = params;

  const activeQuarter: Quarter = getQuarterFromDate(activeDate);
  const definedCuts = (settings.customCuts || []).filter(
    (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
  );
  const suggestionsMap = new Map<string, LearnedDeductionSuggestion>();

  const normSource = activeSource.trim().toLowerCase();
  const normOrigin = activeOrigin.trim().toLowerCase();

  // 1. Learn from Defined Deductions in Settings (with quarterly savings awareness)
  for (const cut of definedCuts) {
    const key = cut.name.trim().toLowerCase();
    const isSav = isSavingsDeduction(cut);
    const { rate } = isSav
      ? getSavingsCutRateForDate(cut, activeDate)
      : { rate: cut.amount };

    const mapping = !isSav
      ? resolveDeductionExpenseMapping(cut, settings, expenses)
      : undefined;

    suggestionsMap.set(key, {
      id: `sug_def_${cut.id}`,
      name: cut.name,
      type: cut.type,
      value: rate,
      quarterlyRates: cut.quarterlyRates,
      routeTo: isSav ? 'savings_split' : 'expense',
      expenseCategory: mapping?.category,
      expenseSubcategory: mapping?.subcategory,
      reason: isSav
        ? `Defined Savings rule · ${activeQuarter} rate (${rate}${cut.type === 'percentage' ? '%' : ''})`
        : `Defined rule · ${mapping?.category || 'Expense'}${
            mapping?.subcategory ? ` → ${mapping.subcategory}` : ''
          }`,
      frequency: 1,
      isAlreadyDefinedCut: true,
      definedCutId: cut.id,
    });
  }

  // 2. Learn from historical Income Deductions across all recorded incomes
  const historicalBuckets = new Map<
    string,
    {
      name: string;
      type: 'percentage' | 'fixed';
      values: number[];
      quarterValues: Record<Quarter, number[]>;
      isSav: boolean;
      category?: string;
      subcategory?: string;
      totalCount: number;
      matchedSourceCount: number;
      matchedSources: Set<string>;
    }
  >();

  for (const inc of incomes) {
    const incQuarter = getQuarterFromDate(inc.date);
    const incSourceNorm = (inc.clientOrSource || '').trim().toLowerCase();
    const incOriginNorm = (inc.notes || '').trim().toLowerCase();
    const matchesActiveSource =
      (normSource && incSourceNorm === normSource) ||
      (normOrigin && incOriginNorm === normOrigin);

    for (const ded of inc.allocatedDeductions || []) {
      const key = ded.name.trim().toLowerCase();
      if (!key) continue;
      const isSav = isSavingsDeduction(ded);
      const existing = historicalBuckets.get(key) || {
        name: ded.name.trim(),
        type: ded.type,
        values: [],
        quarterValues: { Q1: [], Q2: [], Q3: [], Q4: [] },
        isSav,
        category: ded.expenseCategory,
        subcategory: ded.expenseSubcategory,
        totalCount: 0,
        matchedSourceCount: 0,
        matchedSources: new Set<string>(),
      };

      const numVal = Number(ded.value) || Number(ded.amount) || 0;
      if (numVal > 0) {
        existing.values.push(numVal);
        existing.quarterValues[incQuarter].push(numVal);
      }
      existing.totalCount += 1;
      if (inc.clientOrSource) existing.matchedSources.add(inc.clientOrSource);
      if (matchesActiveSource) {
        existing.matchedSourceCount += 1;
      }
      if (!existing.category && ded.expenseCategory) {
        existing.category = ded.expenseCategory;
      }
      if (!existing.subcategory && ded.expenseSubcategory) {
        existing.subcategory = ded.expenseSubcategory;
      }
      historicalBuckets.set(key, existing);
    }
  }

  for (const [key, stats] of historicalBuckets.entries()) {
    const qVals = stats.quarterValues[activeQuarter];
    const relevantVals = qVals.length > 0 ? qVals : stats.values;
    const avgVal =
      relevantVals.length > 0
        ? Math.round(
            (relevantVals.reduce((a, b) => a + b, 0) / relevantVals.length) * 100
          ) / 100
        : 10;

    const mapping = !stats.isSav
      ? resolveDeductionExpenseMapping(
          {
            name: stats.name,
            expenseCategory: stats.category,
            expenseSubcategory: stats.subcategory,
          },
          settings,
          expenses
        )
      : undefined;

    const existingDef = suggestionsMap.get(key);
    const sourceBadge =
      stats.matchedSourceCount > 0
        ? `Used ${stats.matchedSourceCount}x for ${activeSource || activeOrigin}`
        : `Applied ${stats.totalCount}x across income history`;

    if (existingDef) {
      suggestionsMap.set(key, {
        ...existingDef,
        frequency: existingDef.frequency + stats.totalCount + stats.matchedSourceCount * 2,
        sourceMatch:
          stats.matchedSourceCount > 0
            ? activeSource || activeOrigin
            : Array.from(stats.matchedSources)[0],
        reason: `${existingDef.reason} · ${sourceBadge}`,
      });
    } else {
      const qRates = stats.isSav
        ? {
            Q1: stats.quarterValues.Q1[0] || avgVal,
            Q2: stats.quarterValues.Q2[0] || avgVal,
            Q3: stats.quarterValues.Q3[0] || avgVal,
            Q4: stats.quarterValues.Q4[0] || avgVal,
          }
        : undefined;

      suggestionsMap.set(key, {
        id: `sug_hist_${key.replace(/\s+/g, '_')}`,
        name: stats.name,
        type: stats.type,
        value: avgVal,
        quarterlyRates: qRates,
        routeTo: stats.isSav ? 'savings_split' : 'expense',
        expenseCategory: mapping?.category,
        expenseSubcategory: mapping?.subcategory,
        reason: `${sourceBadge}${
          mapping ? ` · ${mapping.category} → ${mapping.subcategory}` : ''
        }`,
        sourceMatch: Array.from(stats.matchedSources)[0],
        frequency: stats.totalCount + stats.matchedSourceCount * 2,
        isAlreadyDefinedCut: false,
      });
    }
  }

  // 3. Learn from Standalone Expense Records (e.g. Giving & Speaking -> Givings, recurring recipients/categories)
  const standaloneExpenses = expenses.filter(
    (e) =>
      !e.incomeReceiptId &&
      !e.id.startsWith('exp_cut_') &&
      !e.id.startsWith('exp_ded_')
  );

  const expensePatternGroups = new Map<
    string,
    {
      label: string;
      category: string;
      subcategory: string;
      amounts: number[];
      count: number;
    }
  >();

  for (const exp of standaloneExpenses) {
    const cat = (exp.category || '').trim();
    const sub = (exp.subcategory || '').trim();
    const rec = (exp.recipient || '').trim();
    if (!cat) continue;

    const isGivingPattern =
      cat.toLowerCase().includes('giving') ||
      sub.toLowerCase().includes('giving') ||
      rec.toLowerCase().includes('support') ||
      rec.toLowerCase().includes('tithe') ||
      rec.toLowerCase().includes('offering');

    const groupLabel = rec && isGivingPattern ? rec : sub || cat;
    const key = groupLabel.toLowerCase();

    const prev = expensePatternGroups.get(key) || {
      label: groupLabel,
      category: cat,
      subcategory: sub || (isGivingPattern ? 'Givings' : ''),
      amounts: [],
      count: 0,
    };
    if (exp.amount > 0) prev.amounts.push(exp.amount);
    prev.count += 1;
    expensePatternGroups.set(key, prev);
  }

  for (const [key, group] of expensePatternGroups.entries()) {
    const isGiving =
      group.category.toLowerCase().includes('giving') ||
      group.subcategory.toLowerCase().includes('giving');
    if (group.count < 2 && !isGiving) continue;
    if (suggestionsMap.has(key)) continue;

    const avgAmt =
      group.amounts.length > 0
        ? Math.round(
            (group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length) * 100
          ) / 100
        : 50;

    suggestionsMap.set(key, {
      id: `sug_exp_${key.replace(/[^a-z0-9]/g, '_')}`,
      name: group.label,
      type: 'fixed',
      value: avgAmt,
      routeTo: 'expense',
      expenseCategory: group.category,
      expenseSubcategory: group.subcategory || undefined,
      reason: `Learned from ${group.count} expense record${
        group.count === 1 ? '' : 's'
      } in ${group.category}${group.subcategory ? ` → ${group.subcategory}` : ''}`,
      frequency: group.count,
      isAlreadyDefinedCut: false,
    });
  }

  return Array.from(suggestionsMap.values()).sort(
    (a, b) => b.frequency - a.frequency
  );
}

/**
 * Generates actionable record & deduction rule suggestions across the user's ledger
 * so the user can select and record them directly from the Agent.
 */
export function buildActionableAgentSuggestions(params: {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
}): AgentRecordAction[] {
  const { incomes, expenses, accounts, settings, currency } = params;
  const todayStr = new Date().toISOString().split('T')[0];
  const currentQuarter = getQuarterFromDate(todayStr);
  const actions: AgentRecordAction[] = [];

  const learned = learnDeductionSuggestions({
    incomes,
    expenses,
    settings,
    activeDate: todayStr,
  });

  const q1Default = settings.quarterlyRates?.q1TargetRate || 10;
  const q2Default = settings.quarterlyRates?.q2TargetRate || 15;
  const q3Default = settings.quarterlyRates?.q3TargetRate || 20;
  const q4Default = settings.quarterlyRates?.q4TargetRate || 25;
  const currentQuarterDefault =
    currentQuarter === 'Q1'
      ? q1Default
      : currentQuarter === 'Q2'
      ? q2Default
      : currentQuarter === 'Q3'
      ? q3Default
      : q4Default;

  // 1. Suggest adding any learned deduction rules that aren't saved in Defined Deductions yet
  for (const item of learned) {
    if (!item.isAlreadyDefinedCut) {
      actions.push({
        id: `act_rule_${item.id}`,
        kind: 'apply_deduction_rule',
        title: `Save "${item.name}" as a Defined Deduction`,
        summary: `${
          item.type === 'percentage'
            ? `${item.value}%`
            : formatAmount(item.value, currency)
        } · ${
          item.routeTo === 'savings_split'
            ? 'Savings Split Transfer'
            : `${item.expenseCategory || 'Expense'}${
                item.expenseSubcategory ? ` → ${item.expenseSubcategory}` : ''
              }`
        }`,
        reason: item.reason,
        deductionRule: {
          name: item.name,
          type: item.type,
          amount: item.value,
          quarterlyRates: item.quarterlyRates,
          isSavingsSplit: item.routeTo === 'savings_split',
          expenseCategory: item.expenseCategory,
          expenseSubcategory: item.expenseSubcategory,
          destinationAccountId:
            settings.defaultAccountId || accounts[0]?.id || 'acc_main',
          enabled: true,
        },
      });
    }
  }

  // 2. If user has no Savings deduction rule defined yet, suggest creating a quarterly Savings rule
  const hasSavingsRule = (settings.customCuts || []).some((c) =>
    isSavingsDeduction(c)
  );
  if (!hasSavingsRule) {
    actions.push({
      id: 'act_rule_quarterly_savings',
      kind: 'apply_deduction_rule',
      title: 'Define Quarterly Savings Deduction (Q1–Q4)',
      summary: `Q1: ${q1Default}% · Q2: ${q2Default}% · Q3: ${q3Default}% · Q4: ${q4Default}% → Savings Vault Splits`,
      reason: `Automatically routes ${currentQuarter} savings into your configured Savings Vaults when recording income.`,
      deductionRule: {
        name: 'Savings',
        type: 'percentage',
        amount: currentQuarterDefault,
        quarterlyRates: {
          Q1: q1Default,
          Q2: q2Default,
          Q3: q3Default,
          Q4: q4Default,
        },
        isSavingsSplit: true,
        destinationAccountId:
          settings.defaultAccountId || accounts[0]?.id || 'acc_main',
        enabled: true,
      },
    });
  }

  // 3. Suggest "Others to support" -> Giving & Speaking -> Givings if not yet defined
  const hasGivingSupportRule = (settings.customCuts || []).some(
    (c) =>
      c.name.toLowerCase().includes('support') ||
      c.name.toLowerCase().includes('giving') ||
      (c.expenseCategory || '').toLowerCase().includes('giving')
  );
  if (!hasGivingSupportRule) {
    actions.push({
      id: 'act_rule_others_to_support',
      kind: 'apply_deduction_rule',
      title: 'Define "Others to support" Deduction Rule',
      summary: '5% · Expense → Giving & Speaking → Givings',
      reason:
        'Matches "Others to support" directly with Givings under the Giving & Speaking category.',
      deductionRule: {
        name: 'Others to support',
        type: 'percentage',
        amount: 5,
        isSavingsSplit: false,
        expenseCategory: 'Giving & Speaking',
        expenseSubcategory: 'Givings',
        destinationAccountId:
          settings.defaultAccountId || accounts[0]?.id || 'acc_main',
        enabled: true,
      },
    });
  }

  // 4. Learn recurring income source to offer a 1-click draft income record with matched deductions
  if (incomes.length > 0) {
    const sourceCounts = new Map<
      string,
      {
        count: number;
        latestGross: number;
        notes?: string;
        category: string;
        accountId?: string;
      }
    >();
    for (const inc of incomes) {
      const src = (inc.clientOrSource || '').trim();
      if (!src) continue;
      const cur = sourceCounts.get(src) || {
        count: 0,
        latestGross: inc.grossAmount,
        notes: inc.notes,
        category: inc.category || 'Salary',
        accountId: inc.accountId,
      };
      cur.count += 1;
      sourceCounts.set(src, cur);
    }
    const topIncome = Array.from(sourceCounts.entries()).sort(
      (a, b) => b[1].count - a[1].count
    )[0];

    if (topIncome) {
      const [srcName, info] = topIncome;
      actions.push({
        id: `act_inc_${srcName.replace(/[^a-z0-9]/gi, '_')}`,
        kind: 'record_income',
        title: `Record ${srcName} (${currentQuarter} Deductions Applied)`,
        summary: `${formatAmount(info.latestGross, currency)}${
          info.notes ? ` · ${info.notes}` : ''
        }`,
        reason: `Learned from ${info.count} past "${srcName}" income record${
          info.count === 1 ? '' : 's'
        } with automatic ${currentQuarter} deduction rates.`,
        incomeDraft: {
          clientOrSource: srcName,
          notes: info.notes,
          category: info.category,
          grossAmount: info.latestGross,
          date: todayStr,
          accountId: info.accountId || settings.defaultAccountId || accounts[0]?.id,
          applySuggestedDeductions: true,
        },
      });
    }
  }

  // 5. Learn top recurring standalone expense to offer a 1-click expense record
  const standaloneExpenses = expenses.filter(
    (e) =>
      !e.incomeReceiptId &&
      !e.id.startsWith('exp_cut_') &&
      !e.id.startsWith('exp_ded_')
  );
  if (standaloneExpenses.length > 0) {
    const expCounts = new Map<
      string,
      {
        count: number;
        recipient: string;
        category: string;
        subcategory?: string;
        latestAmount: number;
        accountId?: string;
      }
    >();
    for (const exp of standaloneExpenses) {
      const key = `${exp.category}|${exp.subcategory || ''}|${exp.recipient || ''}`;
      const cur = expCounts.get(key) || {
        count: 0,
        recipient: exp.recipient || exp.subcategory || exp.category,
        category: exp.category,
        subcategory: exp.subcategory,
        latestAmount: exp.amount,
        accountId: exp.accountId,
      };
      cur.count += 1;
      expCounts.set(key, cur);
    }
    const topExp = Array.from(expCounts.values()).sort(
      (a, b) => b.count - a.count
    )[0];
    if (topExp) {
      actions.push({
        id: `act_exp_${topExp.category.replace(/[^a-z0-9]/gi, '_')}`,
        kind: 'record_expense',
        title: `Record Expense: ${topExp.recipient}`,
        summary: `${formatAmount(topExp.latestAmount, currency)} · ${
          topExp.category
        }${topExp.subcategory ? ` → ${topExp.subcategory}` : ''}`,
        reason: `Learned from ${topExp.count} past expense record${
          topExp.count === 1 ? '' : 's'
        } in ${topExp.category}.`,
        expenseDraft: {
          recipient: topExp.recipient,
          category: topExp.category,
          subcategory: topExp.subcategory,
          amount: topExp.latestAmount,
          date: todayStr,
          accountId: topExp.accountId || settings.defaultAccountId || accounts[0]?.id,
        },
      });
    }
  }

  return actions;
}

/**
 * Converts a LearnedDeductionSuggestion into an IncomeDeductionItem for a given gross amount and date.
 */
export function suggestionToIncomeDeductionItem(
  suggestion: LearnedDeductionSuggestion,
  grossAmount: number,
  dateStr: string
): IncomeDeductionItem {
  const isSav = suggestion.routeTo === 'savings_split';
  const activeQuarter = getQuarterFromDate(dateStr);
  const resolvedValue =
    isSav && suggestion.quarterlyRates
      ? suggestion.quarterlyRates[activeQuarter] ?? suggestion.value
      : suggestion.value;

  return {
    id: suggestion.definedCutId
      ? `ded_${suggestion.definedCutId}`
      : `ded_sug_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: suggestion.name,
    type: suggestion.type,
    value: resolvedValue,
    amount: computeDeductionAmount(grossAmount, suggestion.type, resolvedValue),
    isSavingsSplit: isSav,
    expenseCategory: !isSav ? suggestion.expenseCategory : undefined,
    expenseSubcategory: !isSav ? suggestion.expenseSubcategory : undefined,
  };
}
