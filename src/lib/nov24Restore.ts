/**
 * Transaction Restore Utility — Restore to 23/11/2026
 * Identifies ONLY transaction records imported on 24/11/2026 (from Google Drive Alignment
 * or Settings File Import), leaving all manually entered records and all records from
 * 23/11/2026 or earlier completely untouched.
 */

import {
  IncomeReceipt,
  FlexibleExpense,
  AccountTransfer,
} from '../types/finance.ts';

export const RESTORE_TARGET_DATE_LABEL = '23/11/2026';
export const IMPORT_PURGE_DATE_YMD = '2026-11-24';
export const IMPORT_PURGE_DATE_LABEL = '24/11/2026';

export type ImportOriginSource = 'drive' | 'file';

export interface Nov24ImportedSummary {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  transfers: AccountTransfer[];
  incomeIds: string[];
  expenseIds: string[];
  transferIds: string[];
  driveCount: number;
  fileCount: number;
  totalCount: number;
}

function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Checks whether an ISO timestamp falls on `targetYmd` (2026-11-24) in either UTC or local time.
 */
export function isTimestampOnYmd(
  timestamp: string | undefined | null,
  targetYmd: string = IMPORT_PURGE_DATE_YMD
): boolean {
  if (!timestamp) return false;
  const raw = String(timestamp).trim();
  if (!raw) return false;
  if (raw.slice(0, 10) === targetYmd) return true;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return false;
  return toLocalYmd(parsed) === targetYmd;
}

/**
 * Determines whether a transaction record was created via Drive Alignment or File Import
 * (returns 'drive' | 'file' | null). Manual records always return null.
 */
export function getImportedRecordSource(
  record: { id?: string; receiptId?: string; description?: string; clientOrSource?: string },
  kind: 'income' | 'expense' | 'transfer'
): ImportOriginSource | null {
  const id = String(record.id || '');
  const receiptId = String(record.receiptId || '');

  if (kind === 'income') {
    if (id.startsWith('inc_drv_') || receiptId.startsWith('DRV-')) return 'drive';
    if (id.startsWith('inc_imp_') || receiptId.startsWith('IMP-')) return 'file';
    return null;
  }

  if (kind === 'expense') {
    if (id.startsWith('exp_drv_')) return 'drive';
    if (id.startsWith('exp_imp_')) return 'file';
    return null;
  }

  if (id.startsWith('trans_drv_')) return 'drive';
  if (id.startsWith('trans_imp_')) return 'file';
  return null;
}

/**
 * Finds ONLY transactions imported on 24/11/2026 (2026-11-24).
 */
export function findNov24ImportedTransactions(data: {
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  transfers: AccountTransfer[];
}): Nov24ImportedSummary {
  const matchedIncomes: IncomeReceipt[] = [];
  const matchedExpenses: FlexibleExpense[] = [];
  const matchedTransfers: AccountTransfer[] = [];
  let driveCount = 0;
  let fileCount = 0;

  for (const inc of data.incomes || []) {
    const src = getImportedRecordSource(inc, 'income');
    if (src && isTimestampOnYmd(inc.createdAt, IMPORT_PURGE_DATE_YMD)) {
      matchedIncomes.push(inc);
      if (src === 'drive') driveCount++;
      else fileCount++;
    }
  }

  for (const exp of data.expenses || []) {
    const src = getImportedRecordSource(exp, 'expense');
    if (src && isTimestampOnYmd(exp.createdAt, IMPORT_PURGE_DATE_YMD)) {
      matchedExpenses.push(exp);
      if (src === 'drive') driveCount++;
      else fileCount++;
    }
  }

  for (const tr of data.transfers || []) {
    const src = getImportedRecordSource(tr, 'transfer');
    if (src && isTimestampOnYmd(tr.createdAt, IMPORT_PURGE_DATE_YMD)) {
      matchedTransfers.push(tr);
      if (src === 'drive') driveCount++;
      else fileCount++;
    }
  }

  return {
    incomes: matchedIncomes,
    expenses: matchedExpenses,
    transfers: matchedTransfers,
    incomeIds: matchedIncomes.map((i) => i.id),
    expenseIds: matchedExpenses.map((e) => e.id),
    transferIds: matchedTransfers.map((t) => t.id),
    driveCount,
    fileCount,
    totalCount:
      matchedIncomes.length + matchedExpenses.length + matchedTransfers.length,
  };
}
