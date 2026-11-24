/**
 * Google Drive Spreadsheet Record Alignment & 3-Way Reconciliation Types & Helpers
 */

import {
  ExpenseCategoryPreference,
  FinancialAccount,
  FlexibleExpense,
  IncomeReceipt,
  AccountTransfer,
} from '../types/finance.ts';
import { formatDateDDMMYYYY } from './dateFilters.ts';

export const DEFAULT_DRIVE_ALIGNMENT_URL =
  'https://drive.google.com/file/d/1i-znfM7-zueuReCzJpOG99q8suuarbop/view?usp=drivesdk';

export type ReconciliationStatus = 'matched' | 'difference' | 'missing';
export type ReconciliationRecordType = 'expense' | 'income' | 'transfer';

export interface DriveColumnMapping {
  date?: string;
  type?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  account?: string;
  toAccount?: string;
  category?: string;
  subcategory?: string;
  counterparty?: string;
  notes?: string;
}

export interface DriveWorkbookSheet {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  totalRowCount: number;
  autoMapping: DriveColumnMapping;
}

export interface DriveLoadedWorkbook {
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime?: string;
  sheets: DriveWorkbookSheet[];
}

export interface ProposedAlignedRecord {
  recordType: ReconciliationRecordType;
  date: string;
  amount: number;
  currency: string;
  accountId: string;
  toAccountId?: string;
  category: string;
  subcategory?: string;
  counterparty: string;
  notes: string;
}

export interface ReconciliationFieldDiff {
  field: keyof ProposedAlignedRecord;
  label: string;
  appValue: string;
  driveValue: string;
}

export interface ReconciliationRow {
  rowId: string;
  rowIndex: number;
  rawRow: Record<string, string>;
  status: ReconciliationStatus;
  confidence: number;
  approved: boolean;
  proposed: ProposedAlignedRecord;
  originalCategory?: string;
  originalSubcategory?: string;
  autoMappedCategory?: boolean;
  matchedRecordId?: string;
  existingSnapshot?: ProposedAlignedRecord;
  diffs: ReconciliationFieldDiff[];
}

export interface ReconciliationSummary {
  total: number;
  matched: number;
  differences: number;
  missing: number;
}

export interface DriveAlignmentApprovalPayload {
  additions: {
    incomes: Omit<IncomeReceipt, 'id' | 'createdAt' | 'updatedAt' | 'userId'>[];
    expenses: Omit<FlexibleExpense, 'id' | 'createdAt' | 'userId'>[];
    transfers: Omit<AccountTransfer, 'id' | 'createdAt'>[];
  };
  updates: {
    incomes: { id: string; patch: Partial<IncomeReceipt> }[];
    expenses: { id: string; patch: Partial<FlexibleExpense> }[];
    transfers: { id: string; patch: Partial<AccountTransfer> }[];
  };
}

/**
 * Extracts a Google Drive File ID from a full Drive/Sheets URL or raw ID string.
 */
export function extractGoogleDriveFileId(input: string): string | null {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  const fileMatch = trimmed.match(/\/(?:file|spreadsheets|document)\/d\/([a-zA-Z0-9_-]{10,120})/);
  if (fileMatch && fileMatch[1]) return fileMatch[1];

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,120})/);
  if (queryMatch && queryMatch[1]) return queryMatch[1];

  if (/^[a-zA-Z0-9_-]{15,120}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function normalizeTextForDiff(val?: string | null): string {
  return String(val || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Builds a normalized case-insensitive lookup table mapping every defined
 * subcategory in Settings to its parent category and canonical subcategory name.
 */
export function buildSubcategoryToCategoryLookup(
  categoryPrefs: ExpenseCategoryPreference[]
): Map<string, { category: string; subcategory: string }> {
  const lookup = new Map<string, { category: string; subcategory: string }>();
  for (const pref of categoryPrefs || []) {
    const parentName = String(pref?.name || '').trim();
    if (!parentName) continue;
    for (const sub of pref.subcategories || []) {
      const cleanSub = String(sub || '').trim();
      if (!cleanSub) continue;
      const key = normalizeTextForDiff(cleanSub);
      if (key && !lookup.has(key)) {
        lookup.set(key, { category: parentName, subcategory: cleanSub });
      }
    }
  }
  return lookup;
}

/**
 * Matches an imported record's subcategory (or a subcategory name placed inside
 * the category cell) to the parent category defined in the app's Settings.
 */
export function resolveCategoryFromSubcategory(
  rawCategory: string | undefined,
  rawSubcategory: string | undefined,
  categoryPrefs: ExpenseCategoryPreference[]
): { category: string; subcategory: string; mapped: boolean } {
  const cleanCat = String(rawCategory || '').trim();
  const cleanSub = String(rawSubcategory || '').trim();
  const lookup = buildSubcategoryToCategoryLookup(categoryPrefs);

  if (cleanSub) {
    const subKey = normalizeTextForDiff(cleanSub);
    const exactMatch = lookup.get(subKey);
    if (exactMatch) {
      return {
        category: exactMatch.category,
        subcategory: exactMatch.subcategory,
        mapped: true,
      };
    }
  }

  // Also check if the imported category cell itself is actually a defined subcategory
  if (cleanCat) {
    const catKey = normalizeTextForDiff(cleanCat);
    const isAlreadyCategory = (categoryPrefs || []).some(
      (p) => normalizeTextForDiff(p.name) === catKey
    );
    if (!isAlreadyCategory) {
      const catAsSubMatch = lookup.get(catKey);
      if (catAsSubMatch) {
        return {
          category: catAsSubMatch.category,
          subcategory: cleanSub || catAsSubMatch.subcategory,
          mapped: true,
        };
      }
    }
  }

  return {
    category: cleanCat,
    subcategory: cleanSub,
    mapped: false,
  };
}

function resolveAccountLabel(
  accountId: string | undefined,
  accounts: FinancialAccount[]
): string {
  if (!accountId) return 'Default Account';
  const found = accounts.find((a) => a.id === accountId);
  return found ? found.name : accountId;
}

/**
 * Computes human-readable field differences between an existing app record
 * and the user-edited/proposed Drive record, formatting dates as dd/mm/yyyy.
 */
export function computeReconciliationDiffs(
  existing: ProposedAlignedRecord | undefined,
  proposed: ProposedAlignedRecord,
  accounts: FinancialAccount[]
): ReconciliationFieldDiff[] {
  if (!existing) return [];
  const diffs: ReconciliationFieldDiff[] = [];

  if ((existing.date || '').slice(0, 10) !== (proposed.date || '').slice(0, 10)) {
    diffs.push({
      field: 'date',
      label: 'Date',
      appValue: formatDateDDMMYYYY(existing.date),
      driveValue: formatDateDDMMYYYY(proposed.date),
    });
  }

  const existingAmt = Math.round((Number(existing.amount) || 0) * 100) / 100;
  const proposedAmt = Math.round((Number(proposed.amount) || 0) * 100) / 100;
  if (Math.abs(existingAmt - proposedAmt) >= 0.01) {
    diffs.push({
      field: 'amount',
      label: 'Amount',
      appValue: `${existing.currency} ${existingAmt.toFixed(2)}`,
      driveValue: `${proposed.currency} ${proposedAmt.toFixed(2)}`,
    });
  }

  if ((existing.currency || '').toUpperCase() !== (proposed.currency || '').toUpperCase()) {
    diffs.push({
      field: 'currency',
      label: 'Currency',
      appValue: (existing.currency || 'USD').toUpperCase(),
      driveValue: (proposed.currency || 'USD').toUpperCase(),
    });
  }

  if (existing.accountId !== proposed.accountId) {
    diffs.push({
      field: 'accountId',
      label: proposed.recordType === 'transfer' ? 'From Account' : 'Account',
      appValue: resolveAccountLabel(existing.accountId, accounts),
      driveValue: resolveAccountLabel(proposed.accountId, accounts),
    });
  }

  if (
    proposed.recordType === 'transfer' &&
    (existing.toAccountId || '') !== (proposed.toAccountId || '')
  ) {
    diffs.push({
      field: 'toAccountId',
      label: 'To Account',
      appValue: resolveAccountLabel(existing.toAccountId, accounts),
      driveValue: resolveAccountLabel(proposed.toAccountId, accounts),
    });
  }

  if (
    proposed.recordType === 'expense' &&
    normalizeTextForDiff(existing.category) !== normalizeTextForDiff(proposed.category)
  ) {
    diffs.push({
      field: 'category',
      label: 'Category',
      appValue: existing.category || 'Uncategorized',
      driveValue: proposed.category || 'Uncategorized',
    });
  }

  if (
    proposed.recordType === 'expense' &&
    normalizeTextForDiff(existing.subcategory) !== normalizeTextForDiff(proposed.subcategory)
  ) {
    diffs.push({
      field: 'subcategory',
      label: 'Subcategory',
      appValue: existing.subcategory || 'None',
      driveValue: proposed.subcategory || 'None',
    });
  }

  if (
    proposed.recordType !== 'transfer' &&
    normalizeTextForDiff(existing.counterparty) !== normalizeTextForDiff(proposed.counterparty)
  ) {
    diffs.push({
      field: 'counterparty',
      label: proposed.recordType === 'income' ? 'Source' : 'To / Cause',
      appValue: existing.counterparty || '—',
      driveValue: proposed.counterparty || '—',
    });
  }

  if (normalizeTextForDiff(existing.notes) !== normalizeTextForDiff(proposed.notes)) {
    diffs.push({
      field: 'notes',
      label: 'Notes',
      appValue: existing.notes || '—',
      driveValue: proposed.notes || '—',
    });
  }

  return diffs;
}
