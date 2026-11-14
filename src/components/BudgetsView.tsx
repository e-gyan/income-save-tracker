import React, { useState, useMemo, useEffect } from 'react';
import {
  FinancialBudget,
  BudgetPeriodType,
  BudgetScopeType,
  BudgetPurposeType,
  GoalSourceType,
  FlexibleExpense,
  IncomeReceipt,
  AccountTransfer,
  FinancialAccount,
  UserSettings,
} from '../types/finance.ts';
import {
  evaluateAllBudgets,
  EvaluatedBudget,
  normalizeSubcategoryKey,
  getDefaultRecreateDaysForPeriod,
} from '../lib/budgetCalculations.ts';
import {
  getEffectiveExpenseCategoryPreferences,
  resolveIntuitiveSubcategoryColor,
} from '../lib/calculations.ts';
import {
  SUPPORTED_CURRENCIES,
  getAccountCurrency,
  getInitialFxSnapshot,
  fetchMarketExchangeRates,
  MarketFxSnapshot,
  roundTo2Decimals,
  convertCurrency2dp,
} from '../lib/currencyService.ts';
import {
  formatDateDDMMYYYY,
  RecordGroupPeriod,
  groupRecordsByPeriod,
} from '../lib/dateFilters.ts';
import { getColorThemeConfig } from '../lib/colorThemes.ts';
import {
  RecordCard,
  ExpenseDetailPopupModal,
  TransferDetailPopupModal,
} from './RecordCard.tsx';
import {
  Target,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Calendar,
  Layers,
  Tag,
  Wallet,
  ArrowRight,
  Search,
  ChevronRight,
  RotateCcw,
  Archive,
  TrendingUp,
  Lock,
} from 'lucide-react';

function formatCurrency(val: number, curr: string): string {
  const code = (curr || 'GHS').toUpperCase();
  return `${code} ${roundTo2Decimals(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface BudgetsViewProps {
  budgets: FinancialBudget[];
  expenses: FlexibleExpense[];
  incomes: IncomeReceipt[];
  transfers: AccountTransfer[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
  onSaveBudget: (
    budget: Omit<FinancialBudget, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & {
      id?: string;
      createdAt?: string;
    }
  ) => void;
  onDeleteBudget: (budgetId: string) => void;
  onEditExpense?: (expense: FlexibleExpense) => void;
  onDeleteExpense?: (id: string) => void;
  onNavigateToTab?: (tab: any) => void;
}

type WorkspaceTab = 'budgets' | 'goals' | 'expired';

export const BudgetsView: React.FC<BudgetsViewProps> = ({
  budgets,
  expenses,
  incomes,
  transfers,
  accounts,
  settings,
  currency,
  onSaveBudget,
  onDeleteBudget,
  onEditExpense,
  onDeleteExpense,
  onNavigateToTab,
}) => {
  const baseCurrency = (currency || settings.currency || 'GHS').toUpperCase();
  const themeConfig = useMemo(
    () => getColorThemeConfig(settings.colorTheme),
    [settings.colorTheme]
  );
  const [selectedPopupExpense, setSelectedPopupExpense] =
    useState<FlexibleExpense | null>(null);
  const [selectedPopupTransfer, setSelectedPopupTransfer] =
    useState<AccountTransfer | null>(null);
  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(baseCurrency)
  );

  useEffect(() => {
    let active = true;
    fetchMarketExchangeRates(baseCurrency)
      .then((snap) => {
        if (active) setFxSnapshot(snap);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [baseCurrency]);

  // Top-level workspace tab: Active Budgets | Goals | Expired / Disabled
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('budgets');

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FinancialBudget | null>(
    null
  );
  const [purposeType, setPurposeType] = useState<BudgetPurposeType>('budget');
  const [name, setName] = useState('');
  const [goalCause, setGoalCause] = useState('');
  const [goalSourceType, setGoalSourceType] = useState<GoalSourceType>(
    'savings_and_transfers'
  );
  const [periodType, setPeriodType] = useState<BudgetPeriodType>('monthly');
  const [customStartDate, setCustomStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
  });
  const [autoRecreate, setAutoRecreate] = useState<boolean>(true);
  const [recreateDays, setRecreateDays] = useState<string>('30');
  const [scopeType, setScopeType] = useState<BudgetScopeType>('single');
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>(
    []
  );
  const [accountId, setAccountId] = useState<string>('');
  const [budgetCurrency, setBudgetCurrency] = useState<string>(baseCurrency);
  const [amount, setAmount] = useState<string>('');
  const [alertThresholdPercent, setAlertThresholdPercent] =
    useState<string>('80');
  const [notes, setNotes] = useState<string>('');
  const [subSearch, setSubSearch] = useState<string>('');
  const [customSubInput, setCustomSubInput] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Filter state
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | BudgetPeriodType
  >('all');

  // Pop-up modal state when clicking a budget or goal card
  const [activeModalBudgetId, setActiveModalBudgetId] = useState<string | null>(
    null
  );
  const [modalGroupBy, setModalGroupBy] = useState<RecordGroupPeriod>('none');
  const [quickRecreateDays, setQuickRecreateDays] = useState<string>('30');
  const [confirmDeleteBudgetId, setConfirmDeleteBudgetId] = useState<
    string | null
  >(null);

  // Live conversion rate preview when selected budgetCurrency differs from baseCurrency
  const formConversionPreview = useMemo(() => {
    const selectedCurr = (budgetCurrency || baseCurrency).toUpperCase();
    if (selectedCurr === baseCurrency) return null;
    const unitToBase = convertCurrency2dp(
      1,
      selectedCurr,
      baseCurrency,
      fxSnapshot
    );
    const unitFromBase = convertCurrency2dp(
      1,
      baseCurrency,
      selectedCurr,
      fxSnapshot
    );
    const parsedAmt = Number(amount);
    const convertedAmt =
      Number.isFinite(parsedAmt) && parsedAmt > 0
        ? convertCurrency2dp(parsedAmt, selectedCurr, baseCurrency, fxSnapshot)
            .convertedAmount
        : 0;
    return {
      selectedCurr,
      baseCurrency,
      rateToBase: unitToBase.exchangeRate2dp,
      inverseRate: unitFromBase.exchangeRate2dp,
      convertedAmt,
    };
  }, [budgetCurrency, baseCurrency, amount, fxSnapshot]);

  // Gather all available expense subcategories from settings + historical expenses
  const allSubcategoryCatalog = useMemo(() => {
    const prefs = getEffectiveExpenseCategoryPreferences(settings, expenses);
    const map = new Map<
      string,
      { subcategory: string; category: string; color: string }
    >();

    for (const pref of prefs) {
      for (const sub of pref.subcategories || []) {
        const clean = sub.trim();
        if (!clean) continue;
        const key = normalizeSubcategoryKey(clean);
        if (!map.has(key)) {
          map.set(key, {
            subcategory: clean,
            category: pref.name,
            color:
              pref.subcategoryColors?.[clean] ||
              resolveIntuitiveSubcategoryColor(
                clean,
                pref.name,
                settings,
                expenses
              ),
          });
        }
      }
    }

    for (const exp of expenses) {
      const clean = (exp.subcategory || '').trim();
      if (!clean) continue;
      const key = normalizeSubcategoryKey(clean);
      if (!map.has(key)) {
        map.set(key, {
          subcategory: clean,
          category: exp.category || 'General',
          color:
            exp.subcategoryColor ||
            resolveIntuitiveSubcategoryColor(
              clean,
              exp.category,
              settings,
              expenses
            ),
        });
      }
    }

    for (const cut of settings.customCuts || []) {
      const clean = (cut.expenseSubcategory || '').trim();
      if (!clean) continue;
      const key = normalizeSubcategoryKey(clean);
      if (!map.has(key)) {
        map.set(key, {
          subcategory: clean,
          category: cut.expenseCategory || 'Deductions',
          color: resolveIntuitiveSubcategoryColor(
            clean,
            cut.expenseCategory,
            settings,
            expenses
          ),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.subcategory.localeCompare(b.subcategory)
    );
  }, [settings, expenses]);

  const filteredSubcategoryCatalog = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    if (!q) return allSubcategoryCatalog;
    return allSubcategoryCatalog.filter(
      (item) =>
        item.subcategory.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [allSubcategoryCatalog, subSearch]);

  // Evaluate all non-archived budgets and goals
  const evaluatedBudgets = useMemo(() => {
    return evaluateAllBudgets(
      budgets,
      expenses,
      incomes,
      accounts,
      settings,
      fxSnapshot,
      new Date(),
      false,
      transfers
    );
  }, [budgets, expenses, incomes, accounts, settings, fxSnapshot, transfers]);

  // Sync evaluation with backend /api/budgets/evaluate
  useEffect(() => {
    if (budgets.length === 0) return;
    fetch('/api/budgets/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgets: budgets.filter((b) => !b.isArchivedPeriod),
        expenses,
        transfers,
        baseCurrency,
      }),
    }).catch(() => {});
  }, [budgets, expenses, transfers, baseCurrency]);

  // Partition evaluated items into Active Budgets, Active Goals, and Expired / Disabled
  const { activeExpenseBudgets, activeGoals, expiredDisabledItems } =
    useMemo(() => {
      const expBudgets: EvaluatedBudget[] = [];
      const goals: EvaluatedBudget[] = [];
      const expired: EvaluatedBudget[] = [];

      for (const ev of evaluatedBudgets) {
        if (ev.isDisabledFromReach) {
          expired.push(ev);
        } else if (ev.purposeType === 'goal') {
          goals.push(ev);
        } else {
          expBudgets.push(ev);
        }
      }

      return {
        activeExpenseBudgets: expBudgets,
        activeGoals: goals,
        expiredDisabledItems: expired,
      };
    }, [evaluatedBudgets]);

  const displayedEvaluatedBudgets = useMemo(() => {
    const sourceList =
      workspaceTab === 'goals'
        ? activeGoals
        : workspaceTab === 'expired'
        ? expiredDisabledItems
        : activeExpenseBudgets;

    return sourceList.filter((ev) => {
      if (filterPeriod !== 'all' && ev.budget.periodType !== filterPeriod) {
        return false;
      }
      return true;
    });
  }, [
    workspaceTab,
    activeExpenseBudgets,
    activeGoals,
    expiredDisabledItems,
    filterPeriod,
  ]);

  const activeModalEvaluated = useMemo(() => {
    if (!activeModalBudgetId) return null;
    return (
      evaluatedBudgets.find((ev) => ev.budget.id === activeModalBudgetId) ||
      null
    );
  }, [evaluatedBudgets, activeModalBudgetId]);

  useEffect(() => {
    if (activeModalEvaluated) {
      setQuickRecreateDays(
        String(
          activeModalEvaluated.budget.recreateDays ||
            activeModalEvaluated.recreateDays ||
            30
        )
      );
    }
  }, [activeModalEvaluated]);

  const resetForm = (defaultPurpose?: BudgetPurposeType) => {
    const targetPurpose =
      defaultPurpose || (workspaceTab === 'goals' ? 'goal' : 'budget');
    setEditingBudget(null);
    setPurposeType(targetPurpose);
    setName('');
    setGoalCause('');
    setGoalSourceType('savings_and_transfers');
    setPeriodType('monthly');
    const now = new Date();
    setCustomStartDate(
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    );
    setCustomEndDate(
      new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split('T')[0]
    );
    setAutoRecreate(targetPurpose === 'budget');
    setRecreateDays('30');
    setScopeType('single');
    setSelectedSubcategories([]);
    setAccountId('');
    setBudgetCurrency(baseCurrency);
    setAmount('');
    setAlertThresholdPercent('80');
    setNotes('');
    setSubSearch('');
    setCustomSubInput('');
    setFormError('');
  };

  const handlePeriodTypeSelect = (pt: BudgetPeriodType) => {
    setPeriodType(pt);
    const defaultDays = getDefaultRecreateDaysForPeriod(
      pt,
      customStartDate,
      customEndDate
    );
    setRecreateDays(String(defaultDays));
    if (pt !== 'custom') {
      setAutoRecreate(true);
    }
  };

  const handleOpenCreate = (overridePurpose?: BudgetPurposeType) => {
    resetForm(overridePurpose);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (budget: FinancialBudget) => {
    setActiveModalBudgetId(null);
    setConfirmDeleteBudgetId(null);
    setEditingBudget(budget);
    setPurposeType(budget.purposeType === 'goal' ? 'goal' : 'budget');
    setName(budget.name);
    setGoalCause(budget.goalCause || '');
    setGoalSourceType(budget.goalSourceType || 'savings_and_transfers');
    setPeriodType(budget.periodType);
    if (budget.customStartDate) setCustomStartDate(budget.customStartDate);
    if (budget.customEndDate) setCustomEndDate(budget.customEndDate);
    setAutoRecreate(
      budget.periodType !== 'custom' ? true : Boolean(budget.autoRecreate)
    );
    setRecreateDays(
      String(
        budget.recreateDays ||
          getDefaultRecreateDaysForPeriod(
            budget.periodType,
            budget.customStartDate,
            budget.customEndDate
          )
      )
    );
    setScopeType(budget.scopeType);
    setSelectedSubcategories(budget.subcategories || []);
    setAccountId(budget.accountId || '');
    setBudgetCurrency(budget.currency || baseCurrency);
    setAmount(String(budget.amount || ''));
    setAlertThresholdPercent(String(budget.alertThresholdPercent ?? 80));
    setNotes(budget.notes || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleToggleSubcategory = (subName: string) => {
    const clean = subName.trim();
    if (!clean) return;
    setFormError('');

    if (scopeType === 'single') {
      setSelectedSubcategories([clean]);
      if (!name.trim()) {
        setName(`${clean} Budget`);
      }
      return;
    }

    const exists = selectedSubcategories.some(
      (s) => normalizeSubcategoryKey(s) === normalizeSubcategoryKey(clean)
    );
    if (exists) {
      setSelectedSubcategories((prev) =>
        prev.filter(
          (s) => normalizeSubcategoryKey(s) !== normalizeSubcategoryKey(clean)
        )
      );
    } else {
      setSelectedSubcategories((prev) => [...prev, clean]);
    }
  };

  const handleScopeTypeChange = (nextScope: BudgetScopeType) => {
    setScopeType(nextScope);
    if (nextScope === 'single' && selectedSubcategories.length > 1) {
      setSelectedSubcategories([selectedSubcategories[0]]);
    }
  };

  const handleAddCustomSubcategory = () => {
    const clean = customSubInput.trim();
    if (!clean) return;
    handleToggleSubcategory(clean);
    setCustomSubInput('');
  };

  const handleAccountSelectChange = (accId: string) => {
    setAccountId(accId);
    if (accId) {
      const acc = accounts.find((a) => a.id === accId);
      if (acc) {
        setBudgetCurrency(getAccountCurrency(acc, baseCurrency));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanName = name.trim() || (purposeType === 'goal' ? goalCause.trim() : '');
    if (!cleanName) {
      setFormError(
        purposeType === 'goal'
          ? 'Enter a goal name or target cause.'
          : 'Enter a budget name.'
      );
      return;
    }

    const parsedAmount = roundTo2Decimals(Number(amount));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(
        purposeType === 'goal'
          ? 'Enter a valid target amount greater than 0.'
          : 'Enter a valid budget limit greater than 0.'
      );
      return;
    }

    if (purposeType === 'budget') {
      if (selectedSubcategories.length === 0) {
        setFormError(
          scopeType === 'single'
            ? 'Select 1 expense subcategory for this budget.'
            : 'Select at least 1 expense subcategory for this budget.'
        );
        return;
      }
    }

    if (periodType === 'custom') {
      if (!customStartDate || !customEndDate) {
        setFormError('Select both start and end dates for custom period.');
        return;
      }
      if (customEndDate < customStartDate) {
        setFormError('End date cannot be earlier than start date.');
        return;
      }
    }

    const parsedRecreateDays = Math.max(
      1,
      Math.round(
        Number(recreateDays) ||
          getDefaultRecreateDaysForPeriod(
            periodType,
            customStartDate,
            customEndDate
          )
      )
    );

    const finalSubs =
      purposeType === 'goal'
        ? selectedSubcategories.length > 0
          ? selectedSubcategories
          : [goalCause.trim() || cleanName]
        : scopeType === 'single'
        ? [selectedSubcategories[0]]
        : selectedSubcategories;

    const parentCategories = Array.from(
      new Set(
        finalSubs
          .map(
            (sub) =>
              allSubcategoryCatalog.find(
                (c) =>
                  normalizeSubcategoryKey(c.subcategory) ===
                  normalizeSubcategoryKey(sub)
              )?.category
          )
          .filter(Boolean) as string[]
      )
    );

    const parsedThreshold = Math.min(
      100,
      Math.max(1, Math.round(Number(alertThresholdPercent || 80)))
    );

    const effectiveAutoRecreate =
      periodType !== 'custom' ? true : Boolean(autoRecreate);

    if (periodType === 'custom' && effectiveAutoRecreate) {
      const rawDays = Number(recreateDays);
      if (!Number.isFinite(rawDays) || rawDays < 1) {
        setFormError(
          'Enter valid recreation days (at least 1 day) for custom period recreation.'
        );
        return;
      }
    }

    onSaveBudget({
      id: editingBudget?.id,
      createdAt: editingBudget?.createdAt,
      name: cleanName,
      purposeType,
      goalCause:
        purposeType === 'goal' ? goalCause.trim() || cleanName : undefined,
      goalSourceType: purposeType === 'goal' ? goalSourceType : undefined,
      periodType,
      customStartDate: periodType === 'custom' ? customStartDate : undefined,
      customEndDate: periodType === 'custom' ? customEndDate : undefined,
      activePeriodStart: editingBudget?.activePeriodStart,
      activePeriodEnd: editingBudget?.activePeriodEnd,
      autoRecreate: effectiveAutoRecreate,
      recreateDays: effectiveAutoRecreate ? parsedRecreateDays : undefined,
      parentRecurringBudgetId: editingBudget?.parentRecurringBudgetId,
      isArchivedPeriod: false,
      isExpiredDisabled: false,
      scopeType,
      subcategories: finalSubs,
      categories: parentCategories.length > 0 ? parentCategories : undefined,
      accountId: accountId || undefined,
      currency: budgetCurrency,
      amount: parsedAmount,
      alertThresholdPercent: parsedThreshold,
      notes: notes.trim() || undefined,
    });

    if (purposeType === 'goal') {
      setWorkspaceTab('goals');
    } else {
      setWorkspaceTab('budgets');
    }

    setIsFormOpen(false);
    resetForm();
  };

  const handleQuickUpdateRecreation = (
    budget: FinancialBudget,
    enableAutoRecreate: boolean,
    daysInput: string
  ) => {
    const days = Math.max(
      1,
      Math.round(
        Number(daysInput) ||
          getDefaultRecreateDaysForPeriod(
            budget.periodType,
            budget.customStartDate,
            budget.customEndDate
          )
      )
    );
    onSaveBudget({
      ...budget,
      autoRecreate: enableAutoRecreate,
      recreateDays: enableAutoRecreate ? days : undefined,
      isExpiredDisabled: !enableAutoRecreate && Boolean(budget.isExpiredDisabled),
    });
    if (enableAutoRecreate && workspaceTab === 'expired') {
      setWorkspaceTab(budget.purposeType === 'goal' ? 'goals' : 'budgets');
      setActiveModalBudgetId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Workspace Purpose Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-2xs"
                style={{ backgroundColor: 'var(--app-accent)' }}
              >
                <Target className="h-4.5 w-4.5 stroke-[2.2]" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
                  Budgets & Goals
                </h2>
                <p className="text-xs text-slate-500">
                  Expense budgets, savings & transfer goals, and auto-recreation cycles
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                isFormOpen ? setIsFormOpen(false) : handleOpenCreate()
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-2xs transition-all hover:opacity-95 cursor-pointer shrink-0"
              style={{ backgroundColor: 'var(--app-accent)' }}
            >
              {isFormOpen ? (
                <>
                  <X className="h-4 w-4 stroke-[2.5]" />
                  Close Form
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 stroke-[2.5]" />
                  {workspaceTab === 'goals' ? 'New Goal' : 'New Budget / Goal'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Workspace Purpose & Expiration Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 gap-1">
            <button
              type="button"
              onClick={() => setWorkspaceTab('budgets')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                workspaceTab === 'budgets'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Target className="h-3.5 w-3.5 text-emerald-600" />
              Budgets
              <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700">
                {activeExpenseBudgets.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspaceTab('goals')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                workspaceTab === 'goals'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5 text-indigo-600" />
              Goals
              <span className="rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700">
                {activeGoals.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspaceTab('expired')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                workspaceTab === 'expired'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Archive className="h-3.5 w-3.5 text-amber-600" />
              Expired / Disabled
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                  expiredDisabledItems.length > 0
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-200/70 text-slate-700'
                }`}
              >
                {expiredDisabledItems.length}
              </span>
            </button>
          </div>

          <span className="text-[11px] font-medium text-slate-500">
            {workspaceTab === 'budgets' &&
              'Linked to expenses • Auto-recreates when enabled'}
            {workspaceTab === 'goals' &&
              'Linked to savings & transfers • Meets target for a cause'}
            {workspaceTab === 'expired' &&
              'Ended without auto-recreate • Disabled from active reach'}
          </span>
        </div>
      </div>

      {/* Create / Edit Budget or Goal Form */}
      {isFormOpen && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-6 shadow-xs space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-600 stroke-[2.3]" />
              <h3 className="text-sm font-bold text-slate-900">
                {editingBudget
                  ? `Edit ${purposeType === 'goal' ? 'Goal' : 'Budget'}`
                  : 'Create Budget or Goal'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                resetForm();
              }}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {formError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-700 flex items-center gap-2">
              <span>{formError}</span>
            </div>
          )}

          {/* Purpose Selector: Budget (Expenses) vs Goal (Savings / Transfers) */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Purpose Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPurposeType('budget')}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                  purposeType === 'budget'
                    ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Target
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    purposeType === 'budget' ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                />
                <div>
                  <p className="text-xs font-bold">Budget (Expense-Linked)</p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      purposeType === 'budget' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    Tracks spending across single or multiple expense subcategories
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPurposeType('goal')}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                  purposeType === 'goal'
                    ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <TrendingUp
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    purposeType === 'goal' ? 'text-indigo-400' : 'text-slate-500'
                  }`}
                />
                <div>
                  <p className="text-xs font-bold">
                    Goal (Savings & Transfers)
                  </p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      purposeType === 'goal' ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    Tracks transfers or savings allocations to meet a target for a cause
                  </p>
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Budget / Goal Name */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                {purposeType === 'goal' ? 'Goal Name' : 'Budget Name'}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  purposeType === 'goal'
                    ? 'e.g., Land Acquisition Reserve, Emergency Fund'
                    : 'e.g., Monthly Groceries & Fuel, Q1 Software'
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>

            {/* Period Type */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Period
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    { id: 'weekly', label: 'Weekly' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'yearly', label: 'Yearly' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handlePeriodTypeSelect(opt.id)}
                    className={`rounded-lg py-2 px-2 text-xs font-bold transition-all cursor-pointer ${
                      periodType === opt.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom Date Range Pickers */}
          {periodType === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-slate-50 border border-slate-200/80 p-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Automatic Recreation for Weekly/Monthly/Yearly vs Custom Period Recreation Definition */}
          {periodType === 'custom' ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <RotateCcw className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      Custom Period Recreation Definition (Required)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {autoRecreate
                        ? `Automatically recreates for ${recreateDays || 30} days when the custom period ends.`
                        : 'Will be disabled from reach and moved to Expired / Disabled once its custom period ends.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAutoRecreate((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      autoRecreate
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    {autoRecreate ? 'Auto-Recreate Enabled' : 'Do Not Recreate'}
                  </button>
                </div>
              </div>

              {autoRecreate && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/70">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Recreation Duration (Days)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="3650"
                        required
                        value={recreateDays}
                        onChange={(e) => setRecreateDays(e.target.value)}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-slate-600">
                        days per recreated cycle
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[7, 14, 30, 90, 365].map((presetDays) => (
                      <button
                        key={presetDays}
                        type="button"
                        onClick={() => setRecreateDays(String(presetDays))}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-mono font-bold transition-all cursor-pointer ${
                          Number(recreateDays) === presetDays
                            ? 'bg-slate-900 text-white'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {presetDays}d
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/50 px-3.5 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <RotateCcw className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold text-emerald-950">
                  Automatic Recreation: {periodType.charAt(0).toUpperCase() + periodType.slice(1)} periods recreate automatically when each cycle ends.
                </span>
              </div>
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 shrink-0">
                Auto Cycle
              </span>
            </div>
          )}

          {/* Amount, Currency, Account/Vault Scope, and Alert Threshold */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Account or Savings Vault Scope */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                {purposeType === 'goal'
                  ? 'Target Savings Vault / Account'
                  : 'Account Scope'}
              </label>
              <select
                value={accountId}
                onChange={(e) => handleAccountSelectChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              >
                <option value="">
                  {purposeType === 'goal'
                    ? 'All Savings Vaults & Transfers'
                    : 'All Accounts (Global)'}
                </option>
                {accounts.map((acc) => {
                  const accCurr = getAccountCurrency(acc, baseCurrency);
                  return (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({accCurr}){acc.isVirtual ? ' • Vault' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Currency */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Currency
              </label>
              <select
                value={budgetCurrency}
                onChange={(e) => setBudgetCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>

            {/* Limit / Target Amount */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                {purposeType === 'goal'
                  ? `Target Amount (${budgetCurrency})`
                  : `Budget Limit (${budgetCurrency})`}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[11px] font-mono font-bold text-slate-400">
                  {budgetCurrency}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-12 pr-3 py-2.5 text-sm font-mono font-bold text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Alert / Milestone Threshold % */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                {purposeType === 'goal'
                  ? 'Milestone Mark (%)'
                  : 'Alert Threshold (%)'}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={alertThresholdPercent}
                  onChange={(e) => setAlertThresholdPercent(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 pr-8 py-2.5 text-sm font-mono font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-bold text-slate-400">
                  %
                </span>
              </div>
            </div>
          </div>

          {/* Foreign Currency Conversion Rate Display when budgetCurrency !== baseCurrency */}
          {formConversionPreview && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3.5 py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-indigo-600 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                  FX Conversion Rate
                </span>
                <span className="font-mono font-bold text-slate-900">
                  1 {formConversionPreview.selectedCurr} ={' '}
                  {formConversionPreview.rateToBase.toFixed(2)}{' '}
                  {formConversionPreview.baseCurrency}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  (1 {formConversionPreview.baseCurrency} ={' '}
                  {formConversionPreview.inverseRate.toFixed(2)}{' '}
                  {formConversionPreview.selectedCurr})
                </span>
              </div>
              {formConversionPreview.convertedAmt > 0 && (
                <div className="font-mono font-bold text-indigo-800">
                  App Currency Equivalent:{' '}
                  {formatCurrency(
                    formConversionPreview.convertedAmt,
                    formConversionPreview.baseCurrency
                  )}
                </div>
              )}
            </div>
          )}

          {/* Goal Cause & Funding Source OR Expense Subcategories */}
          {purposeType === 'goal' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Target Cause / Objective
                </label>
                <input
                  type="text"
                  value={goalCause}
                  onChange={(e) => setGoalCause(e.target.value)}
                  placeholder="e.g., Treasury Bond, Building Project, Emergency Reserve"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Goal Funding Source
                </label>
                <select
                  value={goalSourceType}
                  onChange={(e) =>
                    setGoalSourceType(e.target.value as GoalSourceType)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="savings_and_transfers">
                    Savings Allocations & Account Transfers
                  </option>
                  <option value="savings_only">
                    Savings Allocations Only
                  </option>
                  <option value="transfers_only">
                    Account Transfers Only
                  </option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-900">
                    Subcategory Coverage
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => handleScopeTypeChange('single')}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                        scopeType === 'single'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Tag className="h-3 w-3" />
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScopeTypeChange('multiple')}
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                        scopeType === 'multiple'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Layers className="h-3 w-3" />
                      Multiple
                    </button>
                  </div>

                  <div className="relative w-full sm:w-52">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={subSearch}
                      onChange={(e) => setSubSearch(e.target.value)}
                      placeholder="Filter subcategories..."
                      className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 py-1.5 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Selected Pills */}
              {selectedSubcategories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {selectedSubcategories.map((sub) => {
                    const meta = allSubcategoryCatalog.find(
                      (c) =>
                        normalizeSubcategoryKey(c.subcategory) ===
                        normalizeSubcategoryKey(sub)
                    );
                    const dotColor = meta?.color || '#10b981';
                    return (
                      <span
                        key={sub}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        {sub}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSubcategories((prev) =>
                              prev.filter((s) => s !== sub)
                            )
                          }
                          className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Subcategory Grid */}
              <div className="max-h-48 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
                {filteredSubcategoryCatalog.map((item) => {
                  const isSelected = selectedSubcategories.some(
                    (s) =>
                      normalizeSubcategoryKey(s) ===
                      normalizeSubcategoryKey(item.subcategory)
                  );
                  return (
                    <button
                      key={`${item.category}:${item.subcategory}`}
                      type="button"
                      onClick={() => handleToggleSubcategory(item.subcategory)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950 shadow-2xs'
                          : 'border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">
                            {item.subcategory}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {item.category}
                          </p>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 stroke-[2.5]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Add custom subcategory */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                <input
                  type="text"
                  value={customSubInput}
                  onChange={(e) => setCustomSubInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomSubcategory();
                    }
                  }}
                  placeholder="Or type a custom subcategory name..."
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSubcategory}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  Add Subcategory
                </button>
              </div>
            </div>
          )}

          {/* Submit Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note..."
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  resetForm();
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white shadow-2xs transition-all hover:opacity-95 cursor-pointer"
                style={{ backgroundColor: 'var(--app-accent)' }}
              >
                <Check className="h-4 w-4 stroke-[2.5]" />
                {editingBudget
                  ? `Update ${purposeType === 'goal' ? 'Goal' : 'Budget'}`
                  : `Save ${purposeType === 'goal' ? 'Goal' : 'Budget'}`}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Period Filter Bar */}
      {(activeExpenseBudgets.length > 0 ||
        activeGoals.length > 0 ||
        expiredDisabledItems.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: 'All Periods' },
                { id: 'weekly', label: 'Weekly' },
                { id: 'monthly', label: 'Monthly' },
                { id: 'yearly', label: 'Yearly' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterPeriod(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer shrink-0 ${
                  filterPeriod === tab.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-medium text-slate-400">
            Click any card for options & history
          </span>
        </div>
      )}

      {/* Budgets / Goals / Expired Cards Grid */}
      {displayedEvaluatedBudgets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 sm:p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            {workspaceTab === 'goals' ? (
              <TrendingUp className="h-6 w-6" />
            ) : workspaceTab === 'expired' ? (
              <Archive className="h-6 w-6" />
            ) : (
              <Target className="h-6 w-6" />
            )}
          </div>
          <h3 className="text-sm font-bold text-slate-900">
            {workspaceTab === 'goals'
              ? 'No active savings or transfer goals'
              : workspaceTab === 'expired'
              ? 'No expired or disabled budgets'
              : 'No active expense budgets'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {workspaceTab === 'goals'
              ? 'Create a goal linked to savings allocations or account transfers to track progress toward a cause.'
              : workspaceTab === 'expired'
              ? 'Budgets without auto-recreate move here automatically once their date period expires.'
              : 'Create a weekly, monthly, yearly, or custom budget with optional auto-recreation.'}
          </p>
          {workspaceTab !== 'expired' && !isFormOpen && (
            <button
              type="button"
              onClick={() =>
                handleOpenCreate(workspaceTab === 'goals' ? 'goal' : 'budget')
              }
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-2xs cursor-pointer"
              style={{ backgroundColor: 'var(--app-accent)' }}
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              {workspaceTab === 'goals' ? 'Create First Goal' : 'Create First Budget'}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayedEvaluatedBudgets.map((ev) => {
            const { budget, periodWindow } = ev;
            const isGoal = ev.purposeType === 'goal';
            const isDisabledCard = ev.isDisabledFromReach;
            const barColor = isDisabledCard
              ? 'bg-slate-400'
              : isGoal
              ? ev.isGoalMet
                ? 'bg-emerald-500'
                : 'bg-indigo-500'
              : ev.status === 'exceeded'
              ? 'bg-rose-500'
              : ev.status === 'at_limit' || ev.status === 'warning'
              ? 'bg-amber-500'
              : 'bg-emerald-500';

            const startLabel = formatDateDDMMYYYY(periodWindow.startYmd);
            const endLabel = formatDateDDMMYYYY(periodWindow.endYmd);

            return (
              <div
                key={budget.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setModalGroupBy('none');
                  setActiveModalBudgetId(budget.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setModalGroupBy('none');
                    setActiveModalBudgetId(budget.id);
                  }
                }}
                className={`group rounded-2xl border p-4 sm:p-5 shadow-2xs transition-all text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                  isDisabledCard
                    ? 'bg-slate-50/90 border-slate-200/90 opacity-85 hover:opacity-100'
                    : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-md'
                }`}
              >
                {/* 1. Just the Name + Minimal Auto-Recreate / Disabled Pill */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {isDisabledCard && (
                      <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    )}
                    <h4 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                      {budget.name}
                    </h4>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isDisabledCard ? (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        Expired • Disabled
                      </span>
                    ) : budget.periodType !== 'custom' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-700">
                        <RotateCcw className="h-2.5 w-2.5" />
                        Auto {budget.periodType}
                      </span>
                    ) : budget.autoRecreate ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-700">
                        <RotateCcw className="h-2.5 w-2.5" />
                        {ev.recreateDays}d
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
                  </div>
                </div>

                {/* 2. Top of the bar: Top Left = Start Period, Middle = Percentage, Top Right = End Period */}
                <div className="grid grid-cols-3 items-end text-[11px] font-mono mb-1.5">
                  <span className="text-left font-semibold text-slate-500 truncate">
                    {startLabel}
                  </span>
                  <span
                    className={`text-center font-bold ${
                      isDisabledCard
                        ? 'text-slate-600'
                        : isGoal
                        ? ev.isGoalMet
                          ? 'text-emerald-600'
                          : 'text-indigo-600'
                        : ev.status === 'exceeded'
                        ? 'text-rose-600'
                        : ev.status === 'warning' || ev.status === 'at_limit'
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    {ev.usagePercentage.toFixed(1)}%
                  </span>
                  <span className="text-right font-semibold text-slate-500 truncate">
                    {endLabel}
                  </span>
                </div>

                {/* 3. Progress bar with the alert mark within the bar */}
                <div className="relative h-3.5 w-full rounded-full bg-slate-100 overflow-hidden border border-slate-200/70">
                  <div
                    className={`h-full transition-all duration-300 ${barColor}`}
                    style={{ width: `${ev.clampedProgressPercent}%` }}
                  />
                  {/* Alert mark within the bar */}
                  {ev.alertThresholdPercent > 0 &&
                    ev.alertThresholdPercent < 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-900/60 z-10"
                        style={{ left: `${ev.alertThresholdPercent}%` }}
                        title={`Threshold: ${ev.alertThresholdPercent}%`}
                      />
                    )}
                </div>

                {/* 4. Right beneath the bar: Bottom Left = starting currency 0.00, Middle = Spent/Saved, Bottom Right = Budget/Target Amount */}
                <div className="grid grid-cols-3 items-center text-[11px] font-mono mt-1.5">
                  <span className="text-left font-semibold text-slate-500 truncate">
                    {formatCurrency(0, budget.currency)}
                  </span>
                  <span
                    className={`text-center font-bold truncate ${
                      isDisabledCard
                        ? 'text-slate-700'
                        : isGoal
                        ? 'text-indigo-600'
                        : ev.status === 'exceeded'
                        ? 'text-rose-600'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatCurrency(ev.spentAmount, budget.currency)}
                  </span>
                  <span className="text-right font-bold text-slate-900 truncate">
                    {formatCurrency(ev.budgetLimit, budget.currency)}
                  </span>
                </div>

                {/* 5. Beneath that: Residual / Remaining amount on its left + Conversion Rate if foreign currency */}
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-xs font-mono font-bold ${
                      isGoal
                        ? ev.isGoalMet
                          ? 'text-emerald-700'
                          : 'text-slate-700'
                        : ev.residualAmount < 0
                        ? 'text-rose-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {isGoal
                      ? ev.isGoalMet
                        ? `Target Met (+${formatCurrency(
                            ev.overageAmount,
                            budget.currency
                          )})`
                        : `Remaining: ${formatCurrency(
                            ev.residualAmount,
                            budget.currency
                          )}`
                      : ev.residualAmount >= 0
                      ? `Residual: ${formatCurrency(
                          ev.residualAmount,
                          budget.currency
                        )}`
                      : `Residual: -${formatCurrency(
                          ev.overageAmount,
                          budget.currency
                        )}`}
                  </span>
                  {budget.currency.toUpperCase() !== baseCurrency && (
                    <span className="font-mono text-[10px] font-semibold text-slate-500">
                      1 {budget.currency.toUpperCase()} ={' '}
                      {ev.conversionRateToBase.toFixed(2)} {baseCurrency}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Clickable Budget / Goal Options Pop-up Modal */}
      {activeModalEvaluated && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
          onClick={() => setActiveModalBudgetId(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh] my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 truncate">
                    {activeModalEvaluated.budget.name}
                  </h3>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                      activeModalEvaluated.purposeType === 'goal'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {activeModalEvaluated.purposeType === 'goal'
                      ? 'Goal'
                      : 'Budget'}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-500">
                  {activeModalEvaluated.periodWindow.periodBadge} •{' '}
                  {formatDateDDMMYYYY(
                    activeModalEvaluated.periodWindow.startYmd
                  )}{' '}
                  –{' '}
                  {formatDateDDMMYYYY(activeModalEvaluated.periodWindow.endYmd)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalBudgetId(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Summary Bar */}
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2">
                <div className="grid grid-cols-3 items-end text-[11px] font-mono">
                  <span className="text-left font-semibold text-slate-500">
                    {formatDateDDMMYYYY(
                      activeModalEvaluated.periodWindow.startYmd
                    )}
                  </span>
                  <span className="text-center font-bold text-slate-900">
                    {activeModalEvaluated.usagePercentage.toFixed(1)}%
                  </span>
                  <span className="text-right font-semibold text-slate-500">
                    {formatDateDDMMYYYY(
                      activeModalEvaluated.periodWindow.endYmd
                    )}
                  </span>
                </div>

                <div className="relative h-3 w-full rounded-full bg-slate-200/80 overflow-hidden">
                  <div
                    className={`h-full ${
                      activeModalEvaluated.purposeType === 'goal'
                        ? activeModalEvaluated.isGoalMet
                          ? 'bg-emerald-500'
                          : 'bg-indigo-500'
                        : activeModalEvaluated.status === 'exceeded'
                        ? 'bg-rose-500'
                        : activeModalEvaluated.status === 'warning' ||
                          activeModalEvaluated.status === 'at_limit'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${activeModalEvaluated.clampedProgressPercent}%`,
                    }}
                  />
                  {activeModalEvaluated.alertThresholdPercent > 0 &&
                    activeModalEvaluated.alertThresholdPercent < 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-900/60"
                        style={{
                          left: `${activeModalEvaluated.alertThresholdPercent}%`,
                        }}
                      />
                    )}
                </div>

                <div className="grid grid-cols-3 items-center text-[11px] font-mono">
                  <span className="text-left text-slate-500">
                    {formatCurrency(
                      0,
                      activeModalEvaluated.budget.currency
                    )}
                  </span>
                  <span className="text-center font-bold text-slate-900">
                    {formatCurrency(
                      activeModalEvaluated.spentAmount,
                      activeModalEvaluated.budget.currency
                    )}
                  </span>
                  <span className="text-right font-bold text-slate-900">
                    {formatCurrency(
                      activeModalEvaluated.budgetLimit,
                      activeModalEvaluated.budget.currency
                    )}
                  </span>
                </div>

                <div className="pt-1 border-t border-slate-200/60 flex items-center justify-between text-xs font-mono font-bold">
                  <span
                    className={
                      activeModalEvaluated.purposeType === 'goal'
                        ? 'text-indigo-700'
                        : activeModalEvaluated.residualAmount < 0
                        ? 'text-rose-600'
                        : 'text-emerald-700'
                    }
                  >
                    {activeModalEvaluated.purposeType === 'goal'
                      ? `Remaining: ${formatCurrency(
                          activeModalEvaluated.residualAmount,
                          activeModalEvaluated.budget.currency
                        )}`
                      : activeModalEvaluated.residualAmount >= 0
                      ? `Residual: ${formatCurrency(
                          activeModalEvaluated.residualAmount,
                          activeModalEvaluated.budget.currency
                        )}`
                      : `Residual: -${formatCurrency(
                          activeModalEvaluated.overageAmount,
                          activeModalEvaluated.budget.currency
                        )}`}
                  </span>
                  <span className="text-[11px] font-sans font-semibold text-slate-500">
                    Threshold: {activeModalEvaluated.alertThresholdPercent}%
                  </span>
                </div>

                {activeModalEvaluated.budget.currency.toUpperCase() !==
                  baseCurrency && (
                  <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                    <span className="font-semibold text-indigo-700">
                      Conversion Rate: 1{' '}
                      {activeModalEvaluated.budget.currency.toUpperCase()} ={' '}
                      {activeModalEvaluated.conversionRateToBase.toFixed(2)}{' '}
                      {baseCurrency}
                    </span>
                    <span className="text-slate-600">
                      App Currency:{' '}
                      {formatCurrency(
                        activeModalEvaluated.spentAmountBase,
                        baseCurrency
                      )}{' '}
                      /{' '}
                      {formatCurrency(
                        activeModalEvaluated.budgetLimitBase,
                        baseCurrency
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Auto-Recreation Settings: Automatic for Weekly/Monthly/Yearly, Custom Definition for Custom Period */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                      Period Recreation
                    </span>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      activeModalEvaluated.budget.periodType !== 'custom' ||
                      activeModalEvaluated.budget.autoRecreate
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {activeModalEvaluated.budget.periodType !== 'custom'
                      ? `Automatic (${activeModalEvaluated.budget.periodType})`
                      : activeModalEvaluated.budget.autoRecreate
                      ? `Every ${activeModalEvaluated.recreateDays} Days`
                      : 'Disabled'}
                  </span>
                </div>

                {activeModalEvaluated.budget.periodType !== 'custom' ? (
                  <p className="text-xs text-slate-600">
                    This {activeModalEvaluated.budget.periodType} period recreates automatically when the current cycle ends.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={quickRecreateDays}
                      onChange={(e) => setQuickRecreateDays(e.target.value)}
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-mono font-bold text-slate-900"
                    />
                    <span className="text-xs text-slate-600">days</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickUpdateRecreation(
                          activeModalEvaluated.budget,
                          true,
                          quickRecreateDays
                        )
                      }
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                    >
                      {activeModalEvaluated.isDisabledFromReach
                        ? 'Recreate & Activate'
                        : 'Save Recreation Days'}
                    </button>
                    {activeModalEvaluated.budget.autoRecreate && (
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickUpdateRecreation(
                            activeModalEvaluated.budget,
                            false,
                            quickRecreateDays
                          )
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        Disable Auto-Recreate
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Accounts / Vault Chosen */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  {activeModalEvaluated.purposeType === 'goal'
                    ? 'Target Vault / Account & Cause'
                    : 'Accounts Chosen'}
                </p>
                <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800">
                  <Wallet className="h-3.5 w-3.5 text-slate-500" />
                  <span>
                    {activeModalEvaluated.linkedAccount
                      ? `${activeModalEvaluated.linkedAccount.name} (${getAccountCurrency(
                          activeModalEvaluated.linkedAccount,
                          baseCurrency
                        )})`
                      : activeModalEvaluated.purposeType === 'goal'
                      ? 'All Savings Vaults & Transfers'
                      : 'All Accounts'}
                  </span>
                  {activeModalEvaluated.purposeType === 'goal' &&
                    activeModalEvaluated.budget.goalCause && (
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                        Cause: {activeModalEvaluated.budget.goalCause}
                      </span>
                    )}
                </div>
              </div>

              {/* Selected Subcategories / Sources Breakdown */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  {activeModalEvaluated.purposeType === 'goal'
                    ? 'Funding Sources Breakdown'
                    : `Selected ${
                        activeModalEvaluated.subcategoryBreakdowns.length === 1
                          ? 'Subcategory'
                          : 'Subcategories'
                      }`}
                </p>
                {activeModalEvaluated.subcategoryBreakdowns.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No contributions recorded in this period yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {activeModalEvaluated.subcategoryBreakdowns.map((sub) => (
                      <div
                        key={sub.subcategory}
                        className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: sub.color }}
                          />
                          <span className="font-bold text-slate-800 truncate">
                            {sub.subcategory}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({sub.transactionCount} tx)
                          </span>
                        </div>
                        <span className="font-mono font-bold text-slate-900 shrink-0">
                          {formatCurrency(
                            sub.spentAmount,
                            activeModalEvaluated.budget.currency
                          )}{' '}
                          <span className="text-[10px] font-normal text-slate-400">
                            ({sub.shareOfBudgetPercent.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History of Transactions / Transfers */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {activeModalEvaluated.purposeType === 'goal'
                      ? `Transfers & Savings History (${activeModalEvaluated.matchedTransfers.length})`
                      : `History of Transactions (${activeModalEvaluated.matchedExpenses.length})`}
                  </p>
                  {(activeModalEvaluated.matchedExpenses.length > 0 ||
                    activeModalEvaluated.matchedTransfers.length > 0) && (
                    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {(
                        [
                          { id: 'none', label: 'All' },
                          { id: 'week', label: 'Week' },
                          { id: 'month', label: 'Month' },
                          { id: 'year', label: 'Year' },
                        ] as { id: RecordGroupPeriod; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setModalGroupBy(opt.id)}
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                            modalGroupBy === opt.id
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {activeModalEvaluated.purposeType === 'goal' ? (
                  activeModalEvaluated.matchedTransfers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                      No transfers or savings allocations recorded in this period.
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                      {groupRecordsByPeriod(
                        activeModalEvaluated.matchedTransfers,
                        modalGroupBy
                      ).map((group) => (
                        <div key={group.key} className="space-y-1.5">
                          {modalGroupBy !== 'none' && (
                            <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-slate-100 text-[10px] font-bold text-slate-600">
                              <span>{group.label}</span>
                              <span className="font-mono">
                                {group.items.length} tx
                              </span>
                            </div>
                          )}
                          {group.items.map((tr) => {
                            const sourceAcc = accounts.find(
                              (a) => a.id === tr.sourceAccountId
                            );
                            const destAcc = accounts.find(
                              (a) => a.id === tr.destinationAccountId
                            );
                            const trCurr =
                              tr.destinationCurrency ||
                              tr.sourceCurrency ||
                              baseCurrency;
                            const trAmt = tr.destinationAmount ?? tr.amount;
                            const transferSubLabel = tr.id.startsWith(
                              'trans_sav_'
                            )
                              ? 'Savings Allocation'
                              : tr.id.startsWith('trans_net_')
                              ? 'Net Income Transfer'
                              : 'Fund Transfer';
                            return (
                              <RecordCard
                                key={tr.id}
                                topLeftSubcategory={transferSubLabel}
                                subcategoryColor="#2563EB"
                                bottomLeftAccount={`${
                                  sourceAcc?.name || 'Source'
                                } → ${destAcc?.name || 'Destination'}`}
                                topRightAmount={`+${formatCurrency(
                                  trAmt,
                                  trCurr
                                )}`}
                                recordType="transfer"
                                bottomRightDate={formatDateDDMMYYYY(tr.date)}
                                onClick={() => setSelectedPopupTransfer(tr)}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )
                ) : activeModalEvaluated.matchedExpenses.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    No expenses recorded for this budget period yet.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {groupRecordsByPeriod(
                      activeModalEvaluated.matchedExpenses,
                      modalGroupBy
                    ).map((group) => (
                      <div key={group.key} className="space-y-1.5">
                        {modalGroupBy !== 'none' && (
                          <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-slate-100 text-[10px] font-bold text-slate-600">
                            <span>{group.label}</span>
                            <span className="font-mono">
                              {group.items.length} tx
                            </span>
                          </div>
                        )}
                        {group.items.map((exp) => {
                          const expAcc = exp.accountId
                            ? accounts.find((a) => a.id === exp.accountId)
                            : undefined;
                          const expCurr = (
                            exp.currency ||
                            getAccountCurrency(expAcc, baseCurrency)
                          ).toUpperCase();
                          const rawAmt =
                            exp.originalAmount !== undefined &&
                            exp.originalAmount > 0
                              ? exp.originalAmount
                              : exp.amount;
                          const subLabel =
                            exp.subcategory?.trim() ||
                            exp.category?.trim() ||
                            'Expense';
                          const subColor = resolveIntuitiveSubcategoryColor(
                            subLabel,
                            exp.category,
                            settings,
                            expenses
                          );
                          return (
                            <RecordCard
                              key={exp.id}
                              topLeftSubcategory={subLabel}
                              subcategoryColor={subColor}
                              bottomLeftAccount={expAcc?.name || 'Account'}
                              topRightAmount={`-${formatCurrency(
                                rawAmt,
                                expCurr
                              )}`}
                              recordType="expense"
                              bottomRightDate={formatDateDDMMYYYY(exp.date)}
                              onClick={() => setSelectedPopupExpense(exp)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer: Edit & Delete with Action Notification */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200/80 space-y-2.5">
              {confirmDeleteBudgetId === activeModalEvaluated.budget.id ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
                  <p className="text-xs font-semibold text-rose-900">
                    Delete "{activeModalEvaluated.budget.name}"? Linked transactions remain intact, but this{' '}
                    {activeModalEvaluated.purposeType === 'goal' ? 'goal' : 'budget'}{' '}
                    will be removed.
                  </p>
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteBudgetId(null)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const id = activeModalEvaluated.budget.id;
                        setConfirmDeleteBudgetId(null);
                        setActiveModalBudgetId(null);
                        onDeleteBudget(id);
                      }}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  {onNavigateToTab ? (
                    <button
                      type="button"
                      onClick={() => {
                        const targetTab =
                          activeModalEvaluated.purposeType === 'goal'
                            ? 'accounts'
                            : 'flexible_expenses';
                        setActiveModalBudgetId(null);
                        onNavigateToTab(targetTab);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                    >
                      {activeModalEvaluated.purposeType === 'goal'
                        ? 'Open Accounts & Transfers'
                        : 'Open Expenses'}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <div />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(activeModalEvaluated.budget)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Edit{' '}
                      {activeModalEvaluated.purposeType === 'goal'
                        ? 'Goal'
                        : 'Budget'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDeleteBudgetId(activeModalEvaluated.budget.id)
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Record Detail Pop-Up Modals */}
      <ExpenseDetailPopupModal
        expense={selectedPopupExpense}
        accounts={accounts}
        settings={settings}
        currency={baseCurrency}
        onClose={() => setSelectedPopupExpense(null)}
        onEditExpense={onEditExpense}
        onDeleteExpense={onDeleteExpense}
      />

      <TransferDetailPopupModal
        transfer={selectedPopupTransfer}
        accounts={accounts}
        currency={baseCurrency}
        onClose={() => setSelectedPopupTransfer(null)}
      />
    </div>
  );
};
