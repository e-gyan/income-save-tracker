import React, { useState, useEffect, useMemo } from 'react';
import {
  FlexibleExpense,
  FinancialAccount,
  UserSettings,
  ExpenseCategoryPreference,
} from '../types/finance.ts';
import {
  formatAmount,
  isSavingsVaultAccount,
  getEffectiveExpenseCategoryPreferences,
  resolveIntuitiveSubcategoryColor,
} from '../lib/calculations.ts';
import {
  SUPPORTED_CURRENCIES,
  convertCurrency2dp,
  roundTo2Decimals,
  format2PointFloat,
  getAccountCurrency,
  fetchMarketExchangeRates,
  getInitialFxSnapshot,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../lib/dateFilters.ts';
import { learnSavingsVaultDebitAccount } from '../lib/deductionIntelligence.ts';

interface EditExpenseModalProps {
  isOpen: boolean;
  expense: FlexibleExpense | null;
  expenses: FlexibleExpense[];
  accounts: FinancialAccount[];
  settings: UserSettings;
  currency: string;
  onClose: () => void;
  onSaveExpense: (updatedExpense: FlexibleExpense) => Promise<void>;
  onMoveSubcategory?: (
    subcategory: string,
    fromCategory: string,
    toCategory: string
  ) => Promise<void>;
}

export const EditExpenseModal: React.FC<EditExpenseModalProps> = ({
  isOpen,
  expense,
  expenses,
  accounts,
  settings,
  currency,
  onClose,
  onSaveExpense,
  onMoveSubcategory,
}) => {
  const [date, setDate] = useState('');
  const [recipient, setRecipient] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [accountId, setAccountId] = useState('');
  const [vaultAction, setVaultAction] = useState<'debit' | 'credit'>('debit');
  const [expCurrency, setExpCurrency] = useState(currency);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Optional inline subcategory move state
  const [showMoveSubcategory, setShowMoveSubcategory] = useState(false);
  const [moveTargetCategory, setMoveTargetCategory] = useState('');
  const [isMovingSub, setIsMovingSub] = useState(false);

  const [fxSnapshot, setFxSnapshot] = useState<MarketFxSnapshot>(() =>
    getInitialFxSnapshot(currency)
  );

  useEffect(() => {
    fetchMarketExchangeRates(currency).then((snap) => {
      setFxSnapshot(snap);
    });
  }, [currency]);

  const categoryPreferences: ExpenseCategoryPreference[] = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings, expenses),
    [settings, expenses]
  );

  const operatingAccounts = useMemo(
    () => accounts.filter((a) => !isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  const savingsVaultAccounts = useMemo(
    () => accounts.filter((a) => isSavingsVaultAccount(a, settings)),
    [accounts, settings]
  );

  useEffect(() => {
    if (!expense) return;
    setDate((expense.date || '').slice(0, 10));
    setRecipient(expense.recipient || '');
    setCategory(expense.category || categoryPreferences[0]?.name || 'General');
    setSubcategory(expense.subcategory || '');
    setAccountId(
      expense.accountId ||
        settings.defaultAccountId ||
        operatingAccounts[0]?.id ||
        accounts[0]?.id ||
        ''
    );
    setVaultAction(expense.vaultAction === 'credit' ? 'credit' : 'debit');
    const matchedAcc = accounts.find((a) => a.id === expense.accountId);
    const initialCurr = (
      expense.currency || getAccountCurrency(matchedAcc, currency)
    ).toUpperCase();
    setExpCurrency(initialCurr);
    const nativeVal =
      expense.originalAmount !== undefined && expense.originalAmount > 0
        ? expense.originalAmount
        : expense.amount;
    setAmount(String(roundTo2Decimals(nativeVal)));
    setNotes(expense.notes || expense.description || '');
    setErrorMsg(null);
    setShowMoveSubcategory(false);
  }, [expense, accounts, settings.defaultAccountId, operatingAccounts, currency, categoryPreferences]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId]
  );

  const isSelectedAccountVault = useMemo(
    () =>
      Boolean(
        selectedAccount && isSavingsVaultAccount(selectedAccount, settings)
      ),
    [selectedAccount, settings]
  );

  // Learn if this expense matches a Savings Vault debit pattern from past expenses
  const learnedVaultDebit = useMemo(() => {
    if (!isOpen || !expense) return null;
    const otherExpenses = expenses.filter((e) => e.id !== expense.id);
    return learnSavingsVaultDebitAccount({
      recipient,
      description: notes,
      category,
      subcategory,
      expenses: otherExpenses,
      accounts,
      settings,
    });
  }, [isOpen, expense, recipient, notes, category, subcategory, expenses, accounts, settings]);

  const subcategoriesForCategory = useMemo(() => {
    const matched = categoryPreferences.find(
      (p) => p.name.trim().toLowerCase() === category.trim().toLowerCase()
    );
    const list = matched ? [...(matched.subcategories || [])] : [];
    if (
      subcategory.trim() &&
      !list.some((s) => s.toLowerCase() === subcategory.trim().toLowerCase())
    ) {
      list.push(subcategory.trim());
    }
    return list;
  }, [categoryPreferences, category, subcategory]);

  if (!isOpen || !expense) return null;

  const isDeductionDerived =
    expense.id.startsWith('exp_ded_') || expense.id.startsWith('inc_ded_exp_');

  const handleMoveSub = async () => {
    const cleanSub = subcategory.trim();
    const cleanTarget = moveTargetCategory.trim();
    if (!cleanSub || !cleanTarget || !onMoveSubcategory) return;
    setIsMovingSub(true);
    try {
      await onMoveSubcategory(cleanSub, category, cleanTarget);
      setCategory(cleanTarget);
      setShowMoveSubcategory(false);
    } finally {
      setIsMovingSub(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedAmt = roundTo2Decimals(parseFloat(amount));
    if (isNaN(parsedAmt) || parsedAmt <= 0) {
      setErrorMsg('Enter a valid amount greater than zero.');
      return;
    }

    const cleanCategory = category.trim() || 'Uncategorized';
    const cleanSub = subcategory.trim();
    const cleanRecipient = recipient.trim();
    const cleanNotes = notes.trim();

    const { convertedAmount, exchangeRate2dp } = convertCurrency2dp(
      parsedAmt,
      expCurrency,
      currency,
      fxSnapshot
    );

    const resolvedColor = cleanSub
      ? resolveIntuitiveSubcategoryColor(
          cleanSub,
          cleanCategory,
          settings,
          expenses
        )
      : expense.subcategoryColor;

    setIsSaving(true);
    try {
      await onSaveExpense({
        ...expense,
        date: date || expense.date,
        accountId: accountId || expense.accountId,
        recipient: cleanRecipient || cleanSub || cleanCategory,
        category: cleanCategory,
        subcategory: cleanSub || undefined,
        subcategoryColor: resolvedColor,
        currency: expCurrency.toUpperCase(),
        originalAmount: parsedAmt,
        exchangeRate: exchangeRate2dp,
        amount: convertedAmount,
        notes: cleanNotes || undefined,
        description:
          cleanNotes || cleanRecipient || cleanSub || cleanCategory || 'Expense',
        vaultAction: isSelectedAccountVault ? vaultAction : undefined,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to update expense transaction.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88dvh] sm:max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Modal Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3.5">
          <div className="min-w-0">
            <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 truncate">
              Edit Expense Transaction
            </h3>
            <p className="text-[11px] font-mono text-slate-500 truncate">
              Recorded: {formatDateTimeDDMMYYYY(expense.date, expense.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
          >
            Close
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          id="edit-expense-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5"
        >
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {errorMsg}
            </div>
          )}

          {isDeductionDerived && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
              Linked to an Income Deduction record. Saving updates the deduction on the parent income receipt.
            </div>
          )}

          {/* Learned Savings Vault Debit Suggestion Banner */}
          {learnedVaultDebit &&
            accountId !== learnedVaultDebit.vaultAccountId && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
                <div className="min-w-0">
                  <div className="font-bold truncate">
                    Suggested Vault Debit: {learnedVaultDebit.vaultAccountName}
                  </div>
                  <div className="text-[11px] opacity-85 truncate">
                    {learnedVaultDebit.reason}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAccountId(learnedVaultDebit.vaultAccountId);
                    setVaultAction('debit');
                    const vAcc = accounts.find(
                      (a) => a.id === learnedVaultDebit.vaultAccountId
                    );
                    if (vAcc) {
                      setExpCurrency(getAccountCurrency(vAcc, currency));
                    }
                  }}
                  className="rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-800 shrink-0"
                >
                  Apply Vault Debit
                </button>
              </div>
            )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <label className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Date</span>
                <span className="font-mono text-[11px] text-slate-500">
                  {formatDateDDMMYYYY(date)}
                </span>
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* Recipient / Cause ("To") */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                To (Recipient / Cause)
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="e.g. Vendor, Project, Utility"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const nextCat = e.target.value;
                  setCategory(nextCat);
                  const matchedPref = categoryPreferences.find(
                    (p) =>
                      p.name.trim().toLowerCase() ===
                      nextCat.trim().toLowerCase()
                  );
                  if (
                    matchedPref &&
                    matchedPref.subcategories.length > 0 &&
                    !matchedPref.subcategories.includes(subcategory)
                  ) {
                    setSubcategory(matchedPref.subcategories[0]);
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {categoryPreferences.map((pref) => (
                  <option key={pref.id} value={pref.name}>
                    {pref.name}
                  </option>
                ))}
                {category &&
                  !categoryPreferences.some(
                    (p) =>
                      p.name.trim().toLowerCase() ===
                      category.trim().toLowerCase()
                  ) && <option value={category}>{category}</option>}
              </select>
            </div>

            {/* Subcategory */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Subcategory
                </label>
                {subcategory && onMoveSubcategory && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoveSubcategory((prev) => !prev);
                      const otherCat =
                        categoryPreferences.find(
                          (p) =>
                            p.name.trim().toLowerCase() !==
                            category.trim().toLowerCase()
                        )?.name || '';
                      setMoveTargetCategory(otherCat);
                    }}
                    className="text-[11px] font-semibold text-slate-600 underline hover:text-slate-900"
                  >
                    {showMoveSubcategory ? 'Cancel Move' : 'Move to Category'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">None</option>
                  {subcategoriesForCategory.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Inline Move Subcategory to Another Category Box */}
          {showMoveSubcategory && subcategory && onMoveSubcategory && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-xs font-bold text-slate-800">
                Move &ldquo;{subcategory}&rdquo; from &ldquo;{category}&rdquo; to:
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={moveTargetCategory}
                  onChange={(e) => setMoveTargetCategory(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {categoryPreferences
                    .filter(
                      (p) =>
                        p.name.trim().toLowerCase() !==
                        category.trim().toLowerCase()
                    )
                    .map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!moveTargetCategory || isMovingSub}
                  onClick={handleMoveSub}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
                >
                  {isMovingSub ? 'Moving...' : 'Move Subcategory'}
                </button>
              </div>
            </div>
          )}

          {/* Account / Savings Vault Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account / Savings Vault
              </label>
              <select
                value={accountId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setAccountId(nextId);
                  const nextAcc = accounts.find((a) => a.id === nextId);
                  if (nextAcc) {
                    setExpCurrency(getAccountCurrency(nextAcc, currency));
                    if (isSavingsVaultAccount(nextAcc, settings)) {
                      setVaultAction('debit');
                    }
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <optgroup label="Operating Accounts">
                  {operatingAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({getAccountCurrency(acc, currency)})
                    </option>
                  ))}
                </optgroup>
                {savingsVaultAccounts.length > 0 && (
                  <optgroup label="Savings Vaults (Cause Debit / Return)">
                    {savingsVaultAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({getAccountCurrency(acc, currency)})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Amount & Currency */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount ({expCurrency})
              </label>
              <div className="flex items-center gap-1.5">
                <select
                  value={expCurrency}
                  onChange={(e) => setExpCurrency(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 font-mono text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none shrink-0"
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>
              {expCurrency.toUpperCase() !== currency.toUpperCase() &&
                parseFloat(amount) > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                    ≈{' '}
                    {formatAmount(
                      convertCurrency2dp(
                        parseFloat(amount) || 0,
                        expCurrency,
                        currency,
                        fxSnapshot
                      ).convertedAmount,
                      currency
                    )}{' '}
                    (Rate:{' '}
                    {format2PointFloat(
                      convertCurrency2dp(1, expCurrency, currency, fxSnapshot)
                        .exchangeRate2dp
                    )}
                    )
                  </div>
                )}
            </div>
          </div>

          {/* Vault Action Selector when a Savings Vault is selected */}
          {isSelectedAccountVault && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
              <div className="text-xs font-semibold text-slate-700">
                Savings Vault Operation
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVaultAction('debit')}
                  className={`rounded-lg py-1.5 px-2.5 text-xs font-bold transition-colors ${
                    vaultAction === 'debit'
                      ? 'bg-rose-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Debit Vault (Spend)
                </button>
                <button
                  type="button"
                  onClick={() => setVaultAction('credit')}
                  className={`rounded-lg py-1.5 px-2.5 text-xs font-bold transition-colors ${
                    vaultAction === 'credit'
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Credit Vault (Return)
                </button>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notes / Description
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Brief note..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </form>

        {/* Sticky Modal Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-expense-form"
            disabled={isSaving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
