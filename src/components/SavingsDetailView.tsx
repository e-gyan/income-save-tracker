import React from 'react';
import { UserSettings, IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer } from '../types/finance.ts';
import {
  calculateAllocation,
  calculateAccountSummaries,
  formatAmount,
  DEFAULT_SAVINGS_BUCKETS,
} from '../lib/calculations.ts';

interface SavingsDetailViewProps {
  incomes: IncomeReceipt[];
  settings: UserSettings;
  expenses: FlexibleExpense[];
  currency: string;
  accounts?: FinancialAccount[];
  transfers?: AccountTransfer[];
}

export const SavingsDetailView: React.FC<SavingsDetailViewProps> = ({
  incomes,
  settings,
  expenses,
  currency,
  accounts = [],
  transfers = [],
}) => {
  const activeBuckets = settings.savingsBuckets && settings.savingsBuckets.length > 0
    ? settings.savingsBuckets
    : DEFAULT_SAVINGS_BUCKETS;

  // Calculate allocation for each income receipt using configured settings
  const allocations = incomes.map((inc) => calculateAllocation(inc, settings, expenses));

  // Cumulative total of all quarterly savings deducted across receipts
  const totalSavingsDeducted = allocations.reduce((sum, a) => sum + a.quarterSavingsAllocated, 0);

  // Compute live account cash summaries for vault reconciliation
  const accountSummaries = accounts.length > 0
    ? calculateAccountSummaries(accounts, incomes, expenses, settings, transfers).summaries
    : [];

  // Dynamic accumulator for all configured savings buckets and their sub-buckets
  const bucketTotals: Record<
    string,
    {
      id: string;
      name: string;
      percentage: number;
      description: string;
      totalSaved: number;
      subBuckets: { id: string; name: string; percentage: number; amount: number; isDirectOfTotalSavings?: boolean }[];
    }
  > = {};

  for (const bucket of activeBuckets) {
    bucketTotals[bucket.id] = {
      id: bucket.id,
      name: bucket.name,
      percentage: bucket.percentage,
      description: bucket.description || '',
      totalSaved: 0,
      subBuckets: (bucket.subBuckets || []).map((s) => ({
        id: s.id,
        name: s.name,
        percentage: s.percentageOfParent,
        amount: 0,
        isDirectOfTotalSavings:
          bucket.name.toLowerCase().includes('seeds') ||
          bucket.name.toLowerCase().includes('give to others') ||
          bucket.id === 'bucket-15-seeds' ||
          bucket.id === 'bucket-5-give',
      })),
    };
  }

  for (const alloc of allocations) {
    for (const item of alloc.savingsDistribution) {
      if (bucketTotals[item.bucketId]) {
        bucketTotals[item.bucketId].totalSaved += item.amount;

        for (const sub of item.subBucketBreakdown) {
          const matchSub = bucketTotals[item.bucketId].subBuckets.find(
            (s) => s.name === sub.subBucketName
          );
          if (matchSub) {
            matchSub.amount += sub.amount;
          }
        }
      }
    }
  }

  const bucketsList = Object.values(bucketTotals);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
          Savings Detail
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          Review the savings distribution structure and its underlying sub-buckets. All values are calculated from the savings deducted per the quarterly rate on each income receipt.
        </p>
      </div>

      {/* Aggregate Savings Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold block">
              Total Cumulative Net Savings Deducted
            </span>
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 tabular-nums">
              {formatAmount(totalSavingsDeducted, currency)}
            </span>
          </div>
          <div className="text-xs text-slate-600 font-mono bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
            {incomes.length} receipts · {activeBuckets.length} Governed Savings Pillars
          </div>
        </div>
      </div>

      {/* Dynamic Savings Pillars Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bucketsList.map((pillar) => {
          const pillarShareOfTotal =
            totalSavingsDeducted > 0 ? (pillar.totalSaved / totalSavingsDeducted) * 100 : 0;

          return (
            <div key={pillar.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {pillar.name}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-sky-900 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md">
                        {pillar.percentage}% Target
                      </span>
                    </div>
                    {pillar.description && (
                      <p className="text-xs text-slate-500 mt-1">
                        {pillar.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-base font-bold font-mono text-slate-900 tabular-nums block">
                      {formatAmount(pillar.totalSaved, currency)}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {pillarShareOfTotal.toFixed(1)}% of total
                    </span>
                  </div>
                </div>

                {/* Visual Progress Bar */}
                <div className="mt-3.5 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-900 transition-all duration-300"
                    style={{ width: `${Math.min(100, pillarShareOfTotal)}%` }}
                  />
                </div>
              </div>

              {/* Sub-Buckets Breakdown */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block mb-2">
                  Sub-Buckets
                </span>
                <div className="space-y-1.5">
                  {pillar.subBuckets.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-50/80 border border-slate-100"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-800 font-medium">{sub.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({sub.percentage}%{sub.isDirectOfTotalSavings ? '' : ''})
                        </span>
                      </div>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {formatAmount(sub.amount, currency)}
                      </span>
                    </div>
                  ))}
                  {pillar.subBuckets.length === 0 && (
                    <span className="text-[11px] text-slate-400 italic">
                      Direct single allocation vault (100%).
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Vault Cash Reconciliation and Funding Status */}
      {accounts.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Pillar Target vs. Vault Cash Reconciliation
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Compares the cumulative savings allocation mandated by your quarterly rate against physical cash sitting in each dedicated vault account.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded self-start sm:self-auto">
              {accounts.length} Accounts Monitored
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-mono">
              <thead className="bg-slate-50 text-slate-700 font-sans font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Savings Pillar</th>
                  <th className="py-2.5 px-3">Target Rate</th>
                  <th className="py-2.5 px-3 text-right">Mandated Target</th>
                  <th className="py-2.5 px-3">Matching Vault Account</th>
                  <th className="py-2.5 px-3 text-right">Actual Vault Cash</th>
                  <th className="py-2.5 px-3 text-right">Pending / Variance</th>
                  <th className="py-2.5 px-3 font-sans">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {bucketsList.map((pillar) => {
                  const matchingAcc = accounts.find(
                    (a) =>
                      a.id === pillar.id ||
                      a.id.replace('acc-', 'bucket-') === pillar.id ||
                      pillar.id.replace('bucket-', 'acc-') === a.id ||
                      a.name.toLowerCase().includes(pillar.name.toLowerCase()) ||
                      pillar.name.toLowerCase().includes(a.name.toLowerCase())
                  );
                  const accSummary = accountSummaries.find((s) => s.account.id === matchingAcc?.id);
                  const vaultCash = accSummary ? accSummary.currentCashBalance : 0;
                  const variance = vaultCash - pillar.totalSaved;
                  const isFullyFunded = variance >= 0;

                  return (
                    <tr key={pillar.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 font-sans">{pillar.name}</td>
                      <td className="py-2.5 px-3 text-slate-600">{pillar.percentage}%</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatAmount(pillar.totalSaved, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-sans">
                        {matchingAcc ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: matchingAcc.color || '#0284c7' }} />
                            <span>{matchingAcc.name}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No direct vault linked</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-800">
                        {formatAmount(vaultCash, currency)}
                      </td>
                      <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${isFullyFunded ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {isFullyFunded ? `+${formatAmount(variance, currency)}` : formatAmount(variance, currency)}
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        {pillar.totalSaved === 0 ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-600">
                            ZERO ALLOCATED
                          </span>
                        ) : isFullyFunded ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                            FULLY FUNDED
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-900 border border-amber-200">
                            PENDING TRANSFER
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50/70 border-t border-slate-200 text-[11px] text-slate-500 font-sans flex items-center justify-between">
            <span>
              Note: When income arrives in the Operating Account, dedicated vault cash remains unchanged until a transfer is executed in the Deduction Transfer Hub.
            </span>
          </div>
        </div>
      )}

      {/* Per-Receipt Savings Distribution Audit Component */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Savings Distribution
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Exact mathematical breakdown of savings deducted from each income receipt distributed to each saving name.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded">
            {allocations.length} records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-700 font-semibold">
              <tr>
                <th className="py-2.5 px-3 whitespace-nowrap">Receipt/Client and Date</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Total Income</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Savings Rate</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap bg-sky-50 text-sky-950 font-bold">
                  Deduction for Savings
                </th>
                {activeBuckets.map((bucket) => (
                  <th key={bucket.id} className="py-2.5 px-3 text-right whitespace-nowrap">
                    {bucket.name} <span className="font-mono text-[10px] text-slate-500 font-normal">({bucket.percentage}%)</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {allocations.map((alloc) => {
                return (
                  <tr key={alloc.receiptId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-sans font-semibold text-slate-900 block">
                        {alloc.clientOrSource}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {alloc.date}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                      {formatAmount(alloc.grossAmount, currency)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                      {alloc.quarterlySavingsRate}%
                    </td>
                    <td className="py-2 px-3 text-right font-extrabold text-sky-950 bg-sky-50/50 tabular-nums whitespace-nowrap">
                      {formatAmount(alloc.quarterSavingsAllocated, currency)}
                    </td>
                    {activeBuckets.map((bucket) => {
                      const distItem = alloc.savingsDistribution.find((d) => d.bucketId === bucket.id);
                      const amount = distItem ? distItem.amount : (alloc.quarterSavingsAllocated * (bucket.percentage / 100));
                      return (
                        <td key={bucket.id} className="py-2 px-3 text-right text-slate-800 tabular-nums whitespace-nowrap">
                          {formatAmount(amount, currency)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {allocations.length === 0 && (
                <tr>
                  <td colSpan={4 + activeBuckets.length} className="py-8 text-center text-xs text-slate-400 font-sans">
                    No income receipts logged yet. Record an income receipt to audit its savings distribution.
                  </td>
                </tr>
              )}
            </tbody>
            {allocations.length > 0 && (
              <tfoot className="bg-slate-100/80 font-mono font-bold text-slate-900 border-t-2 border-slate-300">
                <tr>
                  <td className="py-2.5 px-3 font-sans">Total Cumulative</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {formatAmount(
                      allocations.reduce((sum, a) => sum + a.grossAmount, 0),
                      currency
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-500">—</td>
                  <td className="py-2.5 px-3 text-right bg-sky-100 text-sky-950 tabular-nums">
                    {formatAmount(totalSavingsDeducted, currency)}
                  </td>
                  {activeBuckets.map((bucket) => {
                    const bucketSum = allocations.reduce((sum, alloc) => {
                      const distItem = alloc.savingsDistribution.find((d) => d.bucketId === bucket.id);
                      return sum + (distItem ? distItem.amount : alloc.quarterSavingsAllocated * (bucket.percentage / 100));
                    }, 0);
                    return (
                      <td key={bucket.id} className="py-2.5 px-3 text-right tabular-nums">
                        {formatAmount(bucketSum, currency)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
