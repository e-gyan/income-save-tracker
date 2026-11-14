import React, { useState } from 'react';
import {
  FlexibleExpense,
  IncomeReceipt,
  AccountTransfer,
  FinancialAccount,
  UserSettings,
  ExpenseCategoryPreference,
} from '../types/finance.ts';
import {
  formatAmount,
  resolveIntuitiveSubcategoryColor,
  getSubcategoryBadgeStyle,
  getEffectiveIncomeDeductions,
  isSavingsDeduction,
  computeSavingsBreakdown,
  getEffectiveNetTransferAccountId,
  resolveValidAccountId,
  getIncomeNativeGross,
  isSavingsVaultAccount,
} from '../lib/calculations.ts';
import {
  convertCurrency2dp,
  getExchangeRate,
  format2PointFloat,
  getAccountCurrency,
  MarketFxSnapshot,
} from '../lib/currencyService.ts';
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
} from '../lib/dateFilters.ts';

export type RecordCardType = 'income' | 'expense' | 'transfer';

export interface RecordCardProps {
  /** Top-Left: Subcategory name (never notes/description, never doubled with category) */
  subcategory?: string;
  topLeftSubcategory?: string;
  /** Subcategory color hex used for the indicator dot/accent */
  subcategoryColor?: string;
  /** Bottom-Left: Account name (beneath Subcategory) */
  accountName?: string;
  bottomLeftAccount?: string;
  /** Top-Right: Formatted amount string */
  amountText?: string;
  topRightAmount?: string;
  /** Record type determines amount color: income=emerald, expense=red, transfer=blue */
  recordType: RecordCardType;
  /** Bottom-Right: Date string (rendered strictly as dd/mm/yyyy on the card face; time is shown in popup) */
  date?: string;
  bottomRightDate?: string;
  /** Click handler to open the Record Details Pop-Up Modal */
  onClick: () => void;
  /** Optional className override */
  className?: string;
}

/**
 * Unified 2x2 Record Card across the application:
 * - Top Left: Subcategory (with subcategory color dot)
 * - Bottom Left (beneath Subcategory): Account
 * - Top Right: Amount (Emerald for Income, Red for Expense, Blue for Transfer)
 * - Bottom Right (beneath Amount): Date only (dd/mm/yyyy; time is shown inside the pop-up modal)
 */
export const RecordCard: React.FC<RecordCardProps> = ({
  subcategory,
  topLeftSubcategory,
  subcategoryColor,
  accountName,
  bottomLeftAccount,
  amountText,
  topRightAmount,
  recordType,
  date,
  bottomRightDate,
  onClick,
  className = '',
}) => {
  const effectiveSubcategory = subcategory || topLeftSubcategory || 'Transaction';
  const effectiveAccountName = accountName || bottomLeftAccount || 'Account';
  const effectiveAmountText = amountText || topRightAmount || '0.00';
  const effectiveDate = date || bottomRightDate || '';
  const resolvedDotColor =
    subcategoryColor ||
    (recordType === 'income'
      ? '#059669'
      : recordType === 'transfer'
      ? '#2563eb'
      : '#e11d48');

  const amountColorClass =
    recordType === 'income'
      ? 'text-emerald-600'
      : recordType === 'transfer'
      ? 'text-blue-600'
      : 'text-rose-600';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group rounded-xl border border-slate-200/90 bg-white px-4 py-3 hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-slate-900/15 ${className}`}
    >
      {/* Top Row: Top-Left = Subcategory (with color dot), Top-Right = Colored Amount */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: resolvedDotColor }}
          />
          <span className="font-display text-sm font-bold text-slate-900 truncate">
            {effectiveSubcategory}
          </span>
        </div>

        <span
          className={`font-mono text-sm font-bold tabular-nums shrink-0 ${amountColorClass}`}
        >
          {effectiveAmountText}
        </span>
      </div>

      {/* Bottom Row: Bottom-Left = Account, Bottom-Right = Date (dd/mm/yyyy only) */}
      <div className="mt-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-500 truncate pl-4">
          {effectiveAccountName}
        </span>

        <span className="font-mono text-[11px] font-medium text-slate-400 tabular-nums shrink-0">
          {formatDateDDMMYYYY(effectiveDate)}
        </span>
      </div>
    </div>
  );
};

export interface ExpenseDetailPopupModalProps {
  expense: FlexibleExpense | null;
  accounts: FinancialAccount[];
  settings: UserSettings;
  expenses?: FlexibleExpense[];
  currency: string;
  fxSnapshot?: MarketFxSnapshot | null;
  categoryPreferences?: ExpenseCategoryPreference[];
  onClose: () => void;
  onEdit?: (expense: FlexibleExpense) => void;
  onEditExpense?: (expense: FlexibleExpense) => void;
  onDelete?: (expense: FlexibleExpense) => void;
  onDeleteExpense?: (id: string) => void | Promise<void>;
  onMoveSubcategory?: (
    subcategory: string,
    fromCategory: string,
    toCategory: string
  ) => Promise<void> | void;
  onCreditVaultInstance?: (expense: FlexibleExpense) => void;
}

export const ExpenseDetailPopupModal: React.FC<ExpenseDetailPopupModalProps> = ({
  expense,
  accounts,
  settings,
  expenses = [],
  currency,
  fxSnapshot,
  categoryPreferences = [],
  onClose,
  onEdit,
  onEditExpense,
  onDelete,
  onDeleteExpense,
  onMoveSubcategory,
  onCreditVaultInstance,
}) => {
  const effectiveOnEdit = onEdit || onEditExpense;
  const effectiveOnDelete =
    onDelete ||
    (onDeleteExpense ? (exp: FlexibleExpense) => onDeleteExpense(exp.id) : undefined);
  const [moveTargetCategory, setMoveTargetCategory] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!expense) return null;

  const isDeductionDerived =
    expense.id.startsWith('exp_ded_') || expense.id.startsWith('exp_cut_');
  const defaultAccount =
    accounts.find((a) => a.isDefaultDeposit) || accounts[0];
  const matchedAccount =
    accounts.find((a) => a.id === expense.accountId) || defaultAccount;
  const expCurr = (
    expense.currency || getAccountCurrency(matchedAccount, currency)
  ).toUpperCase();
  const expNativeAmt =
    expense.originalAmount !== undefined && expense.originalAmount > 0
      ? expense.originalAmount
      : expense.amount;

  const subLabel = expense.subcategory || expense.category || 'Expense';
  const subColor = resolveIntuitiveSubcategoryColor(
    expense.subcategory,
    expense.category,
    settings,
    expenses
  );
  const subBadge = getSubcategoryBadgeStyle(subColor);

  const isVault = matchedAccount
    ? isSavingsVaultAccount(matchedAccount, settings)
    : false;
  const isCredit = expense.vaultAction === 'credit';
  const isAlreadyCredited =
    !isCredit &&
    expenses.some(
      (e) => e.vaultAction === 'credit' && e.linkedExpenseId === expense.id
    );

  // Clean notes/description so it doesn't just repeat subcategory
  const rawNote = (expense.notes || '').trim();
  const rawDesc = (expense.description || '').trim();
  const displayNotes =
    rawNote ||
    (rawDesc &&
    rawDesc.toLowerCase() !== subLabel.toLowerCase() &&
    rawDesc.toLowerCase() !== (expense.recipient || '').trim().toLowerCase()
      ? rawDesc
      : '');

  const availableTargetCategories = categoryPreferences.filter(
    (p) => p.name !== expense.category
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                style={{
                  color: subBadge.color,
                  backgroundColor: subBadge.backgroundColor,
                  borderColor: subBadge.borderColor,
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: subColor }}
                />
                {subLabel}
              </span>
              <span className="rounded-md bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                {isDeductionDerived
                  ? 'Income Deduction Expense'
                  : isVault
                  ? isCredit
                    ? 'Vault Credit'
                    : 'Vault Debit'
                  : 'Expense'}
              </span>
            </div>
            <p className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {formatDateTimeDDMMYYYY(expense.date, expense.createdAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
          >
            Close
          </button>
        </div>

        {/* Amount Banner */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-600">Amount</span>
          <div className="text-right font-mono tabular-nums">
            <div className="text-base font-bold text-rose-600">
              {isCredit ? '+' : '-'}
              {formatAmount(expNativeAmt, expCurr)}
            </div>
            {expCurr !== currency && (
              <div className="text-[11px] text-slate-400">
                ≈ {formatAmount(expense.amount, currency)} @{' '}
                {format2PointFloat(
                  expense.exchangeRate ||
                    getExchangeRate(expCurr, currency, fxSnapshot).rate2dp
                )}
              </div>
            )}
          </div>
        </div>

        {/* Record Details List */}
        <div className="rounded-xl border border-slate-200/80 divide-y divide-slate-100 text-xs">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Subcategory</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: subColor }}
              />
              {subLabel}
            </span>
          </div>

          {expense.category && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="text-slate-500">Category</span>
              <span className="font-semibold text-slate-900">
                {expense.category}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Account</span>
            <span className="font-semibold text-slate-900">
              {matchedAccount?.name || 'Account'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Date & Time</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {formatDateTimeDDMMYYYY(expense.date, expense.createdAt)}
            </span>
          </div>

          {expense.recipient && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="text-slate-500">To / Recipient</span>
              <span className="font-semibold text-slate-900 text-right break-words">
                {expense.recipient}
              </span>
            </div>
          )}

          {displayNotes && (
            <div className="px-3.5 py-2.5 space-y-1">
              <span className="block text-slate-500">Notes</span>
              <p className="text-slate-800 font-medium break-words">
                {displayNotes}
              </p>
            </div>
          )}
        </div>

        {/* Optional Move Subcategory to Another Category */}
        {onMoveSubcategory &&
          expense.subcategory &&
          availableTargetCategories.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <span className="block text-[11px] font-semibold text-slate-600">
                Move &ldquo;{expense.subcategory}&rdquo; to Another Category
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={
                    moveTargetCategory ||
                    availableTargetCategories[0]?.name ||
                    ''
                  }
                  onChange={(e) => setMoveTargetCategory(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
                >
                  {availableTargetCategories.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const target =
                      moveTargetCategory ||
                      availableTargetCategories[0]?.name ||
                      '';
                    if (target && expense.subcategory) {
                      await onMoveSubcategory(
                        expense.subcategory,
                        expense.category,
                        target
                      );
                      onClose();
                    }
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shrink-0"
                >
                  Move
                </button>
              </div>
            </div>
          )}

        {/* Action Footer: Edit & Delete */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div>
            {isVault &&
              !isCredit &&
              !isDeductionDerived &&
              !isAlreadyCredited &&
              onCreditVaultInstance && (
                <button
                  type="button"
                  onClick={() => {
                    const target = expense;
                    onClose();
                    onCreditVaultInstance(target);
                  }}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  Credit Instance
                </button>
              )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs">
                <span className="font-semibold text-rose-800">
                  Delete this expense transaction? Account balances will update.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const target = expense;
                    setConfirmingDelete(false);
                    onClose();
                    effectiveOnDelete?.(target);
                  }}
                  className="rounded-md bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-700"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {effectiveOnEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = expense;
                      onClose();
                      effectiveOnEdit(target);
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Edit
                  </button>
                )}
                {effectiveOnDelete && !isDeductionDerived && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface TransferDetailPopupModalProps {
  transfer: AccountTransfer | null;
  accounts: FinancialAccount[];
  currency: string;
  onClose: () => void;
  onRevertOrDelete?: (transfer: AccountTransfer) => void;
  onDeleteTransfer?: (id: string) => void | Promise<void>;
  revertLabel?: string;
}

export const TransferDetailPopupModal: React.FC<
  TransferDetailPopupModalProps
> = ({
  transfer,
  accounts,
  currency,
  onClose,
  onRevertOrDelete,
  onDeleteTransfer,
  revertLabel = 'Delete / Revert',
}) => {
  const effectiveOnRevertOrDelete =
    onRevertOrDelete ||
    (onDeleteTransfer ? (tr: AccountTransfer) => onDeleteTransfer(tr.id) : undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  if (!transfer) return null;

  const sourceAcc = accounts.find((a) => a.id === transfer.sourceAccountId);
  const destAcc = accounts.find((a) => a.id === transfer.destinationAccountId);
  const isSavingsSplit =
    transfer.transferType === 'savings_deduction' ||
    transfer.id.startsWith('trans_sav_');
  const isNetTransfer = transfer.id.startsWith('trans_net_');

  const transferTitle = isSavingsSplit
    ? 'Savings Allocation'
    : isNetTransfer
    ? 'Net Income Transfer'
    : 'Fund Transfer';

  const dispCurr = (
    transfer.destinationCurrency ||
    transfer.sourceCurrency ||
    currency
  ).toUpperCase();
  const dispAmt =
    transfer.destinationAmount ?? transfer.sourceAmount ?? transfer.amount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                {transferTitle}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                Transfer
              </span>
            </div>
            <p className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {formatDateTimeDDMMYYYY(transfer.date, transfer.createdAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
          >
            Close
          </button>
        </div>

        {/* Amount Banner */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-600">Amount</span>
          <div className="text-right font-mono tabular-nums">
            <div className="text-base font-bold text-blue-600">
              {formatAmount(dispAmt, dispCurr)}
            </div>
            {dispCurr !== currency && (
              <div className="text-[11px] text-slate-400">
                ≈ {formatAmount(transfer.amount, currency)}
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="rounded-xl border border-slate-200/80 divide-y divide-slate-100 text-xs">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">From Account</span>
            <span className="font-semibold text-slate-900">
              {sourceAcc?.name || 'Source Account'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">To Account</span>
            <span className="font-semibold text-slate-900">
              {destAcc?.name || 'Destination Account'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Date & Time</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {formatDateTimeDDMMYYYY(transfer.date, transfer.createdAt)}
            </span>
          </div>

          {transfer.description && (
            <div className="px-3.5 py-2.5 space-y-1">
              <span className="block text-slate-500">Details / Note</span>
              <p className="text-slate-800 font-medium break-words">
                {transfer.description}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs">
              <span className="font-semibold text-rose-800">
                {revertLabel} this transfer transaction? Account balances will update.
              </span>
              <button
                type="button"
                onClick={() => {
                  const target = transfer;
                  setConfirmingDelete(false);
                  onClose();
                  effectiveOnRevertOrDelete?.(target);
                }}
                className="rounded-md bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-700"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {effectiveOnRevertOrDelete && !isSavingsSplit && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  {revertLabel}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export interface IncomeDetailPopupModalProps {
  income: IncomeReceipt | null;
  accounts: FinancialAccount[];
  settings: UserSettings;
  expenses?: FlexibleExpense[];
  currency: string;
  fxSnapshot?: MarketFxSnapshot | null;
  onClose: () => void;
  onEdit?: (income: IncomeReceipt) => void;
  onDelete?: (income: IncomeReceipt) => void;
  /** Optional custom children (e.g., interactive deduction & net transfer controls in IncomeLogView) */
  children?: React.ReactNode;
}

export const IncomeDetailPopupModal: React.FC<IncomeDetailPopupModalProps> = ({
  income,
  accounts,
  settings,
  expenses = [],
  currency,
  fxSnapshot,
  onClose,
  onEdit,
  onDelete,
  children,
}) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  if (!income) return null;

  const defaultAccount =
    accounts.find((a) => a.isDefaultDeposit) || accounts[0];
  const resolvedSourceAccId = resolveValidAccountId(
    income.accountId,
    accounts,
    settings
  );
  const targetAccount =
    accounts.find((a) => a.id === resolvedSourceAccId) || defaultAccount;
  const effectiveNetDestId = getEffectiveNetTransferAccountId(
    income,
    settings,
    accounts
  );
  const netDestAccount = effectiveNetDestId
    ? accounts.find((a) => a.id === effectiveNetDestId)
    : undefined;

  const { nativeGross: incNativeGross, currency: incRecordCurr } =
    getIncomeNativeGross(income, settings, accounts);
  const itemDeductions = getEffectiveIncomeDeductions(
    income,
    settings,
    expenses
  );
  const totalDed =
    Math.round(itemDeductions.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const netRetained = Math.round((incNativeGross - totalDed) * 100) / 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-600 shrink-0" />
                {income.clientOrSource || 'Income'}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                Income
              </span>
            </div>
            <p className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {formatDateTimeDDMMYYYY(income.date, income.createdAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 shrink-0"
          >
            Close
          </button>
        </div>

        {/* Amount Summary */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-600">Total Income</span>
            <span className="font-mono text-base font-bold text-emerald-600 tabular-nums">
              +{formatAmount(incNativeGross, incRecordCurr)}
            </span>
          </div>
          {incRecordCurr !== currency && (
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Converted ({currency})</span>
              <span className="font-mono tabular-nums">
                {formatAmount(
                  convertCurrency2dp(
                    incNativeGross,
                    incRecordCurr,
                    currency,
                    fxSnapshot
                  ).convertedAmount,
                  currency
                )}{' '}
                @{' '}
                {format2PointFloat(
                  getExchangeRate(incRecordCurr, currency, fxSnapshot).rate2dp
                )}
              </span>
            </div>
          )}
          {totalDed > 0 && (
            <div className="flex items-center justify-between text-rose-600">
              <span>Total Deductions</span>
              <span className="font-mono font-semibold tabular-nums">
                -{formatAmount(totalDed, incRecordCurr)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/70 font-semibold text-slate-900">
            <span>Net Retained</span>
            <span
              className={`font-mono tabular-nums ${
                netRetained < 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {formatAmount(netRetained, incRecordCurr)}
            </span>
          </div>
        </div>

        {/* Metadata */}
        <div className="rounded-xl border border-slate-200/80 divide-y divide-slate-100 text-xs">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Income Source</span>
            <span className="font-semibold text-slate-900">
              {income.clientOrSource || 'Income'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Account</span>
            <span className="font-semibold text-slate-900">
              {netDestAccount
                ? `${targetAccount?.name || 'Account'} → Net to ${netDestAccount.name}`
                : targetAccount?.name || 'Account'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="text-slate-500">Date & Time</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {formatDateTimeDDMMYYYY(income.date, income.createdAt)}
            </span>
          </div>

          {income.notes && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="text-slate-500">Source / Notes</span>
              <span className="font-semibold text-slate-900 text-right break-words">
                {income.notes}
              </span>
            </div>
          )}
        </div>

        {/* Interactive children (if passed by IncomeLogView) or read-only deductions summary */}
        {children ? (
          children
        ) : itemDeductions.length > 0 ? (
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700">
              Defined Deductions ({itemDeductions.length})
            </span>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-slate-50/50 text-xs">
              {itemDeductions.map((ded) => {
                const isSav = isSavingsDeduction(ded);
                const savingsShares = isSav
                  ? computeSavingsBreakdown(ded.amount, accounts, settings)
                  : [];
                const subLabel =
                  ded.expenseSubcategory || ded.expenseCategory || 'General';
                const subColor = resolveIntuitiveSubcategoryColor(
                  ded.expenseSubcategory,
                  ded.expenseCategory,
                  settings,
                  expenses
                );
                const badgeStyle = getSubcategoryBadgeStyle(subColor);

                return (
                  <div key={ded.id} className="px-3.5 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">
                          {ded.name}
                        </span>
                        {!isSav && (
                          <span
                            style={badgeStyle}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: subColor }}
                            />
                            {subLabel}
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          isSav ? 'text-blue-600' : 'text-rose-600'
                        }`}
                      >
                        -{formatAmount(ded.amount, incRecordCurr)}
                      </span>
                    </div>
                    {isSav && savingsShares.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500">
                        {savingsShares.map((s) => (
                          <div
                            key={s.bucketId}
                            className="flex items-center justify-between"
                          >
                            <span className="truncate pr-1">
                              {s.percentage}% → {s.accountName}
                            </span>
                            <span className="font-mono text-blue-600 font-medium tabular-nums">
                              +{formatAmount(s.amount, incRecordCurr)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Action Footer: Edit & Delete */}
        {(onEdit || onDelete) && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs">
                <span className="font-semibold text-rose-800">
                  Delete this income transaction? Linked deductions and balances will update.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const target = income;
                    setConfirmingDelete(false);
                    onClose();
                    onDelete?.(target);
                  }}
                  className="rounded-md bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-700"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = income;
                      onClose();
                      onEdit(target);
                    }}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Edit
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
