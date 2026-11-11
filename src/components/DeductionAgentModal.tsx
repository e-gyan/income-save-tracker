import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  IncomeReceipt,
  FlexibleExpense,
  FinancialAccount,
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
  learnDeductionSuggestions,
  buildActionableAgentSuggestions,
  AgentRecordAction,
} from '../lib/deductionIntelligence.ts';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestions?: AgentRecordAction[];
}

interface DeductionAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
  onSaveSettings: (settings: UserSettings) => Promise<void>;
  onAddIncome: (
    receipt: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ) => Promise<void>;
  onAddExpenses: (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => Promise<void>;
}

export const DeductionAgentModal: React.FC<DeductionAgentModalProps> = ({
  isOpen,
  onClose,
  incomes,
  expenses,
  accounts,
  settings,
  currency,
  onSaveSettings,
  onAddIncome,
  onAddExpenses,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentQuarter = getQuarterFromDate(todayStr);

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

  const learnedDeductions = useMemo(
    () =>
      learnDeductionSuggestions({
        incomes,
        expenses,
        settings,
        activeDate: todayStr,
      }),
    [incomes, expenses, settings, todayStr]
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

  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(
    new Set()
  );
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(
    new Set()
  );
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Multi-turn chat state
  const [modelTier, setModelTier] = useState<'general' | 'fast'>('general');
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome_msg',
      role: 'assistant',
      content: `I have analyzed your ${incomes.length} income records, ${expenses.length} expenses, and ${(settings.customCuts || []).filter((c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)).length} defined deductions for ${currentQuarter}. Select any suggested item below to record it, or ask me how to optimize your deductions.`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
  ]);

  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isOpen]);

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
    action: AgentRecordAction,
    currentCuts: CustomDeduction[]
  ): Promise<CustomDeduction[]> => {
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
        return [...currentCuts, newCut];
      }
      return currentCuts;
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
        notes: action.incomeDraft.notes || 'Recorded from learned deduction suggestion',
      });
      return currentCuts;
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
          notes:
            action.expenseDraft.notes ||
            'Recorded from learned expense suggestion',
        },
      ]);
      return currentCuts;
    }

    return currentCuts;
  };

  const handleApplySelectedActions = async (actionsToRun: AgentRecordAction[]) => {
    if (actionsToRun.length === 0) return;
    setIsApplyingBatch(true);
    setStatusBanner(null);

    try {
      let nextCuts = [...(settings.customCuts || [])].filter(
        (c) => !LEGACY_SEEDED_CUT_IDS.has(c.id)
      );
      let cutsChanged = false;

      for (const act of actionsToRun) {
        const beforeLen = nextCuts.length;
        nextCuts = await executeSingleAction(act, nextCuts);
        if (nextCuts.length !== beforeLen) {
          cutsChanged = true;
        }
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
      setStatusBanner(
        `Recorded ${actionsToRun.length} selected suggestion${
          actionsToRun.length === 1 ? '' : 's'
        }.`
      );
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const handleSendMessage = async (promptText?: string) => {
    const text = (promptText ?? chatInput).trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!promptText) setChatInput('');
    setIsSending(true);

    try {
      const financialContext = {
        currency,
        currentQuarter,
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
        learnedPatterns: learnedDeductions.slice(0, 8),
        recentIncomes: incomes.slice(0, 8).map((i) => ({
          date: i.date,
          clientOrSource: i.clientOrSource,
          notes: i.notes,
          grossAmount: i.grossAmount,
          deductions: (i.allocatedDeductions || []).map((d) => ({
            name: d.name,
            type: d.type,
            value: d.value,
            isSavingsSplit: d.isSavingsSplit,
            expenseCategory: d.expenseCategory,
            expenseSubcategory: d.expenseSubcategory,
          })),
        })),
        recentExpenses: expenses.slice(0, 10).map((e) => ({
          date: e.date,
          recipient: e.recipient,
          category: e.category,
          subcategory: e.subcategory,
          amount: e.amount,
        })),
      };

      const res = await fetch('/api/ai/chat-deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          modelTier,
          financialContext,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const mappedSuggestions: AgentRecordAction[] = Array.isArray(
          data.suggestions
        )
          ? data.suggestions
              .filter((s: any) => s && s.title)
              .map((s: any, idx: number): AgentRecordAction => {
                const kind =
                  s.kind === 'record_income' || s.kind === 'record_expense'
                    ? s.kind
                    : 'apply_deduction_rule';
                const amt = Number(s.amount) > 0 ? Number(s.amount) : 10;
                const isSav = s.routeTo === 'savings_split';
                return {
                  id: `ai_sug_${Date.now()}_${idx}`,
                  kind,
                  title: String(s.title),
                  summary:
                    String(s.summary || '') ||
                    `${amt}${s.deductionType === 'percentage' ? '%' : ` ${currency}`}`,
                  reason: String(
                    s.reason || 'Suggested by Deduction Intelligence Agent'
                  ),
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
                            ? String(s.expenseCategory || 'Giving & Speaking')
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
                            s.expenseCategory || 'Giving & Speaking'
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
            content: data.reply,
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            suggestions: mappedSuggestions,
          },
        ]);
      } else {
        const fallbackSummary =
          learnedDeductions.length > 0
            ? `Based on your records, your top deduction patterns are: ${learnedDeductions
                .slice(0, 3)
                .map(
                  (d) =>
                    `${d.name} (${
                      d.type === 'percentage'
                        ? `${d.value}%`
                        : formatAmount(d.value, currency)
                    })`
                )
                .join(', ')}. You can select and record any suggestion above.`
            : 'Add or select any deduction suggestion above to apply it to your ledger.';

        setMessages((prev) => [
          ...prev,
          {
            id: `msg_a_${Date.now()}`,
            role: 'assistant',
            content: fallbackSummary,
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_a_${Date.now()}`,
          role: 'assistant',
          content:
            'Your local deduction patterns are ready above. Select any item and click Record Selected to apply it.',
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const selectedActionsList = actionableSuggestions.filter((a) =>
    selectedActionIds.has(a.id)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-slate-50/70">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Deduction & Record Intelligence
            </h2>
            <p className="text-xs text-slate-500">
              Learns from your deductions, income sources, and expenses across the board
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

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {statusBanner && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3.5 py-2 text-xs font-medium text-emerald-900 flex items-center justify-between">
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

          {/* Section 1: Learned Suggestions to Select & Record */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Suggested Deductions & Records ({actionableSuggestions.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Select items below to save rules or record entries directly
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
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                All learned deduction rules are already active in your settings.
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

          {/* Section 2: Multi-Turn Gemini Chat Thread */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Ask Deduction Assistant
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  'Suggest deductions from my history',
                  `Check my ${currentQuarter} savings rate`,
                  'Match Giving & Speaking expenses',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSendMessage(q)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 max-h-64 overflow-y-auto space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed break-words ${
                      msg.role === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-800'
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
                              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
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
                                disabled={isApplied || isApplyingBatch}
                                onClick={() => handleApplySelectedActions([sug])}
                                className="rounded bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                              >
                                {isApplied ? 'Recorded' : 'Select & Record'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <span className="mt-1 text-[10px] text-slate-400 px-1">
                    {msg.role === 'user' ? 'You' : 'Assistant'} · {msg.timestamp}
                  </span>
                </div>
              ))}
              {isSending && (
                <div className="text-xs text-slate-500 font-mono px-2">
                  Reviewing your ledger patterns...
                </div>
              )}
              <div ref={threadEndRef} />
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
                placeholder="Ask about your deductions, quarterly rates, or expenses..."
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
      </div>
    </div>
  );
};
