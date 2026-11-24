import React, { useEffect, useMemo, useRef } from 'react';
import {
  ExpenseCategoryPreference,
  FinancialAccount,
} from '../types/finance.ts';
import {
  ProposedAlignedRecord,
  ReconciliationRecordType,
  ReconciliationRow,
} from '../lib/driveAlignment.ts';
import {
  convertCurrency2dp,
  getAccountCurrency,
  MarketFxSnapshot,
  roundTo2Decimals,
} from '../lib/currencyService.ts';
import { formatDateDDMMYYYY } from '../lib/dateFilters.ts';

interface ReconciliationTableProps {
  rows: ReconciliationRow[];
  accounts: FinancialAccount[];
  operatingAccounts: FinancialAccount[];
  categoryPrefs: ExpenseCategoryPreference[];
  baseCurrency: string;
  fxSnapshot?: MarketFxSnapshot | null;
  autoMapSubcategories: boolean;
  autoMappedCount: number;
  onToggleAutoMapSubcategories: (enabled: boolean) => void;
  expandedRowId: string | null;
  onToggleExpand: (rowId: string | null) => void;
  onToggleApprove: (rowId: string) => void;
  onToggleSelectAllVisible: (selectAll: boolean) => void;
  onUpdateProposed: (
    rowId: string,
    patch: Partial<ProposedAlignedRecord>
  ) => void;
  onRevertField: (
    rowId: string,
    field: keyof ProposedAlignedRecord
  ) => void;
}

const CURRENCIES = ['USD', 'GHS', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'CAD', 'AUD'];

export const ReconciliationTable: React.FC<ReconciliationTableProps> = ({
  rows,
  accounts,
  operatingAccounts,
  categoryPrefs,
  baseCurrency,
  fxSnapshot,
  autoMapSubcategories,
  autoMappedCount,
  onToggleAutoMapSubcategories,
  expandedRowId,
  onToggleExpand,
  onToggleApprove,
  onToggleSelectAllVisible,
  onUpdateProposed,
  onRevertField,
}) => {
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const accountById = useMemo(() => {
    const map = new Map<string, FinancialAccount>();
    for (const acc of accounts) map.set(acc.id, acc);
    return map;
  }, [accounts]);

  const categoryNames = useMemo(
    () => categoryPrefs.map((c) => c.name),
    [categoryPrefs]
  );

  const actionableRows = useMemo(
    () => rows.filter((r) => r.status !== 'matched'),
    [rows]
  );

  const approvedActionableCount = useMemo(
    () => actionableRows.filter((r) => r.approved).length,
    [actionableRows]
  );

  const allVisibleSelected =
    actionableRows.length > 0 &&
    approvedActionableCount === actionableRows.length;
  const someVisibleSelected =
    approvedActionableCount > 0 &&
    approvedActionableCount < actionableRows.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const formatRecordCategoryPath = (rec: ProposedAlignedRecord): string => {
    if (rec.recordType === 'expense') {
      const cat = rec.category || 'Uncategorized';
      return rec.subcategory ? `${cat} / ${rec.subcategory}` : cat;
    }
    if (rec.recordType === 'transfer') {
      const fromName = accountById.get(rec.accountId)?.name || 'Account';
      const toName = rec.toAccountId
        ? accountById.get(rec.toAccountId)?.name || 'Account'
        : 'Account';
      return `${fromName} → ${toName}`;
    }
    return 'Income';
  };

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Reconciliation Table Controls: Auto-map Subcategories */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={autoMapSubcategories}
            aria-label="Auto-map subcategories"
            onClick={() => onToggleAutoMapSubcategories(!autoMapSubcategories)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 ${
              autoMapSubcategories
                ? 'bg-emerald-600 dark:bg-emerald-500'
                : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                autoMapSubcategories ? 'translate-x-4.5' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            Auto-map subcategories
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-500 dark:text-slate-400">
            Matches subcategories to parent categories defined in Settings
          </span>
        </div>
        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {autoMapSubcategories
            ? autoMappedCount > 0
              ? `${autoMappedCount} ${autoMappedCount === 1 ? 'record' : 'records'} auto-mapped`
              : 'Active'
            : 'Off'}
        </div>
      </div>

      <div className="overflow-x-auto">
      <table className="min-w-[820px] w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          <tr>
            <th className="w-11 px-3 py-2.5">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                disabled={actionableRows.length === 0}
                onChange={(e) => onToggleSelectAllVisible(e.target.checked)}
                aria-label="Approve all visible records"
                title="Select or deselect all visible records"
                className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 accent-slate-900 dark:accent-slate-100 disabled:opacity-40"
              />
            </th>
            <th className="w-28 px-3 py-2.5 whitespace-nowrap">Status</th>
            <th className="px-3 py-2.5">Imported Record (Spreadsheet)</th>
            <th className="px-3 py-2.5 border-l border-slate-200/80 dark:border-slate-800">
              Existing App Record
            </th>
            <th className="w-24 px-3 py-2.5 text-right whitespace-nowrap">
              Action
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-950">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400"
              >
                No records match the current filter.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const isExpanded = expandedRowId === row.rowId;
              const p = row.proposed;
              const existing = row.existingSnapshot;

              const diffFieldSet = new Set(row.diffs.map((d) => d.field));
              const hasAmountDiff =
                diffFieldSet.has('amount') || diffFieldSet.has('currency');
              const hasDateDiff = diffFieldSet.has('date');
              const hasCategoryDiff =
                diffFieldSet.has('category') || diffFieldSet.has('subcategory');
              const hasAccountDiff =
                diffFieldSet.has('accountId') || diffFieldSet.has('toAccountId');
              const hasCounterpartyDiff = diffFieldSet.has('counterparty');
              const hasNotesDiff = diffFieldSet.has('notes');

              const acc = accountById.get(p.accountId);
              const existingAcc = existing
                ? accountById.get(existing.accountId)
                : undefined;

              const accCurr = getAccountCurrency(acc, baseCurrency);
              const showFx = p.currency.toUpperCase() !== accCurr.toUpperCase();
              const fxPreview = showFx
                ? convertCurrency2dp(p.amount, p.currency, accCurr, fxSnapshot)
                : null;

              const sameCurrencyVariance =
                existing &&
                hasAmountDiff &&
                existing.currency.toUpperCase() === p.currency.toUpperCase()
                  ? roundTo2Decimals(p.amount - existing.amount)
                  : null;

              const statusClass =
                row.status === 'difference'
                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
                  : row.status === 'missing'
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 font-medium';

              const statusLabel =
                row.status === 'difference'
                  ? 'Difference'
                  : row.status === 'missing'
                    ? 'Missing'
                    : 'Matched';

              const selectedCategoryPref = categoryPrefs.find(
                (c) =>
                  c.name.toLowerCase() === (p.category || '').toLowerCase()
              );

              const highlightImported =
                'rounded bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 text-amber-900 dark:text-amber-200 ring-1 ring-amber-200 dark:ring-amber-800/80';
              const highlightExisting =
                'rounded bg-slate-100 dark:bg-slate-800/90 px-1.5 py-0.5 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700';

              return (
                <React.Fragment key={row.rowId}>
                  <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors">
                    {/* Column 1: Individual Approval Checkbox */}
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={row.approved}
                        disabled={row.status === 'matched'}
                        onChange={() => onToggleApprove(row.rowId)}
                        aria-label={`Approve row ${row.rowIndex} (${p.counterparty || p.category})`}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600 accent-slate-900 dark:accent-slate-100 disabled:opacity-35"
                      />
                    </td>

                    {/* Column 2: Status & Record Type */}
                    <td className="px-3 py-3 align-top whitespace-nowrap">
                      <div className={statusClass}>{statusLabel}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                        {p.recordType}
                        {row.status === 'difference' && row.diffs.length > 0
                          ? ` · ${row.diffs.length} ${row.diffs.length === 1 ? 'diff' : 'diffs'}`
                          : ''}
                      </div>
                    </td>

                    {/* Column 3: Imported Spreadsheet Record */}
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[220px] ${
                                hasCounterpartyDiff ? highlightImported : ''
                              }`}
                            >
                              {p.counterparty || '—'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                              ·
                            </span>
                            <span
                              className={`font-mono tabular-nums text-[11px] ${
                                hasDateDiff
                                  ? `${highlightImported} font-semibold`
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {formatDateDDMMYYYY(p.date)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span
                              className={
                                hasCategoryDiff
                                  ? `${highlightImported} font-medium`
                                  : 'text-slate-700 dark:text-slate-300'
                              }
                            >
                              {formatRecordCategoryPath(p)}
                            </span>
                            {autoMapSubcategories &&
                              row.autoMappedCategory &&
                              p.recordType === 'expense' && (
                                <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                  · Auto-mapped
                                </span>
                              )}
                            {p.recordType !== 'transfer' && (
                              <>
                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                  ·
                                </span>
                                <span
                                  className={
                                    hasAccountDiff
                                      ? `${highlightImported} font-medium`
                                      : 'text-slate-500 dark:text-slate-400'
                                  }
                                >
                                  {acc?.name || 'Default Account'}
                                </span>
                              </>
                            )}
                          </div>

                          {p.notes && p.notes !== p.counterparty && (
                            <div
                              className={`text-[11px] truncate max-w-[300px] ${
                                hasNotesDiff
                                  ? highlightImported
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {p.notes}
                            </div>
                          )}
                        </div>

                        <div className="text-right shrink-0 font-mono tabular-nums">
                          <div
                            className={`font-semibold whitespace-nowrap ${
                              hasAmountDiff
                                ? highlightImported
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {p.currency} {roundTo2Decimals(p.amount).toFixed(2)}
                          </div>
                          {fxPreview && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              ≈ {accCurr} {fxPreview.convertedAmount.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Column 4: Existing App Record (Side-by-Side Comparison) */}
                    <td className="px-3 py-3 align-top border-l border-slate-200/80 dark:border-slate-800">
                      {existing ? (
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px] ${
                                    hasCounterpartyDiff ? highlightExisting : ''
                                  }`}
                                >
                                  {existing.counterparty || '—'}
                                </span>
                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                  ·
                                </span>
                                <span
                                  className={`font-mono tabular-nums text-[11px] ${
                                    hasDateDiff
                                      ? highlightExisting
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {formatDateDDMMYYYY(existing.date)}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span
                                  className={
                                    hasCategoryDiff
                                      ? highlightExisting
                                      : 'text-slate-600 dark:text-slate-400'
                                  }
                                >
                                  {formatRecordCategoryPath(existing)}
                                </span>
                                {existing.recordType !== 'transfer' && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                      ·
                                    </span>
                                    <span
                                      className={
                                        hasAccountDiff
                                          ? highlightExisting
                                          : 'text-slate-500 dark:text-slate-400'
                                      }
                                    >
                                      {existingAcc?.name || 'Default Account'}
                                    </span>
                                  </>
                                )}
                              </div>

                              {existing.notes &&
                                existing.notes !== existing.counterparty && (
                                  <div
                                    className={`text-[11px] truncate max-w-[260px] ${
                                      hasNotesDiff
                                        ? highlightExisting
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {existing.notes}
                                  </div>
                                )}
                            </div>

                            <div className="text-right shrink-0 font-mono tabular-nums">
                              <div
                                className={`font-medium whitespace-nowrap ${
                                  hasAmountDiff
                                    ? highlightExisting
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {existing.currency}{' '}
                                {roundTo2Decimals(existing.amount).toFixed(2)}
                              </div>
                              {sameCurrencyVariance !== null && (
                                <div className="mt-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                                  {sameCurrencyVariance > 0 ? '+' : ''}
                                  {sameCurrencyVariance.toFixed(2)} {p.currency}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Per-Field Quick Revert Controls for Highlighted Differences */}
                          {row.diffs.length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 dark:border-slate-800/80 pt-1.5 text-[11px]">
                              <span className="text-slate-500 dark:text-slate-400">
                                Keep app value:
                              </span>
                              {row.diffs.map((diff) => (
                                <button
                                  key={diff.field}
                                  type="button"
                                  onClick={() =>
                                    onRevertField(row.rowId, diff.field)
                                  }
                                  className="font-medium text-slate-700 dark:text-slate-300 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-2 hover:text-slate-950 dark:hover:text-white"
                                >
                                  {diff.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          No matching record in app · Will be added on approval
                        </div>
                      )}
                    </td>

                    {/* Column 5: Inline Adjust Toggle */}
                    <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          onToggleExpand(isExpanded ? null : row.rowId)
                        }
                        className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        {isExpanded ? 'Done' : 'Adjust'}
                      </button>
                    </td>
                  </tr>

                  {/* Inline Row Adjuster */}
                  {isExpanded && (
                    <tr className="bg-slate-50/90 dark:bg-slate-900/70">
                      <td colSpan={5} className="px-4 py-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Record Type
                            </label>
                            <select
                              value={p.recordType}
                              disabled={Boolean(row.matchedRecordId)}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  recordType: e.target
                                    .value as ReconciliationRecordType,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs disabled:opacity-50"
                            >
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                              <option value="transfer">Transfer</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Date ({formatDateDDMMYYYY(p.date)})
                            </label>
                            <input
                              type="date"
                              value={p.date}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  date: e.target.value,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono tabular-nums"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Amount
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={p.amount}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  amount: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono tabular-nums"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Currency
                            </label>
                            <select
                              value={p.currency}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  currency: e.target.value,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                            >
                              {Array.from(
                                new Set([...CURRENCIES, p.currency])
                              ).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              {p.recordType === 'transfer'
                                ? 'From Account'
                                : 'Account'}
                            </label>
                            <select
                              value={p.accountId}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  accountId: e.target.value,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                            >
                              {(p.recordType === 'income'
                                ? operatingAccounts.length > 0
                                  ? operatingAccounts
                                  : accounts
                                : accounts
                              ).map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name} ({getAccountCurrency(a, baseCurrency)})
                                </option>
                              ))}
                            </select>
                          </div>

                          {p.recordType === 'transfer' && (
                            <div className="space-y-1">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                To Account
                              </label>
                              <select
                                value={p.toAccountId || ''}
                                onChange={(e) =>
                                  onUpdateProposed(row.rowId, {
                                    toAccountId: e.target.value,
                                  })
                                }
                                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                              >
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name} ({getAccountCurrency(a, baseCurrency)})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {p.recordType === 'expense' && (
                            <>
                              <div className="space-y-1">
                                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                  Category
                                </label>
                                <select
                                  value={p.category}
                                  onChange={(e) =>
                                    onUpdateProposed(row.rowId, {
                                      category: e.target.value,
                                      subcategory: '',
                                    })
                                  }
                                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                                >
                                  {Array.from(
                                    new Set([...categoryNames, p.category])
                                  )
                                    .filter(Boolean)
                                    .map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                  Subcategory
                                </label>
                                <select
                                  value={p.subcategory || ''}
                                  onChange={(e) =>
                                    onUpdateProposed(row.rowId, {
                                      subcategory: e.target.value,
                                    })
                                  }
                                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                                >
                                  <option value="">None</option>
                                  {(selectedCategoryPref?.subcategories || []).map(
                                    (sub) => (
                                      <option key={sub} value={sub}>
                                        {sub}
                                      </option>
                                    )
                                  )}
                                  {p.subcategory &&
                                    !(
                                      selectedCategoryPref?.subcategories || []
                                    ).includes(p.subcategory) && (
                                      <option value={p.subcategory}>
                                        {p.subcategory}
                                      </option>
                                    )}
                                </select>
                              </div>
                            </>
                          )}

                          {p.recordType !== 'transfer' && (
                            <div className="space-y-1">
                              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                {p.recordType === 'income'
                                  ? 'Client / Source'
                                  : 'To / Cause'}
                              </label>
                              <input
                                type="text"
                                value={p.counterparty}
                                onChange={(e) =>
                                  onUpdateProposed(row.rowId, {
                                    counterparty: e.target.value,
                                  })
                                }
                                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                              />
                            </div>
                          )}

                          <div className="space-y-1 sm:col-span-2">
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Notes
                            </label>
                            <input
                              type="text"
                              value={p.notes}
                              onChange={(e) =>
                                onUpdateProposed(row.rowId, {
                                  notes: e.target.value,
                                })
                              }
                              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
};
