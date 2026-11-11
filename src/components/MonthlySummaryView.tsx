import React from 'react';
import { UserSettings, IncomeReceipt, FlexibleExpense } from '../types/finance.ts';
import { calculateMonthlySummary, formatAmount, formatPercent } from '../lib/calculations.ts';

interface MonthlySummaryViewProps {
  incomes: IncomeReceipt[];
  settings: UserSettings;
  expenses: FlexibleExpense[];
  currency: string;
}

export const MonthlySummaryView: React.FC<MonthlySummaryViewProps> = ({
  incomes,
  settings,
  expenses,
  currency,
}) => {
  const summary = calculateMonthlySummary(incomes, settings, expenses);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
          Monthly Summary
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Historical monthly accounting aggregates: Total Income minus Mandatory Cuts minus Savings equals Available after cuts and savings, less Flexible Expenses.
        </p>
      </div>

      {/* Aggregate Scorecard */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Total Receipts Recorded</span>
          <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
            {incomes.length}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-sans">
            Across {summary.monthlyBreakdown.length} active month(s)
          </span>
        </div>

        <div className="rounded border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Total Income</span>
          <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
            {formatAmount(summary.cumulativeGross, currency)}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-sans">
            Cumulative earned
          </span>
        </div>

        <div className="rounded border border-sky-200 bg-sky-50/50 p-4">
          <span className="text-xs text-sky-800 block">Savings Deducted</span>
          <span className="text-xl font-bold font-mono text-sky-950 tabular-nums">
            {formatAmount(summary.cumulativeQuarterSavingsAllocated, currency)}
          </span>
          <span className="text-[11px] text-sky-700 block mt-1 font-sans">
            Rate: {formatPercent(summary.totalSavingsRate)}
          </span>
        </div>

        <div className="rounded border border-amber-200 bg-amber-50/50 p-4">
          <span className="text-xs text-amber-800 block">Total Deductions</span>
          <span className="text-xl font-bold font-mono text-amber-950 tabular-nums">
            {formatAmount(summary.cumulativeTotalDeductions, currency)}
          </span>
          <span className="text-[11px] text-amber-700 block mt-1 font-sans">
            Mandatory cuts + savings
          </span>
        </div>

        <div className="rounded border border-emerald-200 bg-emerald-50/50 p-4">
          <span className="text-xs text-emerald-800 block">Available After All Deductions</span>
          <span className="text-xl font-bold font-mono text-emerald-950 tabular-nums">
            {formatAmount(summary.cumulativeAvailableAfterCutsAndSavings, currency)}
          </span>
          <span className="text-[11px] text-emerald-700 block mt-1 font-sans">
            Gross minus all deductions
          </span>
        </div>

        <div className="rounded border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500 block">Net Disposable Remaining</span>
          <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
            {formatAmount(summary.cumulativeRemainingDisposable, currency)}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-sans">
            After flexible expenses
          </span>
        </div>
      </div>

      {/* Quarterly Aggregates Table */}
      <div className="rounded border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Quarterly Performance Summary
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-600 font-sans font-semibold">
              <tr>
                <th className="py-2.5 px-3">Quarter</th>
                <th className="py-2.5 px-3 text-center">Target Rate</th>
                <th className="py-2.5 px-3 text-right">Total Income</th>
                <th className="py-2.5 px-3 text-right">Mandatory Cuts</th>
                <th className="py-2.5 px-3 text-right text-sky-950 bg-sky-50/30">Savings Deducted</th>
                <th className="py-2.5 px-3 text-right text-amber-950 bg-amber-50/30">Total Deductions</th>
                <th className="py-2.5 px-3 text-right text-emerald-900 bg-emerald-50/30 font-bold">Available Balance</th>
                <th className="py-2.5 px-3 text-right">Flexible Expenses</th>
                <th className="py-2.5 px-3 text-right font-semibold">Effective Savings Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.quarterlyAggregates.map((q) => {
                const qTotalDeductions = q.mandatoryCuts + q.savingsAllocated;
                const qAvailable = q.gross - qTotalDeductions;
                return (
                  <tr key={q.quarter} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-sans font-bold text-slate-900">{q.quarter}</td>
                    <td className="py-2.5 px-3 text-center text-slate-600">{q.targetRate}%</td>
                    <td className="py-2.5 px-3 text-right text-slate-900 tabular-nums">{formatAmount(q.gross, currency)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">{formatAmount(q.mandatoryCuts, currency)}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-sky-950 bg-sky-50/20 tabular-nums">
                      {formatAmount(q.savingsAllocated, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-amber-950 bg-amber-50/20 tabular-nums">
                      {formatAmount(qTotalDeductions, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-950 bg-emerald-50/20 tabular-nums">
                      {formatAmount(qAvailable, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-amber-800 tabular-nums">{formatAmount(q.flexibleExpenses, currency)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-800 tabular-nums">
                      {formatPercent(q.effectiveSavingsRate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="rounded border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Monthly Performance Ledger
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            {summary.monthlyBreakdown.length} active month(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-600 font-sans font-semibold">
              <tr>
                <th className="py-2.5 px-3">Month</th>
                <th className="py-2.5 px-3 text-center">Receipts</th>
                <th className="py-2.5 px-3 text-right">Total Income</th>
                <th className="py-2.5 px-3 text-right">Mandatory Cuts</th>
                <th className="py-2.5 px-3 text-right text-sky-950 bg-sky-50/30">Savings Deducted</th>
                <th className="py-2.5 px-3 text-right text-amber-950 bg-amber-50/30">Total Deductions</th>
                <th className="py-2.5 px-3 text-right bg-emerald-50/40 text-emerald-900 font-bold">
                  Available After Deductions
                </th>
                <th className="py-2.5 px-3 text-right">Flexible Expenses</th>
                <th className="py-2.5 px-3 text-right">Effective Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.monthlyBreakdown.map((row) => {
                const monthSavingsRate =
                  row.grossTotal > 0 ? (row.savingsAllocatedTotal / row.grossTotal) * 100 : 0;
                const totalMonthDeductions = row.deductionsTotal + row.savingsAllocatedTotal;
                const availableAfterDeductions = row.grossTotal - totalMonthDeductions;

                return (
                  <tr key={row.monthKey} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 whitespace-nowrap">
                      {row.monthKey}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-600">
                      {row.receiptCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium text-slate-900 tabular-nums">
                      {formatAmount(row.grossTotal, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                      {formatAmount(row.deductionsTotal, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-sky-950 bg-sky-50/20 tabular-nums">
                      {formatAmount(row.savingsAllocatedTotal, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-amber-950 bg-amber-50/20 tabular-nums">
                      {formatAmount(totalMonthDeductions, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-950 bg-emerald-50/30 tabular-nums">
                      {formatAmount(availableAfterDeductions, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-amber-800 tabular-nums">
                      {formatAmount(row.flexibleExpensesTotal, currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-800 tabular-nums">
                      {formatPercent(monthSavingsRate)}
                    </td>
                  </tr>
                );
              })}
              {summary.monthlyBreakdown.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-xs font-sans text-slate-400">
                    No monthly records available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
