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
  computeSavingsBreakdown,
  formatAmount,
  isSavingsVaultAccount,
  resolveValidAccountId,
  resolveIntuitiveSubcategoryColor,
  LEGACY_SEEDED_CUT_IDS,
} from './calculations.ts';
import {
  convertCurrency2dp,
  roundTo2Decimals,
  getAccountCurrency,
  MarketFxSnapshot,
} from './currencyService.ts';

export interface LearnedVaultDebitSuggestion {
  vaultAccountId: string;
  vaultAccountName: string;
  vaultCurrency: string;
  reason: string;
  matchCount: number;
  matchedBy: 'recipient' | 'subcategory' | 'category';
}

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
 * and expense records across the board. When `targetCurrency` is provided and differs from
 * the app's base currency, fixed-value deductions are automatically converted to `targetCurrency`.
 */
export function learnDeductionSuggestions(params: {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  settings: UserSettings;
  activeDate?: string;
  activeSource?: string;
  activeOrigin?: string;
  grossAmount?: number;
  targetCurrency?: string;
  fxSnapshot?: MarketFxSnapshot | null;
}): LearnedDeductionSuggestion[] {
  const {
    incomes,
    expenses,
    settings,
    activeDate = new Date().toISOString().split('T')[0],
    activeSource = '',
    activeOrigin = '',
    targetCurrency,
    fxSnapshot,
  } = params;

  const baseCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const activeCurr = (targetCurrency || baseCurr).trim().toUpperCase();

  const activeQuarter: Quarter = getQuarterFromDate(activeDate);
  const definedCuts = (settings.customCuts || []).filter(
    (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
  );
  const suggestionsMap = new Map<string, LearnedDeductionSuggestion>();

  const normSource = activeSource.trim().toLowerCase();
  const normOrigin = activeOrigin.trim().toLowerCase();

  // 1. Learn from Defined Deductions in Settings (with quarterly savings awareness & fixed currency equivalence)
  for (const cut of definedCuts) {
    const key = cut.name.trim().toLowerCase();
    const isSav = isSavingsDeduction(cut);
    const { rate: rawRate } = isSav
      ? getSavingsCutRateForDate(cut, activeDate)
      : { rate: cut.amount };

    const rate =
      cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(rawRate, baseCurr, activeCurr, fxSnapshot)
            .convertedAmount
        : rawRate;

    const convertedQ1 =
      cut.quarterlyRates && cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(
            cut.quarterlyRates.Q1 ?? cut.amount,
            baseCurr,
            activeCurr,
            fxSnapshot
          ).convertedAmount
        : cut.quarterlyRates?.Q1;
    const convertedQ2 =
      cut.quarterlyRates && cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(
            cut.quarterlyRates.Q2 ?? cut.amount,
            baseCurr,
            activeCurr,
            fxSnapshot
          ).convertedAmount
        : cut.quarterlyRates?.Q2;
    const convertedQ3 =
      cut.quarterlyRates && cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(
            cut.quarterlyRates.Q3 ?? cut.amount,
            baseCurr,
            activeCurr,
            fxSnapshot
          ).convertedAmount
        : cut.quarterlyRates?.Q3;
    const convertedQ4 =
      cut.quarterlyRates && cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(
            cut.quarterlyRates.Q4 ?? cut.amount,
            baseCurr,
            activeCurr,
            fxSnapshot
          ).convertedAmount
        : cut.quarterlyRates?.Q4;

    const mapping = !isSav
      ? resolveDeductionExpenseMapping(cut, settings, expenses)
      : undefined;

    suggestionsMap.set(key, {
      id: `sug_def_${cut.id}`,
      name: cut.name,
      type: cut.type,
      value: rate,
      quarterlyRates:
        cut.quarterlyRates &&
        convertedQ1 !== undefined &&
        convertedQ2 !== undefined &&
        convertedQ3 !== undefined &&
        convertedQ4 !== undefined
          ? {
              Q1: convertedQ1,
              Q2: convertedQ2,
              Q3: convertedQ3,
              Q4: convertedQ4,
            }
          : cut.quarterlyRates,
      routeTo: isSav ? 'savings_split' : 'expense',
      expenseCategory: mapping?.category,
      expenseSubcategory: mapping?.subcategory,
      reason: isSav
        ? `Defined Savings rule · ${activeQuarter} rate (${rate}${cut.type === 'percentage' ? '%' : ''})`
        : `Defined rule · ${mapping?.subcategory || mapping?.category || 'Expense'}`,
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
    const incCurr = (inc.currency || baseCurr).trim().toUpperCase();
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

      const rawNumVal = Number(ded.value) || Number(ded.amount) || 0;
      const numVal =
        ded.type === 'fixed' && incCurr !== activeCurr
          ? convertCurrency2dp(rawNumVal, incCurr, activeCurr, fxSnapshot)
              .convertedAmount
          : rawNumVal;

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
          mapping ? ` · ${mapping.subcategory || mapping.category}` : ''
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
    const expBaseAmt = Number(exp.amount) || 0;
    const expConvertedAmt =
      activeCurr !== baseCurr
        ? convertCurrency2dp(expBaseAmt, baseCurr, activeCurr, fxSnapshot)
            .convertedAmount
        : expBaseAmt;
    if (expConvertedAmt > 0) prev.amounts.push(expConvertedAmt);
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
      } in ${group.subcategory || group.category}`,
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

/**
 * Learns from past expenses that were debited ONLY from a Savings Vault
 * (`isSavingsVaultAccount(acc, settings)` and `vaultAction !== 'credit'`)
 * so incoming expenses matching a past vault-debit recipient, subcategory, or category
 * can automatically debit the appropriate Savings Vault.
 */
export function learnSavingsVaultDebitAccount(params: {
  recipient?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
}): LearnedVaultDebitSuggestion | null {
  const {
    recipient = '',
    description = '',
    category = '',
    subcategory = '',
    expenses,
    accounts,
    settings,
  } = params;

  const vaultAccountMap = new Map<string, FinancialAccount>();
  for (const acc of accounts) {
    if (isSavingsVaultAccount(acc, settings)) {
      vaultAccountMap.set(acc.id, acc);
    }
  }
  if (vaultAccountMap.size === 0) return null;

  // Consider only past expenses that were debited from a Savings Vault
  const pastVaultDebits = expenses.filter(
    (e) =>
      Boolean(e.accountId && vaultAccountMap.has(e.accountId)) &&
      e.vaultAction !== 'credit' &&
      !e.id.startsWith('exp_ded_') &&
      !e.id.startsWith('exp_cut_')
  );
  if (pastVaultDebits.length === 0) return null;

  const normRec = (recipient || description).trim().toLowerCase();
  const normSub = subcategory.trim().toLowerCase();
  const normCat = category.trim().toLowerCase();

  // 1. Match by Recipient / Cause Description (highest confidence)
  if (normRec.length >= 2) {
    const recCounts = new Map<string, number>();
    for (const exp of pastVaultDebits) {
      const expRec = (exp.recipient || exp.description || '').trim().toLowerCase();
      if (!expRec) continue;
      if (
        expRec === normRec ||
        (normRec.length >= 4 && (expRec.includes(normRec) || normRec.includes(expRec)))
      ) {
        const vId = exp.accountId!;
        recCounts.set(vId, (recCounts.get(vId) || 0) + 1);
      }
    }
    if (recCounts.size > 0) {
      const [bestVaultId, count] = Array.from(recCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      const vaultAcc = vaultAccountMap.get(bestVaultId);
      if (vaultAcc) {
        return {
          vaultAccountId: vaultAcc.id,
          vaultAccountName: vaultAcc.name,
          vaultCurrency: vaultAcc.currency || settings.currency || 'USD',
          reason: `Auto-debit from ${vaultAcc.name} (learned from ${count} past vault debit${count === 1 ? '' : 's'} for "${recipient || description}")`,
          matchCount: count,
          matchedBy: 'recipient',
        };
      }
    }
  }

  // 2. Match by Subcategory (when subcategory has been debited from a Savings Vault)
  if (normSub.length >= 2) {
    const subVaultCounts = new Map<string, number>();
    let subNonVaultCount = 0;
    for (const exp of expenses) {
      if (exp.vaultAction === 'credit') continue;
      const expSub = (exp.subcategory || '').trim().toLowerCase();
      if (expSub !== normSub) continue;
      if (exp.accountId && vaultAccountMap.has(exp.accountId)) {
        subVaultCounts.set(
          exp.accountId,
          (subVaultCounts.get(exp.accountId) || 0) + 1
        );
      } else {
        subNonVaultCount += 1;
      }
    }
    if (subVaultCounts.size > 0) {
      const [bestVaultId, count] = Array.from(subVaultCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      // Trigger if this subcategory is predominantly or exclusively debited from a Savings Vault
      if (count >= subNonVaultCount) {
        const vaultAcc = vaultAccountMap.get(bestVaultId);
        if (vaultAcc) {
          return {
            vaultAccountId: vaultAcc.id,
            vaultAccountName: vaultAcc.name,
            vaultCurrency: vaultAcc.currency || settings.currency || 'USD',
            reason: `Auto-debit from ${vaultAcc.name} (learned from ${count} past vault debit${count === 1 ? '' : 's'} in "${subcategory}")`,
            matchCount: count,
            matchedBy: 'subcategory',
          };
        }
      }
    }
  }

  // 3. Match by Category (only when category is exclusively debited from a Savings Vault)
  if (normCat.length >= 2 && !normSub) {
    const catVaultCounts = new Map<string, number>();
    let catNonVaultCount = 0;
    for (const exp of expenses) {
      if (exp.vaultAction === 'credit') continue;
      const expCat = (exp.category || '').trim().toLowerCase();
      if (expCat !== normCat) continue;
      if (exp.accountId && vaultAccountMap.has(exp.accountId)) {
        catVaultCounts.set(
          exp.accountId,
          (catVaultCounts.get(exp.accountId) || 0) + 1
        );
      } else {
        catNonVaultCount += 1;
      }
    }
    if (catVaultCounts.size > 0 && catNonVaultCount === 0) {
      const [bestVaultId, count] = Array.from(catVaultCounts.entries()).sort(
        (a, b) => b[1] - a[1]
      )[0];
      const vaultAcc = vaultAccountMap.get(bestVaultId);
      if (vaultAcc) {
        return {
          vaultAccountId: vaultAcc.id,
          vaultAccountName: vaultAcc.name,
          vaultCurrency: vaultAcc.currency || settings.currency || 'USD',
          reason: `Auto-debit from ${vaultAcc.name} (learned from ${count} past vault debit${count === 1 ? '' : 's'} in "${category}")`,
          matchCount: count,
          matchedBy: 'category',
        };
      }
    }
  }

  return null;
}

export interface PlannedSavingsVaultDebit {
  vaultAccountId: string;
  vaultAccountName: string;
  vaultBucketId: string;
  vaultPercentage: number;
  vaultCurrency: string;
  recipient: string;
  category: string;
  subcategory?: string;
  subcategoryColor?: string;
  description: string;
  notes?: string;
  shareAmountInIncomeCurr: number;
  debitAmountInVaultCurr: number;
  debitAmountInBaseCurr: number;
  exchangeRateToBase: number;
  pastMatchCount: number;
  lastDebitDate?: string;
}

/**
 * Builds an automated Savings Vault debit plan for each respective Savings Vault funded by
 * a saving rate deduction, learning the primary/most-recent expense pattern previously debited
 * from each respective vault.
 */
export function buildAutomatedSavingsVaultDebitPlan(params: {
  savingsAmountInIncomeCurr: number;
  incomeCurrency: string;
  incomeDate: string;
  incomeSource?: string;
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  fxSnapshot?: MarketFxSnapshot | null;
}): PlannedSavingsVaultDebit[] {
  const {
    savingsAmountInIncomeCurr,
    incomeCurrency,
    expenses,
    accounts,
    settings,
    fxSnapshot,
  } = params;

  const cleanSavingsAmt = roundTo2Decimals(Math.max(0, savingsAmountInIncomeCurr));
  if (cleanSavingsAmt <= 0) return [];

  const baseCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const incCurr = (incomeCurrency || baseCurr).trim().toUpperCase();

  const shares = computeSavingsBreakdown(cleanSavingsAmt, accounts, settings);
  if (shares.length === 0) return [];

  const pastVaultDebits = (expenses || []).filter(
    (e) =>
      Boolean(e.accountId) &&
      e.vaultAction !== 'credit' &&
      !e.id.startsWith('exp_ded_') &&
      !e.id.startsWith('exp_cut_') &&
      !e.id.startsWith('inc_ded_exp_')
  );

  const plans: PlannedSavingsVaultDebit[] = [];

  for (const share of shares) {
    if (share.amount <= 0) continue;

    // Match historical expenses debited specifically from THIS respective Savings Vault
    const vaultHistory = pastVaultDebits.filter((exp) => {
      if (exp.accountId === share.accountId) return true;
      const resolvedAccId = resolveValidAccountId(exp.accountId, accounts, settings);
      return resolvedAccId === share.accountId;
    });

    if (vaultHistory.length === 0) continue;

    // Group by normalized cause/category/subcategory signature, weighting frequency & recency
    const sortedRecent = [...vaultHistory].sort((a, b) => {
      const cmp = (b.date || '').localeCompare(a.date || '');
      if (cmp !== 0) return cmp;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    interface CauseGroup {
      signature: string;
      sample: FlexibleExpense;
      count: number;
      latestDate: string;
      score: number;
    }

    const groups = new Map<string, CauseGroup>();
    sortedRecent.forEach((exp, idx) => {
      const rec = (exp.recipient || exp.description || '').trim();
      const cat = (exp.category || 'Savings Allocation').trim();
      const sub = (exp.subcategory || '').trim();
      const sig = `${rec.toLowerCase()}||${cat.toLowerCase()}||${sub.toLowerCase()}`;
      const recencyBoost = Math.max(1, sortedRecent.length - idx);
      const prev = groups.get(sig);
      if (prev) {
        prev.count += 1;
        prev.score += 10 + recencyBoost;
      } else {
        groups.set(sig, {
          signature: sig,
          sample: exp,
          count: 1,
          latestDate: exp.date || '',
          score: 10 + recencyBoost,
        });
      }
    });

    const best = Array.from(groups.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.latestDate || '').localeCompare(a.latestDate || '');
    })[0];

    if (!best) continue;

    const sample = best.sample;
    const vaultAcc = accounts.find((a) => a.id === share.accountId);
    const vaultCurr = getAccountCurrency(vaultAcc, baseCurr);

    const debitInVaultCurr =
      incCurr === vaultCurr
        ? roundTo2Decimals(share.amount)
        : convertCurrency2dp(share.amount, incCurr, vaultCurr, fxSnapshot)
            .convertedAmount;

    const toBase =
      vaultCurr === baseCurr
        ? { convertedAmount: debitInVaultCurr, exchangeRate2dp: 1 }
        : convertCurrency2dp(debitInVaultCurr, vaultCurr, baseCurr, fxSnapshot);

    if (toBase.convertedAmount <= 0) continue;

    const resolvedRecipient =
      (sample.recipient || '').trim() ||
      (sample.description || '').trim() ||
      (sample.subcategory || '').trim() ||
      share.accountName;
    const resolvedCategory = (sample.category || '').trim() || 'Savings Allocation';
    const resolvedSub = (sample.subcategory || '').trim() || undefined;
    const resolvedColor =
      sample.subcategoryColor ||
      (resolvedSub
        ? resolveIntuitiveSubcategoryColor(
            resolvedSub,
            resolvedCategory,
            settings,
            expenses
          )
        : undefined);

    plans.push({
      vaultAccountId: share.accountId,
      vaultAccountName: share.accountName,
      vaultBucketId: share.bucketId,
      vaultPercentage: share.percentage,
      vaultCurrency: vaultCurr,
      recipient: resolvedRecipient,
      category: resolvedCategory,
      subcategory: resolvedSub,
      subcategoryColor: resolvedColor,
      description:
        (sample.description || '').trim() ||
        resolvedSub ||
        resolvedRecipient ||
        resolvedCategory,
      notes: (sample.notes || '').trim() || undefined,
      shareAmountInIncomeCurr: roundTo2Decimals(share.amount),
      debitAmountInVaultCurr: debitInVaultCurr,
      debitAmountInBaseCurr: toBase.convertedAmount,
      exchangeRateToBase: toBase.exchangeRate2dp,
      pastMatchCount: vaultHistory.length,
      lastDebitDate: best.latestDate || undefined,
    });
  }

  return plans;
}

export function plannedVaultDebitToExpensePayload(
  plan: PlannedSavingsVaultDebit,
  params: {
    date: string;
    batchId: string;
    incomeSource?: string;
  }
): Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'> {
  const autoNote = params.incomeSource
    ? `Auto-debited from ${plan.vaultAccountName} (${params.incomeSource})`
    : `Auto-debited from ${plan.vaultAccountName}`;

  return {
    date: params.date,
    batchId: params.batchId,
    accountId: plan.vaultAccountId,
    vaultAction: 'debit',
    recipient: plan.recipient,
    category: plan.category,
    subcategory: plan.subcategory,
    subcategoryColor: plan.subcategoryColor,
    description: plan.description,
    notes: plan.notes ? `${plan.notes} · ${autoNote}` : autoNote,
    currency: plan.vaultCurrency,
    originalAmount: plan.debitAmountInVaultCurr,
    exchangeRate: plan.exchangeRateToBase,
    amount: plan.debitAmountInBaseCurr,
  };
}

export interface FrequentExpenseSuggestion {
  id: string;
  label: string;
  recipient: string;
  category: string;
  subcategory: string;
  accountId: string;
  currency: string;
  typicalAmount: number;
  notes?: string;
  count: number;
  lastDate: string;
  isVaultDebit: boolean;
}

/**
 * Dynamically extracts the top recurring expense patterns from recorded history,
 * grouping by category + subcategory with recency-weighted frequency scoring,
 * dominant account resolution, and typical recent spend calculation.
 * Leaves `recipient` (To / Cause) and `notes` blank so users enter context freely on tap.
 */
export function learnTopFrequentExpenses(params: {
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
  limit?: number;
}): FrequentExpenseSuggestion[] {
  const { expenses, accounts, settings, currency, limit = 5 } = params;
  const baseCurr = (settings.currency || currency || 'GHS').trim().toUpperCase();
  const defaultAcc =
    accounts.find((a) => a.id === settings.defaultAccountId) ||
    accounts.find((a) => a.isDefaultDeposit) ||
    accounts[0];

  const eligible = (expenses || []).filter(
    (e) =>
      !e.id.startsWith('exp_ded_') &&
      !e.id.startsWith('exp_cut_') &&
      !e.id.startsWith('inc_ded_exp_') &&
      e.vaultAction !== 'credit'
  );

  if (eligible.length === 0) return [];

  // Sort most recent first so recency decay and recent typical amounts are accurate
  const sortedByRecency = [...eligible].sort((a, b) => {
    const dateCmp = (b.date || '').localeCompare(a.date || '');
    if (dateCmp !== 0) return dateCmp;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const totalEligible = sortedByRecency.length;

  interface PatternBucket {
    signature: string;
    category: string;
    subcategory: string;
    latest: FlexibleExpense;
    count: number;
    score: number;
    lastDate: string;
    recentAmounts: number[];
    accountCounts: Map<string, number>;
  }

  const groups = new Map<string, PatternBucket>();

  sortedByRecency.forEach((exp, idx) => {
    const rawCat = (exp.category || '').trim();
    const rawSub = (exp.subcategory || '').trim();
    const cat = rawCat || 'Uncategorized';
    const sub = rawSub;
    if (!rawCat && !rawSub) return;

    const sig = `${cat.toLowerCase()}||${sub.toLowerCase()}`;
    const recencyWeight = (totalEligible - idx) / totalEligible; // 1.0 for newest -> ~0 for oldest
    const resolvedAccId =
      resolveValidAccountId(exp.accountId, accounts, settings) ||
      defaultAcc?.id ||
      '';
    const rawAmt = Number(exp.originalAmount ?? exp.amount) || 0;

    const existing = groups.get(sig);
    if (existing) {
      existing.count += 1;
      existing.score += 10 + recencyWeight * 6;
      if (rawAmt > 0 && existing.recentAmounts.length < 5) {
        existing.recentAmounts.push(roundTo2Decimals(rawAmt));
      }
      if (resolvedAccId) {
        existing.accountCounts.set(
          resolvedAccId,
          (existing.accountCounts.get(resolvedAccId) || 0) + 1
        );
      }
    } else {
      const accountCounts = new Map<string, number>();
      if (resolvedAccId) {
        accountCounts.set(resolvedAccId, 1);
      }
      groups.set(sig, {
        signature: sig,
        category: cat,
        subcategory: sub,
        latest: exp,
        count: 1,
        score: 10 + recencyWeight * 6,
        lastDate: exp.date || '',
        recentAmounts: rawAmt > 0 ? [roundTo2Decimals(rawAmt)] : [],
        accountCounts,
      });
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
      const dateCmp = (b.lastDate || '').localeCompare(a.lastDate || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.latest.createdAt || '').localeCompare(a.latest.createdAt || '');
    })
    .slice(0, Math.max(1, limit))
    .map((group) => {
      const sample = group.latest;
      const dominantAccountId =
        Array.from(group.accountCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        resolveValidAccountId(sample.accountId, accounts, settings) ||
        defaultAcc?.id ||
        '';
      const matchedAcc = accounts.find((a) => a.id === dominantAccountId) || defaultAcc;
      const accCurr = getAccountCurrency(matchedAcc, baseCurr);
      const expCurr = (sample.currency || accCurr || baseCurr).trim().toUpperCase();

      // Use median of up to 5 most recent entries for a resilient typical amount
      let typicalAmount = 0;
      if (group.recentAmounts.length > 0) {
        const sortedAmts = [...group.recentAmounts].sort((a, b) => a - b);
        const mid = Math.floor(sortedAmts.length / 2);
        typicalAmount =
          sortedAmts.length % 2 === 1
            ? sortedAmts[mid]
            : roundTo2Decimals((sortedAmts[mid - 1] + sortedAmts[mid]) / 2);
      }

      const label = group.subcategory || group.category;

      return {
        id: `freq_exp_${group.signature.replace(/[^a-z0-9]/gi, '_')}`,
        label,
        recipient: '',
        category: group.category,
        subcategory: group.subcategory,
        accountId: dominantAccountId,
        currency: expCurr,
        typicalAmount: roundTo2Decimals(typicalAmount),
        notes: undefined,
        count: group.count,
        lastDate: group.lastDate,
        isVaultDebit: matchedAcc ? isSavingsVaultAccount(matchedAcc, settings) : false,
      };
    });
}

export interface ManualTransferVaultShare {
  bucketId: string;
  vaultAccountId: string;
  vaultAccountName: string;
  vaultPercentage: number;
  sourceCurrency: string;
  sourceAmount: number;
  vaultCurrency: string;
  destinationAmount: number;
  baseAmount: number;
  exchangeRateToDest: number;
  debitPlan: PlannedSavingsVaultDebit | null;
}

/**
 * Distributes a manual transfer amount across each configured Savings Vault by rate
 * and matches any historical vault-debit expense pattern per vault.
 */
export function buildManualTransferSavingsVaultPlan(params: {
  amountInSourceCurr: number;
  sourceAccountId: string;
  sourceCurrency: string;
  date: string;
  description?: string;
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  fxSnapshot?: MarketFxSnapshot | null;
}): ManualTransferVaultShare[] {
  const {
    amountInSourceCurr,
    sourceAccountId,
    sourceCurrency,
    date,
    expenses,
    accounts,
    settings,
    fxSnapshot,
  } = params;

  const cleanAmt = roundTo2Decimals(Math.max(0, Number(amountInSourceCurr) || 0));
  const baseCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const srcCurr = (sourceCurrency || baseCurr).trim().toUpperCase();

  const shares = computeSavingsBreakdown(cleanAmt, accounts, settings).filter(
    (s) => s.accountId !== sourceAccountId && s.percentage > 0
  );
  if (shares.length === 0) return [];

  // Build per-vault debit plans for the full distributed amount (or unit probe when amount is 0)
  const effectiveProbeAmt = cleanAmt > 0 ? cleanAmt : 100;
  const debitPlans = buildAutomatedSavingsVaultDebitPlan({
    savingsAmountInIncomeCurr: effectiveProbeAmt,
    incomeCurrency: srcCurr,
    incomeDate: date,
    expenses,
    accounts,
    settings,
    fxSnapshot,
  });
  const debitPlanMap = new Map<string, PlannedSavingsVaultDebit>();
  for (const dp of debitPlans) {
    debitPlanMap.set(dp.vaultAccountId, dp);
  }

  return shares.map((share) => {
    const vaultAcc = accounts.find((a) => a.id === share.accountId);
    const vaultCurr = getAccountCurrency(vaultAcc, baseCurr);
    const shareSrcAmt = cleanAmt > 0 ? roundTo2Decimals(share.amount) : 0;

    const toDest =
      srcCurr === vaultCurr
        ? { convertedAmount: shareSrcAmt, exchangeRate2dp: 1 }
        : convertCurrency2dp(shareSrcAmt, srcCurr, vaultCurr, fxSnapshot);

    const toBase =
      srcCurr === baseCurr
        ? { convertedAmount: shareSrcAmt, exchangeRate2dp: 1 }
        : convertCurrency2dp(shareSrcAmt, srcCurr, baseCurr, fxSnapshot);

    const matchedDebit = debitPlanMap.get(share.accountId) || null;
    const scaledDebitPlan: PlannedSavingsVaultDebit | null = matchedDebit
      ? {
          ...matchedDebit,
          shareAmountInIncomeCurr: shareSrcAmt,
          debitAmountInVaultCurr:
            cleanAmt > 0 ? toDest.convertedAmount : 0,
          debitAmountInBaseCurr:
            cleanAmt > 0
              ? vaultCurr === baseCurr
                ? toDest.convertedAmount
                : convertCurrency2dp(
                    toDest.convertedAmount,
                    vaultCurr,
                    baseCurr,
                    fxSnapshot
                  ).convertedAmount
              : 0,
        }
      : null;

    return {
      bucketId: share.bucketId,
      vaultAccountId: share.accountId,
      vaultAccountName: share.accountName,
      vaultPercentage: share.percentage,
      sourceCurrency: srcCurr,
      sourceAmount: shareSrcAmt,
      vaultCurrency: vaultCurr,
      destinationAmount: toDest.convertedAmount,
      baseAmount: toBase.convertedAmount,
      exchangeRateToDest: toDest.exchangeRate2dp,
      debitPlan: scaledDebitPlan,
    };
  });
}

export async function requestBackendManualTransferAutomation(params: {
  sourceAccountId: string;
  sourceCurrency: string;
  amount: number;
  date: string;
  description?: string;
  baseCurrency: string;
  accounts: FinancialAccount[];
  settings: UserSettings;
  expenses: FlexibleExpense[];
  distributeToSavingsVaults: boolean;
  applyVaultDebits: boolean;
  excludedDistributionVaultIds: string[];
  excludedDebitVaultIds: string[];
  debitOverrides: Record<
    string,
    {
      recipient?: string;
      category?: string;
      subcategory?: string;
      debitAmountInVaultCurr?: number;
      notes?: string;
    }
  >;
}): Promise<{
  transfers: Array<{
    date: string;
    sourceAccountId: string;
    destinationAccountId: string;
    sourceCurrency: string;
    sourceAmount: number;
    destinationCurrency: string;
    destinationAmount: number;
    exchangeRate: number;
    amount: number;
    transferType: 'general';
    description: string;
  }>;
  vaultDebits: Array<Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>>;
} | null> {
  try {
    const resp = await fetch('/api/transfers/automate-savings-vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceAccountId: params.sourceAccountId,
        sourceCurrency: params.sourceCurrency,
        amount: params.amount,
        date: params.date,
        description: params.description || '',
        baseCurrency: params.baseCurrency,
        accounts: params.accounts,
        savingsBuckets: params.settings.savingsBuckets || [],
        expenses: params.expenses,
        distributeToSavingsVaults: params.distributeToSavingsVaults,
        applyVaultDebits: params.applyVaultDebits,
        excludedDistributionVaultIds: params.excludedDistributionVaultIds,
        excludedDebitVaultIds: params.excludedDebitVaultIds,
        debitOverrides: params.debitOverrides,
        previewOnly: false,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.success) return null;
    return {
      transfers: Array.isArray(data.transfers) ? data.transfers : [],
      vaultDebits: Array.isArray(data.vaultDebits) ? data.vaultDebits : [],
    };
  } catch {
    return null;
  }
}
