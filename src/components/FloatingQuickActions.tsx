import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  IncomeReceipt,
  IncomeDeductionItem,
  FlexibleExpense,
  FinancialAccount,
  AccountTransfer,
  UserSettings,
} from '../types/finance.ts';
import {
  formatAmount,
  getQuarterFromDate,
  buildDefaultDeductionsForIncome,
  computeDeductionAmount,
  isSavingsDeduction,
  isSavingsVaultAccount,
  getEffectiveExpenseCategoryPreferences,
  resolveIntuitiveSubcategoryColor,
  DEFAULT_INCOME_SOURCES,
  DEFAULT_INCOME_ORIGINS,
} from '../lib/calculations.ts';
import {
  learnDeductionSuggestions,
  suggestionToIncomeDeductionItem,
} from '../lib/deductionIntelligence.ts';
import {
  SUPPORTED_CURRENCIES,
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  getExchangeRate,
  convertCurrency2dp,
  roundTo2Decimals,
  format2PointFloat,
  getAccountCurrency,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { WrapSelect } from './WrapSelect.tsx';
import { ActiveTab } from './Navigation.tsx';

interface FloatingQuickActionsProps {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
  onAddIncome: (
    receipt: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>
  ) => Promise<void>;
  onAddExpenses: (
    items: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[]
  ) => Promise<void>;
  onAddTransfer: (
    transfer: Omit<AccountTransfer, 'id' | 'createdAt'>
  ) => Promise<void>;
  onOpenDeductionAgent: () => void;
  onNavigateToExpandedForm: (
    tab: ActiveTab,
    formType: 'income' | 'expense' | 'transfer'
  ) => void;
}

export const FloatingQuickActions: React.FC<FloatingQuickActionsProps> = ({
  incomes,
  expenses,
  accounts,
  settings,
  currency,
  onAddIncome,
  onAddExpenses,
  onAddTransfer,
  onOpenDeductionAgent,
  onNavigateToExpandedForm,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<
    'transfer' | 'income' | 'expense' | null
  >(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const operatingAccounts = useMemo(
    () => accounts.filter((a) => !isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const defaultOperatingId =
    settings.defaultAccountId ||
    operatingAccounts.find((a) => a.isDefaultDeposit)?.id ||
    operatingAccounts[0]?.id ||
    accounts[0]?.id ||
    'acc-main-op';

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isMenuOpen]);

  // --- 1. TRANSFER FUND MODAL STATE ---
  const [transferSourceId, setTransferSourceId] = useState(defaultOperatingId);
  const [transferDestId, setTransferDestId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(todayStr);
  const [transferDesc, setTransferDesc] = useState('');
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  const availableDestAccounts = useMemo(
    () => accounts.filter((a) => a.id !== transferSourceId),
    [accounts, transferSourceId]
  );

  const effectiveDestId = useMemo(() => {
    if (
      transferDestId &&
      transferDestId !== transferSourceId &&
      availableDestAccounts.some((a) => a.id === transferDestId)
    ) {
      return transferDestId;
    }
    return availableDestAccounts[0]?.id || '';
  }, [transferDestId, transferSourceId, availableDestAccounts]);

  const handleOpenTransferModal = () => {
    setIsMenuOpen(false);
    setTransferSourceId(defaultOperatingId);
    setTransferDate(todayStr);
    setTransferAmount('');
    setTransferDesc('');
    setActiveModal('transfer');
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmt = roundTo2Decimals(parseFloat(transferAmount));
    if (isNaN(rawAmt) || rawAmt <= 0 || !transferSourceId || !effectiveDestId) return;
    setIsSubmittingTransfer(true);
    try {
      const sourceAcc = accounts.find((a) => a.id === transferSourceId);
      const destAcc = accounts.find((a) => a.id === effectiveDestId);
      const sourceCurr = getAccountCurrency(sourceAcc, currency);
      const destCurr = getAccountCurrency(destAcc, currency);
      const destConv = convertCurrency2dp(rawAmt, sourceCurr, destCurr, fxSnapshot);
      const baseConv = convertCurrency2dp(rawAmt, sourceCurr, currency, fxSnapshot);

      await onAddTransfer({
        userId: settings.userId,
        date: transferDate,
        sourceAccountId: transferSourceId,
        destinationAccountId: effectiveDestId,
        sourceCurrency: sourceCurr,
        sourceAmount: rawAmt,
        destinationCurrency: destCurr,
        destinationAmount: destConv.convertedAmount,
        exchangeRate: destConv.exchangeRate2dp,
        amount: baseConv.convertedAmount,
        transferType: 'general',
        description: transferDesc.trim() || 'Account transfer',
      });
      setActiveModal(null);
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  // --- 2. QUICK INCOME MODAL STATE ---
  const incomeSourceOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_INCOME_SOURCES);
    for (const s of settings.incomeSources || []) {
      if (s && s.trim()) set.add(s.trim());
    }
    for (const i of incomes) {
      if (i.clientOrSource && i.clientOrSource.trim()) {
        set.add(i.clientOrSource.trim());
      }
    }
    return Array.from(set);
  }, [settings.incomeSources, incomes]);

  const incomeOriginOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_INCOME_ORIGINS);
    for (const o of settings.incomeOrigins || []) {
      if (o && o.trim()) set.add(o.trim());
    }
    for (const i of incomes) {
      if (i.notes && i.notes.trim()) set.add(i.notes.trim());
    }
    return Array.from(set);
  }, [settings.incomeOrigins, incomes]);

  const [incDate, setIncDate] = useState(todayStr);
  const [incSource, setIncSource] = useState(
    incomeSourceOptions[0] || 'Monthly Salary'
  );
  const [isCustomIncSource, setIsCustomIncSource] = useState(false);
  const [customIncSourceText, setCustomIncSourceText] = useState('');
  const [incOrigin, setIncOrigin] = useState('');
  const [isCustomIncOrigin, setIsCustomIncOrigin] = useState(false);
  const [customIncOriginText, setCustomIncOriginText] = useState('');
  const [incGross, setIncGross] = useState('');
  const [incCurrency, setIncCurrency] = useState(currency);
  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );
  const [incAccountId, setIncAccountId] = useState(defaultOperatingId);
  const [incNetTransferAccountId, setIncNetTransferAccountId] = useState(
    settings.defaultNetIncomeAccountId || ''
  );
  const [incDeductions, setIncDeductions] = useState<IncomeDeductionItem[]>([]);
  const [isSubmittingInc, setIsSubmittingInc] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMarketExchangeRates(currency).then((snap) => {
      if (active) setFxSnapshot(snap);
    });
    return () => {
      active = false;
    };
  }, [currency]);

  const rawIncGross = roundTo2Decimals(parseFloat(incGross) || 0);
  const incFxRate = getExchangeRate(incCurrency, currency, fxSnapshot).rate2dp;
  const incConvertedToBase = convertCurrency2dp(
    rawIncGross,
    incCurrency,
    currency,
    fxSnapshot
  ).convertedAmount;
  // Save & compute the income in the account's native currency without conversion
  const numericIncGross = rawIncGross;
  const activeIncQuarter = getQuarterFromDate(incDate);

  const learnedForIncome = useMemo(
    () =>
      learnDeductionSuggestions({
        incomes,
        expenses,
        settings,
        activeDate: incDate,
        activeSource: isCustomIncSource ? customIncSourceText : incSource,
        activeOrigin: isCustomIncOrigin ? customIncOriginText : incOrigin,
        grossAmount: numericIncGross,
      }),
    [
      incomes,
      expenses,
      settings,
      incDate,
      isCustomIncSource,
      customIncSourceText,
      incSource,
      isCustomIncOrigin,
      customIncOriginText,
      incOrigin,
      numericIncGross,
    ]
  );

  const handleOpenIncomeModal = () => {
    setIsMenuOpen(false);
    setIncDate(todayStr);
    setIncSource(incomeSourceOptions[0] || 'Monthly Salary');
    setIsCustomIncSource(false);
    setCustomIncSourceText('');
    setIncOrigin('');
    setIsCustomIncOrigin(false);
    setCustomIncOriginText('');
    setIncGross('');
    setIncAccountId(defaultOperatingId);
    const defaultIncAcc = accounts.find((a) => a.id === defaultOperatingId);
    setIncCurrency(getAccountCurrency(defaultIncAcc, currency));
    setIncNetTransferAccountId(settings.defaultNetIncomeAccountId || '');
    setIncDeductions(
      buildDefaultDeductionsForIncome(0, settings, expenses, todayStr)
    );
    setActiveModal('income');
  };

  const handleIncGrossOrDateChange = (
    nextGrossStr: string,
    nextDateStr: string,
    dateChanged = false
  ) => {
    const g = roundTo2Decimals(parseFloat(nextGrossStr) || 0);
    setIncDeductions((prev) =>
      prev.map((d) => {
        if (dateChanged && isSavingsDeduction(d) && !d.isCustomRateOverride) {
          const matchedCut = (settings.customCuts || []).find(
            (c) =>
              `ded_${c.id}` === d.id ||
              c.name.trim().toLowerCase() === d.name.trim().toLowerCase()
          );
          if (matchedCut && matchedCut.quarterlyRates) {
            const q = getQuarterFromDate(nextDateStr);
            const nextVal = matchedCut.quarterlyRates[q] ?? d.value;
            return {
              ...d,
              value: nextVal,
              amount: computeDeductionAmount(g, d.type, nextVal),
            };
          }
        }
        return {
          ...d,
          amount: computeDeductionAmount(g, d.type, d.value),
        };
      })
    );
  };

  const handleSubmitIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSource = (
      isCustomIncSource ? customIncSourceText : incSource
    ).trim();
    const finalOrigin = (
      isCustomIncOrigin ? customIncOriginText : incOrigin
    ).trim();
    if (!finalSource || rawIncGross <= 0) return;

    setIsSubmittingInc(true);
    try {
      const finalizedDeductions = incDeductions
        .filter((d) => d.name.trim() !== '' && d.value > 0)
        .map((d) => ({
          ...d,
          value: Number(d.value) || 0,
          amount: computeDeductionAmount(
            rawIncGross,
            d.type,
            Number(d.value) || 0
          ),
        }));
      const totalDedAmt = finalizedDeductions.reduce((s, d) => s + d.amount, 0);
      const totalDedRate =
        rawIncGross > 0
          ? Math.min(100, Math.round(((totalDedAmt / rawIncGross) * 100) * 10) / 10)
          : 0;
      const targetAcc = incAccountId || defaultOperatingId;
      let cleanNetTargetId: string | undefined;
      if (incNetTransferAccountId === '__KEEP__') {
        cleanNetTargetId = '__KEEP__';
      } else if (
        incNetTransferAccountId &&
        incNetTransferAccountId !== targetAcc
      ) {
        cleanNetTargetId = incNetTransferAccountId;
      } else if (
        !incNetTransferAccountId &&
        settings.defaultNetIncomeAccountId &&
        settings.defaultNetIncomeAccountId !== targetAcc
      ) {
        cleanNetTargetId = '__KEEP__';
      }

      const targetAccObj = accounts.find((a) => a.id === targetAcc);
      const activeCurr = (
        incCurrency || getAccountCurrency(targetAccObj, currency)
      ).toUpperCase();

      await onAddIncome({
        date: incDate,
        quarter: activeIncQuarter,
        clientOrSource: finalSource,
        category: 'Salary',
        grossAmount: rawIncGross,
        currency: activeCurr,
        originalGrossAmount: rawIncGross,
        exchangeRate: incFxRate,
        savingsRate: totalDedRate,
        receiptId: `INC-${Date.now().toString().slice(-6)}`,
        accountId: targetAcc,
        netTransferredToAccountId: cleanNetTargetId,
        allocatedDeductions: finalizedDeductions,
        notes: finalOrigin || undefined,
      });
      setActiveModal(null);
    } finally {
      setIsSubmittingInc(false);
    }
  };

  // --- 3. QUICK EXPENSE MODAL STATE ---
  const expenseCategories = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings, expenses),
    [settings, expenses]
  );

  const [expDate, setExpDate] = useState(todayStr);
  const [expAccountId, setExpAccountId] = useState(defaultOperatingId);
  const [expRecipient, setExpRecipient] = useState('');
  const [expCategory, setExpCategory] = useState(
    expenseCategories[0]?.name || 'Utilities'
  );
  const [expSubcategory, setExpSubcategory] = useState(
    expenseCategories[0]?.subcategories?.[0] || ''
  );
  const [expCurrency, setExpCurrency] = useState(currency);
  const [expAmount, setExpAmount] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [isSubmittingExp, setIsSubmittingExp] = useState(false);

  const activeExpSubcategories = useMemo(() => {
    const matched = expenseCategories.find((c) => c.name === expCategory);
    return matched?.subcategories || [];
  }, [expenseCategories, expCategory]);

  const handleOpenExpenseModal = () => {
    setIsMenuOpen(false);
    setExpDate(todayStr);
    setExpAccountId(defaultOperatingId);
    const defaultExpAcc = accounts.find((a) => a.id === defaultOperatingId);
    setExpCurrency(getAccountCurrency(defaultExpAcc, currency));
    setExpRecipient('');
    const firstCat = expenseCategories[0]?.name || 'Utilities';
    setExpCategory(firstCat);
    setExpSubcategory(expenseCategories[0]?.subcategories?.[0] || '');
    setExpAmount('');
    setExpNotes('');
    setActiveModal('expense');
  };

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmt = roundTo2Decimals(parseFloat(expAmount));
    if (isNaN(rawAmt) || rawAmt <= 0 || !expAccountId) return;
    setIsSubmittingExp(true);
    try {
      const selectedAcc = accounts.find((a) => a.id === expAccountId);
      const selectedCurr = (
        expCurrency || getAccountCurrency(selectedAcc, currency)
      ).toUpperCase();
      const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
        rawAmt,
        selectedCurr,
        currency,
        fxSnapshot
      );
      const toLabel = expRecipient.trim();
      const noteLabel = expNotes.trim();
      const catLabel = expCategory || 'General';
      const subLabel = expSubcategory || undefined;
      const subColor = subLabel
        ? resolveIntuitiveSubcategoryColor(subLabel, catLabel, settings, expenses)
        : undefined;

      await onAddExpenses([
        {
          date: expDate,
          accountId: expAccountId,
          recipient: toLabel || undefined,
          category: catLabel,
          subcategory: subLabel,
          subcategoryColor: subColor,
          notes: noteLabel || undefined,
          description: toLabel
            ? `${toLabel}${noteLabel ? ` — ${noteLabel}` : ''}`
            : noteLabel || catLabel,
          currency: selectedCurr,
          originalAmount: rawAmt,
          exchangeRate: exchangeRate2dp,
          amount: convertedAmount,
        },
      ]);
      setActiveModal(null);
    } finally {
      setIsSubmittingExp(false);
    }
  };

  return (
    <>
      {/* Floating Bottom-Right + Button and Pop-Up Menu Right On Top */}
      <div
        ref={menuContainerRef}
        className="fixed bottom-6 right-6 z-40 flex flex-col items-end"
      >
        {isMenuOpen && (
          <div className="mb-3 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Quick Record
            </div>

            <button
              type="button"
              onClick={handleOpenTransferModal}
              className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <span>Transfer Fund</span>
              <span className="text-[11px] font-normal text-slate-400">⇄</span>
            </button>

            <button
              type="button"
              onClick={handleOpenIncomeModal}
              className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <span>Income</span>
              <span className="text-[11px] font-mono text-emerald-700">+</span>
            </button>

            <button
              type="button"
              onClick={handleOpenExpenseModal}
              className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <span>Expense</span>
              <span className="text-[11px] font-mono text-rose-700">−</span>
            </button>

            <div className="border-t border-slate-100 my-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenDeductionAgent();
                }}
                className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <span>Deduction Assistant</span>
                <span className="text-[10px] font-mono text-slate-400">AI</span>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          aria-label="Quick Record Actions"
          aria-expanded={isMenuOpen}
          style={{ backgroundColor: 'var(--app-accent)' }}
          className="h-13 w-13 rounded-full text-white shadow-xl hover:opacity-95 focus:outline-none flex items-center justify-center transition-transform duration-150 active:scale-95"
        >
          <svg
            className={`h-6 w-6 transition-transform duration-150 ${
              isMenuOpen ? 'rotate-45' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
          </svg>
        </button>
      </div>

      {/* 1. Transfer Fund Modal */}
      {activeModal === 'transfer' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Transfer Fund
                </h3>
                <p className="text-xs text-slate-500">
                  Move funds between operating accounts and savings vaults
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    onNavigateToExpandedForm('accounts', 'transfer');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 underline"
                >
                  Full View
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitTransfer} className="space-y-3.5">
            {(() => {
              const sourceAcc = accounts.find((a) => a.id === transferSourceId);
              const destAcc = accounts.find((a) => a.id === effectiveDestId);
              const sourceCurr = getAccountCurrency(sourceAcc, currency);
              const destCurr = getAccountCurrency(destAcc, currency);
              const rawAmt = parseFloat(transferAmount) || 0;
              const destConv = convertCurrency2dp(
                rawAmt,
                sourceCurr,
                destCurr,
                fxSnapshot
              );
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        From Account
                      </label>
                      <WrapSelect
                        value={transferSourceId}
                        onChange={(val) => setTransferSourceId(val)}
                        options={accounts.map((a) => ({
                          value: a.id,
                          label: `${a.name} (${getAccountCurrency(a, currency)})`,
                        }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        To Account
                      </label>
                      <WrapSelect
                        value={effectiveDestId}
                        onChange={(val) => setTransferDestId(val)}
                        options={availableDestAccounts.map((a) => ({
                          value: a.id,
                          label: `${a.name} (${getAccountCurrency(a, currency)})`,
                        }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Amount ({sourceCurr})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        required
                        value={transferDate}
                        onChange={(e) => setTransferDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  {rawAmt > 0 && (sourceCurr !== destCurr || sourceCurr !== currency) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-600 tabular-nums">
                        Auto Rate: 1 {sourceCurr} = {format2PointFloat(destConv.exchangeRate2dp)} {destCurr}
                      </span>
                      <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                        {destAcc?.name || 'To Account'} gets {formatAmount(destConv.convertedAmount, destCurr)}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={transferDesc}
                  onChange={(e) => setTransferDesc(e.target.value)}
                  placeholder="Purpose of transfer"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTransfer}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmittingTransfer ? 'Transferring...' : 'Record Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Quick Record Income Modal */}
      {activeModal === 'income' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Record Income ({activeIncQuarter})
                </h3>
                <p className="text-xs text-slate-500">
                  Suggested deductions are matched to your history and {activeIncQuarter} rates
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    onNavigateToExpandedForm('income_log', 'income');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 underline"
                >
                  Full View
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitIncome} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date ({activeIncQuarter})
                  </label>
                  <input
                    type="date"
                    required
                    value={incDate}
                    onChange={(e) => {
                      const d = e.target.value;
                      setIncDate(d);
                      handleIncGrossOrDateChange(incGross, d, true);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Receiving Account
                  </label>
                  <WrapSelect
                    value={incAccountId}
                    onChange={(val) => {
                      setIncAccountId(val);
                      const nextAcc = accounts.find((a) => a.id === val);
                      if (nextAcc) {
                        setIncCurrency(getAccountCurrency(nextAcc, currency));
                      }
                    }}
                    options={operatingAccounts.map((a) => ({
                      value: a.id,
                      label: `${a.name} (${getAccountCurrency(a, currency)})`,
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Income Source
                  </label>
                  <WrapSelect
                    value={isCustomIncSource ? '__CUSTOM__' : incSource}
                    onChange={(val) => {
                      if (val === '__CUSTOM__') {
                        setIsCustomIncSource(true);
                        setCustomIncSourceText('');
                      } else {
                        setIsCustomIncSource(false);
                        setIncSource(val);
                      }
                    }}
                    options={[
                      ...incomeSourceOptions.map((s) => ({ value: s, label: s })),
                      { value: '__CUSTOM__', label: '+ Add New Income Source...' },
                    ]}
                  />
                  {isCustomIncSource && (
                    <input
                      type="text"
                      required
                      autoFocus
                      value={customIncSourceText}
                      onChange={(e) => setCustomIncSourceText(e.target.value)}
                      placeholder="Enter new income source..."
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Source (Optional)
                  </label>
                  <WrapSelect
                    value={isCustomIncOrigin ? '__CUSTOM__' : incOrigin}
                    onChange={(val) => {
                      if (val === '__CUSTOM__') {
                        setIsCustomIncOrigin(true);
                        setCustomIncOriginText('');
                      } else {
                        setIsCustomIncOrigin(false);
                        setIncOrigin(val);
                      }
                    }}
                    options={[
                      { value: '', label: 'Select Source...' },
                      ...incomeOriginOptions.map((o) => ({ value: o, label: o })),
                      { value: '__CUSTOM__', label: '+ Add New Source...' },
                    ]}
                  />
                  {isCustomIncOrigin && (
                    <input
                      type="text"
                      autoFocus
                      value={customIncOriginText}
                      onChange={(e) => setCustomIncOriginText(e.target.value)}
                      placeholder="Enter new source..."
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Currency
                  </label>
                  <WrapSelect
                    value={incCurrency}
                    onChange={(val) => {
                      setIncCurrency(val);
                      handleIncGrossOrDateChange(incGross, incDate, false);
                    }}
                    options={SUPPORTED_CURRENCIES.map((code) => ({
                      value: code,
                      label:
                        code === currency ? `${code} (App Base)` : code,
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Total Income ({incCurrency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={incGross}
                    onChange={(e) => {
                      const g = e.target.value;
                      setIncGross(g);
                      handleIncGrossOrDateChange(g, incDate, false);
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                  {incCurrency !== currency && (
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-emerald-700 bg-emerald-50/70 border border-emerald-200/70 rounded px-2 py-0.5">
                      <span>
                        Saved in {incCurrency} (No Conversion)
                      </span>
                      <span className="font-semibold">
                        Totals: {formatAmount(incConvertedToBase, currency)} @ {format2PointFloat(incFxRate)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Learned Deduction Suggestions */}
              {learnedForIncome.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Suggested Deductions (Tap to Toggle)
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {incDeductions.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {learnedForIncome.map((sug) => {
                      const isSelected = incDeductions.some(
                        (d) =>
                          d.name.trim().toLowerCase() ===
                          sug.name.trim().toLowerCase()
                      );
                      return (
                        <button
                          key={sug.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setIncDeductions((prev) =>
                                prev.filter(
                                  (d) =>
                                    d.name.trim().toLowerCase() !==
                                    sug.name.trim().toLowerCase()
                                )
                              );
                            } else {
                              setIncDeductions((prev) => [
                                ...prev,
                                suggestionToIncomeDeductionItem(
                                  sug,
                                  numericIncGross,
                                  incDate
                                ),
                              ]);
                            }
                          }}
                          className={`rounded-lg border px-2.5 py-1 text-left text-xs transition-colors ${
                            isSelected
                              ? 'border-slate-900 bg-slate-900 text-white font-medium'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {sug.name} (
                          {sug.type === 'percentage'
                            ? `${sug.value}%`
                            : formatAmount(sug.value, incCurrency)}
                          )
                        </button>
                      );
                    })}
                  </div>

                  {/* Editable Rates for Selected Deductions */}
                  {incDeductions.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-200/70">
                      {incDeductions.map((ded) => (
                        <div
                          key={ded.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <span className="font-medium text-slate-800 break-words min-w-0">
                            {ded.name}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={ded.value}
                              onChange={(e) => {
                                const nextVal = Math.max(
                                  0,
                                  parseFloat(e.target.value) || 0
                                );
                                setIncDeductions((prev) =>
                                  prev.map((item) =>
                                    item.id === ded.id
                                      ? {
                                          ...item,
                                          value: nextVal,
                                          amount: computeDeductionAmount(
                                            numericIncGross,
                                            item.type,
                                            nextVal
                                          ),
                                          isCustomRateOverride: true,
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="w-16 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                            />
                            <span className="font-mono text-[11px] text-slate-500">
                              {ded.type === 'percentage' ? '%' : incCurrency}
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              -{formatAmount(
                                computeDeductionAmount(
                                  numericIncGross,
                                  ded.type,
                                  ded.value
                                ),
                                incCurrency
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Net Income After Deductions Destination Account & Live Summary */}
              {(() => {
                const totalQuickDed =
                  Math.round(
                    incDeductions.reduce(
                      (s, d) =>
                        s +
                        computeDeductionAmount(
                          numericIncGross,
                          d.type,
                          d.value
                        ),
                      0
                    ) * 100
                  ) / 100;
                const quickNet = Math.max(
                  0,
                  Math.round((numericIncGross - totalQuickDed) * 100) / 100
                );
                const receivingName =
                  accounts.find((a) => a.id === incAccountId)?.name ||
                  'Receiving Account';
                const destName =
                  incNetTransferAccountId &&
                  incNetTransferAccountId !== '__KEEP__' &&
                  incNetTransferAccountId !== incAccountId
                    ? accounts.find((a) => a.id === incNetTransferAccountId)
                        ?.name
                    : undefined;
                return (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">
                        Net Income After Deductions
                      </span>
                      <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                        {formatAmount(quickNet, incCurrency)}
                      </span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Transfer Net Income After Deductions To
                      </label>
                      <WrapSelect
                        value={
                          incNetTransferAccountId === '__KEEP__'
                            ? ''
                            : incNetTransferAccountId
                        }
                        onChange={(val) =>
                          setIncNetTransferAccountId(val || '__KEEP__')
                        }
                        options={[
                          {
                            value: '',
                            label: `Keep in ${receivingName}`,
                          },
                          ...accounts
                            .filter((a) => a.id !== incAccountId)
                            .map((a) => ({
                              value: a.id,
                              label: `Transfer Net to ${a.name}`,
                            })),
                        ]}
                      />
                    </div>
                    {destName && (
                      <div className="text-[11px] text-emerald-700 font-medium">
                        {formatAmount(quickNet, currency)} will be transferred from{' '}
                        {receivingName} to {destName}.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInc}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmittingInc ? 'Recording...' : 'Record Income'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Quick Record Expense Modal */}
      {activeModal === 'expense' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Record Expense
                </h3>
                <p className="text-xs text-slate-500">
                  Log an expense directly to your selected account and category
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    onNavigateToExpandedForm('flexible_expenses', 'expense');
                  }}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 underline"
                >
                  Full View
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitExpense} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Account
                  </label>
                  <WrapSelect
                    value={expAccountId}
                    onChange={(val) => {
                      const prevAcc = accounts.find((a) => a.id === expAccountId);
                      const nextAcc = accounts.find((a) => a.id === val);
                      const prevCurr = getAccountCurrency(prevAcc, currency);
                      const nextCurr = getAccountCurrency(nextAcc, currency);
                      setExpAccountId(val);
                      if (!expCurrency || expCurrency === prevCurr) {
                        setExpCurrency(nextCurr);
                      }
                    }}
                    options={accounts.map((a) => ({
                      value: a.id,
                      label: `${a.name} (${getAccountCurrency(a, currency)})`,
                    }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <WrapSelect
                    value={expCategory}
                    onChange={(val) => {
                      setExpCategory(val);
                      const matched = expenseCategories.find((c) => c.name === val);
                      setExpSubcategory(matched?.subcategories?.[0] || '');
                    }}
                    options={expenseCategories.map((c) => ({
                      value: c.name,
                      label: c.name,
                    }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Subcategory
                  </label>
                  <WrapSelect
                    value={expSubcategory}
                    onChange={(val) => setExpSubcategory(val)}
                    options={[
                      ...activeExpSubcategories.map((s) => ({ value: s, label: s })),
                      { value: '', label: 'None' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Recipient / Purpose
                  </label>
                  <input
                    type="text"
                    value={expRecipient}
                    onChange={(e) => setExpRecipient(e.target.value)}
                    placeholder="e.g. Electricity, Support"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount ({expCurrency})
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={expCurrency}
                      onChange={(e) => setExpCurrency(e.target.value)}
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
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {(() => {
                const selectedAcc = accounts.find((a) => a.id === expAccountId);
                const accCurr = getAccountCurrency(selectedAcc, currency);
                const rawExpAmt = parseFloat(expAmount) || 0;
                if (rawExpAmt <= 0 || (expCurrency === accCurr && expCurrency === currency)) {
                  return null;
                }
                const accConv = convertCurrency2dp(rawExpAmt, expCurrency, accCurr, fxSnapshot);
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-mono text-slate-600 tabular-nums">
                      Auto Rate: 1 {expCurrency} = {format2PointFloat(accConv.exchangeRate2dp)} {accCurr}
                    </span>
                    <span className="font-mono font-semibold text-rose-600 tabular-nums">
                      Deducts {formatAmount(accConv.convertedAmount, accCurr)} from {selectedAcc?.name || 'Account'}
                    </span>
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  placeholder="Optional details"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExp}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmittingExp ? 'Recording...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
