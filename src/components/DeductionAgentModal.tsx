import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  FinancialBudget,
  UserSettings,
  CustomDeduction,
} from '../types/finance.ts';
import {
  formatAmount,
  getQuarterFromDate,
  buildDefaultDeductionsForIncome,
  isSavingsVaultAccount,
  LEGACY_SEEDED_CUT_IDS,
} from '../lib/calculations.ts';
import {
  buildActionableAgentSuggestions,
  AgentRecordAction,
} from '../lib/deductionIntelligence.ts';
import {
  buildAppAssistantIntelligence,
  answerAppAssistantLocally,
  AppAssistantAction,
} from '../lib/appAssistantIntelligence.ts';
import { ActiveTab } from './Navigation.tsx';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestions?: AppAssistantAction[];
}

interface DeductionAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  transfers?: AccountTransfer[];
  budgets?: FinancialBudget[];
  activeTab?: ActiveTab;
  settings: UserSettings;
  currency: string;
  onSaveSettings: (settings: UserSettings) => Promise<void>;
  onAddIncome: (
    receipt: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ) => Promise<IncomeReceipt | void>;
  onAddExpenses: (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => Promise<void>;
  onNavigateToTab?: (tab: ActiveTab) => void;
}

const VALID_NAV_TABS = new Set<ActiveTab>([
  'dashboard',
  'income_log',
  'flexible_expenses',
  'accounts',
  'budgets',
  'analytics',
  'settings',
]);

export const DeductionAgentModal: React.FC<DeductionAgentModalProps> = ({
  isOpen,
  onClose,
  incomes,
  expenses,
  accounts,
  transfers = [],
  budgets = [],
  activeTab = 'dashboard',
  settings,
  currency,
  onSaveSettings,
  onAddIncome,
  onAddExpenses,
  onNavigateToTab,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const operatingAccounts = useMemo(
    () => accounts.filter((a) => !isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const defaultAccountId =
    settings.defaultAccountId ||
    operatingAccounts.find((a) => a.isDefaultDeposit)?.id ||
    operatingAccounts[0]?.id ||
    accounts[0]?.id ||
    'acc-main-op';

  const intel = useMemo(
    () =>
      buildAppAssistantIntelligence({
        incomes,
        expenses,
        accounts,
        transfers,
        budgets,
        settings,
        currency,
        activeTab,
      }),
    [incomes, expenses, accounts, transfers, budgets, settings, currency, activeTab]
  );

  const actionableSuggestions = useMemo(
    () =>
      buildActionableAgentSuggestions({
        incomes,
        expenses,
        accounts,
        settings,
        currency,
      }),
    [incomes, expenses, accounts, settings, currency]
  );

  const [assistantView, setAssistantView] = useState<
    'chat' | 'insights' | 'actions'
  >('chat');
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(
    new Set()
  );
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(
    new Set()
  );
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [modelTier, setModelTier] = useState<'general' | 'fast'>('general');
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const welcomeMessage = useMemo(() => {
    const budgetPart =
      intel.totals.exceededBudgetsCount > 0
        ? ` ${intel.totals.exceededBudgetsCount} budget${
            intel.totals.exceededBudgetsCount === 1 ? ' is' : 's are'
          } at or over limit.`
        : intel.totals.activeBudgetsCount > 0
        ? ` All ${intel.totals.activeBudgetsCount} active budgets are on track.`
        : '';
    return `Ready for ${intel.currentQuarter}. Operating cash is ${formatAmount(
      intel.totals.operatingCash,
      currency
    )} and savings vaults hold ${formatAmount(
      intel.totals.savingsVaults,
      currency
    )}.${budgetPart} Ask anything about your ledger, occurrences, or next steps.`;
  }, [intel, currency]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome_msg',
      role: 'assistant',
      content: welcomeMessage,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
  ]);

  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0].id === 'welcome_msg'
        ? [{ ...prev[0], content: welcomeMessage }]
        : prev
    );
  }, [welcomeMessage]);

  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && assistantView === 'chat') {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isOpen, assistantView]);

  if (!isOpen) return null;

  const toggleSelectAction = (id: string) => {
    setSelectedActionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const executeSingleAction = async (
    action: AppAssistantAction | AgentRecordAction,
    currentCuts: CustomDeduction[]
  ): Promise<{ cuts: CustomDeduction[]; navigated: boolean }> => {
    if (action.kind === 'navigate' && 'targetTab' in action && action.targetTab) {
      if (onNavigateToTab && VALID_NAV_TABS.has(action.targetTab)) {
        onNavigateToTab(action.targetTab);
        onClose();
        return { cuts: currentCuts, navigated: true };
      }
      return { cuts: currentCuts, navigated: false };
    }

    if (action.kind === 'apply_deduction_rule' && action.deductionRule) {
      const exists = currentCuts.some(
        (c) =>
          c.name.trim().toLowerCase() ===
          action.deductionRule!.name.trim().toLowerCase()
      );
      if (!exists) {
        const newCut: CustomDeduction = {
          ...action.deductionRule,
          id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        };
        return { cuts: [...currentCuts, newCut], navigated: false };
      }
      return { cuts: currentCuts, navigated: false };
    }

    if (action.kind === 'record_income' && action.incomeDraft) {
      const tempSettings: UserSettings = {
        ...settings,
        customCuts: currentCuts,
      };
      const deds = buildDefaultDeductionsForIncome(
        action.incomeDraft.grossAmount,
        tempSettings,
        expenses,
        action.incomeDraft.date
      );
      const q = getQuarterFromDate(action.incomeDraft.date);
      await onAddIncome({
        date: action.incomeDraft.date,
        quarter: q,
        clientOrSource: action.incomeDraft.clientOrSource,
        category: action.incomeDraft.category || 'Salary',
        grossAmount: action.incomeDraft.grossAmount,
        savingsRate: settings.quarterlyRates?.q1TargetRate || 10,
        receiptId: `INC-${Date.now().toString().slice(-6)}`,
        accountId: action.incomeDraft.accountId || defaultAccountId,
        allocatedDeductions: deds,
        notes: action.incomeDraft.notes || 'Recorded from App Assistant',
      });
      return { cuts: currentCuts, navigated: false };
    }

    if (action.kind === 'record_expense' && action.expenseDraft) {
      await onAddExpenses([
        {
          date: action.expenseDraft.date,
          accountId: action.expenseDraft.accountId || defaultAccountId,
          recipient: action.expenseDraft.recipient,
          category: action.expenseDraft.category,
          subcategory: action.expenseDraft.subcategory,
          amount: action.expenseDraft.amount,
          description: action.expenseDraft.recipient,
          notes: action.expenseDraft.notes || 'Recorded from App Assistant',
        },
      ]);
      return { cuts: currentCuts, navigated: false };
    }

    return { cuts: currentCuts, navigated: false };
  };

  const handleApplySelectedActions = async (
    actionsToRun: (AppAssistantAction | AgentRecordAction)[]
  ) => {
    if (actionsToRun.length === 0) return;
    setIsApplyingBatch(true);
    setStatusBanner(null);

    try {
      let nextCuts = [...(settings.customCuts || [])].filter(
        (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
      );
      let cutsChanged = false;
      let recordedCount = 0;

      for (const act of actionsToRun) {
        const beforeLen = nextCuts.length;
        const { cuts, navigated } = await executeSingleAction(act, nextCuts);
        if (navigated) return;
        nextCuts = cuts;
        if (nextCuts.length !== beforeLen) {
          cutsChanged = true;
        }
        recordedCount++;
      }

      if (cutsChanged) {
        await onSaveSettings({
          ...settings,
          customCuts: nextCuts,
          updatedAt: new Date().toISOString(),
        });
      }

      setAppliedActionIds((prev) => {
        const next = new Set(prev);
        for (const a of actionsToRun) next.add(a.id);
        return next;
      });
      setSelectedActionIds((prev) => {
        const next = new Set(prev);
        for (const a of actionsToRun) next.delete(a.id);
        return next;
      });
      if (recordedCount > 0) {
        setStatusBanner(
          `Applied ${recordedCount} item${recordedCount === 1 ? '' : 's'} to your ledger.`
        );
      }
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const handleSendMessage = async (promptText?: string) => {
    const text = (promptText ?? chatInput).trim();
    if (!text || isSending) return;

    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userMsg: ChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: nowTime,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!promptText) setChatInput('');
    setAssistantView('chat');
    setIsSending(true);

    try {
      const res = await fetch('/api/ai/app-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          modelTier,
          assistantContext: intel.aiContext,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.reply) {
        const mappedSuggestions: AppAssistantAction[] = Array.isArray(
          data.suggestions
        )
          ? data.suggestions
              .filter((s: any) => s && s.title)
              .map((s: any, idx: number): AppAssistantAction => {
                const rawKind = String(s.kind || '').trim();
                const kind: AppAssistantAction['kind'] =
                  rawKind === 'navigate' ||
                  rawKind === 'record_income' ||
                  rawKind === 'record_expense'
                    ? rawKind
                    : 'apply_deduction_rule';

                if (kind === 'navigate') {
                  const candidateTab = String(s.targetTab || 'dashboard') as ActiveTab;
                  const targetTab = VALID_NAV_TABS.has(candidateTab)
                    ? candidateTab
                    : 'dashboard';
                  return {
                    id: `ai_nav_${Date.now()}_${idx}`,
                    kind: 'navigate',
                    targetTab,
                    title: String(s.title),
                    summary: String(s.summary || 'Open view'),
                    reason: String(s.reason || 'Guided by App Assistant'),
                    actionLabel: String(s.actionLabel || 'Open'),
                  };
                }

                const amt = Number(s.amount) > 0 ? Number(s.amount) : 10;
                const isSav = s.routeTo === 'savings_split';
                return {
                  id: `ai_sug_${Date.now()}_${idx}`,
                  kind,
                  title: String(s.title),
                  summary:
                    String(s.summary || '') ||
                    `${amt}${s.deductionType === 'percentage' ? '%' : ` ${currency}`}`,
                  reason: String(s.reason || 'Suggested by App Assistant'),
                  actionLabel: String(s.actionLabel || 'Record'),
                  deductionRule:
                    kind === 'apply_deduction_rule'
                      ? {
                          name: String(s.name || s.title),
                          type:
                            s.deductionType === 'fixed' ? 'fixed' : 'percentage',
                          amount: amt,
                          quarterlyRates: isSav
                            ? { Q1: amt, Q2: amt, Q3: amt, Q4: amt }
                            : undefined,
                          isSavingsSplit: isSav,
                          expenseCategory: !isSav
                            ? String(s.expenseCategory || 'Giving and Speaking')
                            : undefined,
                          expenseSubcategory: !isSav
                            ? String(s.expenseSubcategory || 'Givings')
                            : undefined,
                          destinationAccountId: defaultAccountId,
                          enabled: true,
                        }
                      : undefined,
                  incomeDraft:
                    kind === 'record_income'
                      ? {
                          clientOrSource: String(s.name || s.title || 'Income'),
                          category: 'Salary',
                          grossAmount: amt,
                          date: todayStr,
                          accountId: defaultAccountId,
                          applySuggestedDeductions: true,
                        }
                      : undefined,
                  expenseDraft:
                    kind === 'record_expense'
                      ? {
                          recipient: String(s.name || s.title || 'Expense'),
                          category: String(
                            s.expenseCategory || 'Giving and Speaking'
                          ),
                          subcategory: String(
                            s.expenseSubcategory || 'Givings'
                          ),
                          amount: amt,
                          date: todayStr,
                          accountId: defaultAccountId,
                        }
                      : undefined,
                };
              })
          : [];

        setMessages((prev) => [
          ...prev,
          {
            id: `msg_a_${Date.now()}`,
            role: 'assistant',
            content: String(data.reply).replace(/\s*&\s*/g, ' and '),
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            suggestions: mappedSuggestions,
          },
        ]);
      } else {
        const local = answerAppAssistantLocally(
          text,
          intel,
          actionableSuggestions
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_a_${Date.now()}`,
            role: 'assistant',
            content: local.reply,
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            suggestions: local.suggestions,
          },
        ]);
      }
    } catch {
      const local = answerAppAssistantLocally(
        text,
        intel,
        actionableSuggestions
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_a_${Date.now()}`,
          role: 'assistant',
          content: local.reply,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          suggestions: local.suggestions,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const selectedActionsList = actionableSuggestions.filter((a) =>
    selectedActionIds.has(a.id)
  );

  const severityStyles: Record<
    'alert' | 'warning' | 'positive' | 'info',
    string
  > = {
    alert: 'border-rose-200 bg-rose-50/70 text-rose-800',
    warning: 'border-amber-200 bg-amber-50/70 text-amber-800',
    positive: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
    info: 'border-slate-200 bg-slate-100 text-slate-700',
  };

  const quickPrompts = [
    'Ledger brief',
    'Budget status',
    'Recurring occurrences',
    'Top spending',
    'Account balances',
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-2.5 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-[86dvh] sm:h-[84vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Minimalist Agent Header */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 px-4 sm:px-5 py-3 bg-slate-50/70">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                App Assistant
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {intel.currentQuarter} · {accounts.length} accounts ·{' '}
              {intel.totals.activeBudgetsCount} budgets ·{' '}
              {intel.recurringOccurrences.length} occurrences
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setModelTier('fast')}
                className={`rounded-md px-2 py-1 font-medium transition-colors ${
                  modelTier === 'fast'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Fast
              </button>
              <button
                type="button"
                onClick={() => setModelTier('general')}
                className={`rounded-md px-2 py-1 font-medium transition-colors ${
                  modelTier === 'general'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Standard
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        {/* Live Database Strip + Clean 3-Tab Switcher */}
        <div className="border-b border-slate-100 px-4 sm:px-5 py-2.5 bg-white space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-2.5 py-1.5">
              <div className="text-[10px] font-medium text-slate-500">
                Operating Cash
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                {formatAmount(intel.totals.operatingCash, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-2.5 py-1.5">
              <div className="text-[10px] font-medium text-slate-500">
                Savings Vaults
              </div>
              <div className="font-mono text-xs font-semibold text-emerald-700 truncate">
                {formatAmount(intel.totals.savingsVaults, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-2.5 py-1.5">
              <div className="text-[10px] font-medium text-slate-500">
                30-Day Spend
              </div>
              <div className="font-mono text-xs font-semibold text-rose-700 truncate">
                {formatAmount(intel.totals.recent30DayExpenses, currency)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-2.5 py-1.5">
              <div className="text-[10px] font-medium text-slate-500">
                Budget Health
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                {intel.totals.activeBudgetsCount === 0
                  ? 'None active'
                  : intel.totals.exceededBudgetsCount > 0
                  ? `${intel.totals.exceededBudgetsCount} at limit`
                  : `${intel.totals.activeBudgetsCount} on track`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'chat', label: 'Assistant' },
                { id: 'insights', label: `Insights (${intel.insights.length})` },
                { id: 'actions', label: `Actions (${actionableSuggestions.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAssistantView(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  assistantView === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {statusBanner && (
          <div className="mx-4 sm:mx-5 mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3.5 py-2 text-xs font-medium text-emerald-900 flex items-center justify-between">
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: CONVERSATIONAL APP ASSISTANT */}
        {assistantView === 'chat' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3.5 space-y-3 bg-slate-50/40">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[90%] sm:max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed break-words ${
                      msg.role === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-800 shadow-2xs'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                        {msg.suggestions.map((sug) => {
                          const isApplied = appliedActionIds.has(sug.id);
                          return (
                            <div
                              key={sug.id}
                              className="flex items-center justify-between gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2"
                            >
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-slate-900 break-words">
                                  {sug.title}
                                </div>
                                <div className="text-[10px] text-slate-600 break-words">
                                  {sug.summary}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={
                                  (sug.kind !== 'navigate' && isApplied) ||
                                  isApplyingBatch
                                }
                                onClick={() => handleApplySelectedActions([sug])}
                                className="rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                              >
                                {sug.kind === 'navigate'
                                  ? sug.actionLabel || 'Open'
                                  : isApplied
                                  ? 'Recorded'
                                  : sug.actionLabel || 'Record'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <span className="mt-1 text-[10px] text-slate-400 px-1">
                    {msg.role === 'user' ? 'You' : 'App Assistant'} · {msg.timestamp}
                  </span>
                </div>
              ))}
              {isSending && (
                <div className="text-xs text-slate-500 font-mono px-1">
                  Checking your live ledger...
                </div>
              )}
              <div ref={threadEndRef} />
            </div>

            {/* Quick Prompt Chips + Composer */}
            <div className="border-t border-slate-200 bg-white px-4 sm:px-5 py-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {quickPrompts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isSending}
                    onClick={() => handleSendMessage(q)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about balances, budgets, occurrences, or how to do something..."
                  className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSending || !chatInput.trim()}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: PROACTIVE DATABASE INSIGHTS AND OCCURRENCES */}
        {assistantView === 'insights' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {intel.insights.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                Record income, expenses, or budgets to surface live insights and occurrences here.
              </div>
            ) : (
              <div className="space-y-2.5">
                {intel.insights.map((ins) => {
                  const isApplied = ins.action
                    ? appliedActionIds.has(ins.action.id)
                    : false;
                  return (
                    <div
                      key={ins.id}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
                              severityStyles[ins.severity]
                            }`}
                          >
                            {ins.badge}
                          </span>
                          <span className="text-xs font-semibold text-slate-900 break-words">
                            {ins.title}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] font-medium text-slate-700">
                          {ins.summary}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {ins.detail}
                        </div>
                      </div>

                      {ins.action && (
                        <button
                          type="button"
                          disabled={
                            (ins.action.kind !== 'navigate' && isApplied) ||
                            isApplyingBatch
                          }
                          onClick={() => handleApplySelectedActions([ins.action!])}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-900 hover:text-white disabled:opacity-50 shrink-0 self-start sm:self-center"
                        >
                          {ins.action.kind === 'navigate'
                            ? ins.action.actionLabel || 'Open'
                            : isApplied
                            ? 'Recorded'
                            : ins.action.actionLabel || 'Record'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {intel.recurringOccurrences.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <h3 className="text-xs font-semibold text-slate-900">
                  Detected Occurrences ({intel.recurringOccurrences.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {intel.recurringOccurrences.map((occ) => (
                    <div
                      key={occ.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {occ.label}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-700 shrink-0">
                          {formatAmount(occ.averageAmount, currency)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
                        <span>
                          {occ.count} times · {occ.subcategory || occ.category}
                        </span>
                        <span className="font-mono text-[10px]">
                          Last {occ.lastDateFormatted}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: LEARNED RECORD ACTIONS AND DEDUCTION RULES */}
        {assistantView === 'actions' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Suggested Rules and Records ({actionableSuggestions.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Learned from your ledger history for one-click recording
                </p>
              </div>

              {selectedActionsList.length > 0 && (
                <button
                  type="button"
                  disabled={isApplyingBatch}
                  onClick={() => handleApplySelectedActions(selectedActionsList)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isApplyingBatch
                    ? 'Recording...'
                    : `Record Selected (${selectedActionsList.length})`}
                </button>
              )}
            </div>

            {actionableSuggestions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                All learned deduction rules and frequent records are up to date.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {actionableSuggestions.map((act) => {
                  const isChecked = selectedActionIds.has(act.id);
                  const isApplied = appliedActionIds.has(act.id);
                  return (
                    <div
                      key={act.id}
                      onClick={() => {
                        if (!isApplied) toggleSelectAction(act.id);
                      }}
                      className={`rounded-xl border p-3 transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                        isApplied
                          ? 'border-emerald-200 bg-emerald-50/40 opacity-75 cursor-default'
                          : isChecked
                          ? 'border-slate-900 bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked || isApplied}
                            disabled={isApplied}
                            onChange={() => {
                              if (!isApplied) toggleSelectAction(act.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-0 shrink-0"
                          />
                          <div className="min-w-0 space-y-0.5">
                            <div className="text-xs font-semibold text-slate-900 break-words leading-snug">
                              {act.title}
                            </div>
                            <div className="font-mono text-[11px] font-medium text-slate-700 break-words">
                              {act.summary}
                            </div>
                          </div>
                        </label>

                        <button
                          type="button"
                          disabled={isApplied || isApplyingBatch}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApplySelectedActions([act]);
                          }}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-900 hover:text-white disabled:opacity-50 shrink-0"
                        >
                          {isApplied ? 'Recorded' : 'Record'}
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-500 break-words pl-6">
                        {act.reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
