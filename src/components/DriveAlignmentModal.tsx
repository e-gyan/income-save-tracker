import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FinancialAccount,
  FlexibleExpense,
  IncomeReceipt,
  AccountTransfer,
  UserSettings,
} from '../types/finance.ts';
import {
  DEFAULT_DRIVE_ALIGNMENT_URL,
  DriveColumnMapping,
  DriveLoadedWorkbook,
  DriveWorkbookSheet,
  ReconciliationRow,
  ReconciliationStatus,
  ProposedAlignedRecord,
  DriveAlignmentApprovalPayload,
  extractGoogleDriveFileId,
  computeReconciliationDiffs,
  resolveCategoryFromSubcategory,
} from '../lib/driveAlignment.ts';
import { ReconciliationTable } from './ReconciliationTable.tsx';
import {
  connectGoogleDriveReadOnly,
  getDriveAccessToken,
  clearDriveAccessToken,
} from '../lib/firebase.ts';
import {
  getEffectiveExpenseCategoryPreferences,
  getQuarterFromDate,
  isSavingsVaultAccount,
} from '../lib/calculations.ts';
import {
  convertCurrency2dp,
  getAccountCurrency,
  MarketFxSnapshot,
  roundTo2Decimals,
} from '../lib/currencyService.ts';
import { formatDateDDMMYYYY } from '../lib/dateFilters.ts';
import {
  loadWorkflowState,
  saveWorkflowState,
} from '../lib/appStateRestore.ts';

interface DriveAlignmentModalProps {
  isOpen: boolean;
  initialUrl?: string;
  userId?: string;
  onClose: () => void;
  settings: UserSettings;
  accounts: FinancialAccount[];
  incomes: IncomeReceipt[];
  expenses: FlexibleExpense[];
  transfers: AccountTransfer[];
  fxSnapshot?: MarketFxSnapshot | null;
  onApplyAlignment: (
    payload: DriveAlignmentApprovalPayload
  ) => Promise<{
    addedCount: number;
    updatedCount: number;
  }>;
}

interface PersistedDriveAlignmentSession {
  driveUrl: string;
  workbook: DriveLoadedWorkbook | null;
  selectedSheetName: string;
  columnMapping: DriveColumnMapping;
  showColumnMapper: boolean;
  rows: ReconciliationRow[];
  autoMapSubcategories: boolean;
  activeFilter: FilterTab;
  searchQuery: string;
  expandedRowId: string | null;
  completionSummary: {
    addedCount: number;
    updatedCount: number;
  } | null;
}

const MAPPING_FIELDS: { key: keyof DriveColumnMapping; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'currency', label: 'Currency' },
  { key: 'account', label: 'Account' },
  { key: 'toAccount', label: 'To Account' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'counterparty', label: 'Payee / Source' },
  { key: 'notes', label: 'Notes' },
];

type FilterTab = 'all' | 'difference' | 'missing' | 'matched';

export const DriveAlignmentModal: React.FC<DriveAlignmentModalProps> = ({
  isOpen,
  initialUrl = DEFAULT_DRIVE_ALIGNMENT_URL,
  userId = 'guest_user',
  onClose,
  settings,
  accounts,
  incomes,
  expenses,
  transfers,
  fxSnapshot,
  onApplyAlignment,
}) => {
  const initialSavedSession = useMemo(
    () =>
      loadWorkflowState<PersistedDriveAlignmentSession>(
        'drive_alignment',
        userId
      ),
    [userId]
  );

  const [driveUrl, setDriveUrl] = useState(
    () => initialSavedSession?.driveUrl || initialUrl || DEFAULT_DRIVE_ALIGNMENT_URL
  );
  const [hasDriveToken, setHasDriveToken] = useState<boolean>(() =>
    Boolean(getDriveAccessToken())
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const [workbook, setWorkbook] = useState<DriveLoadedWorkbook | null>(
    () => initialSavedSession?.workbook || null
  );
  const [selectedSheetName, setSelectedSheetName] = useState<string>(
    () => initialSavedSession?.selectedSheetName || ''
  );
  const [columnMapping, setColumnMapping] = useState<DriveColumnMapping>(
    () => initialSavedSession?.columnMapping || {}
  );
  const [showColumnMapper, setShowColumnMapper] = useState(
    () => Boolean(initialSavedSession?.showColumnMapper)
  );

  const [rows, setRows] = useState<ReconciliationRow[]>(
    () => (Array.isArray(initialSavedSession?.rows) ? initialSavedSession.rows : [])
  );
  const [autoMapSubcategories, setAutoMapSubcategories] = useState<boolean>(() =>
    initialSavedSession?.autoMapSubcategories !== undefined
      ? Boolean(initialSavedSession.autoMapSubcategories)
      : true
  );
  const [activeFilter, setActiveFilter] = useState<FilterTab>(
    () => initialSavedSession?.activeFilter || 'all'
  );
  const [searchQuery, setSearchQuery] = useState(
    () => initialSavedSession?.searchQuery || ''
  );
  const [expandedRowId, setExpandedRowId] = useState<string | null>(
    () => initialSavedSession?.expandedRowId || null
  );

  const [showConfirmBar, setShowConfirmBar] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<{
    addedCount: number;
    updatedCount: number;
  } | null>(() => initialSavedSession?.completionSummary || null);

  const baseCurrency = (settings.currency || 'USD').toUpperCase();

  const activeAccounts = useMemo(() => accounts, [accounts]);

  const operatingAccounts = useMemo(
    () => activeAccounts.filter((a) => !isSavingsVaultAccount(a)),
    [activeAccounts]
  );

  const categoryPrefs = useMemo(
    () => getEffectiveExpenseCategoryPreferences(settings),
    [settings]
  );

  const categoryNames = useMemo(
    () => categoryPrefs.map((c) => c.name),
    [categoryPrefs]
  );

  const accountById = useMemo(() => {
    const map = new Map<string, FinancialAccount>();
    for (const acc of accounts) map.set(acc.id, acc);
    return map;
  }, [accounts]);

  useEffect(() => {
    if (isOpen) {
      if (initialUrl && initialUrl !== driveUrl && !workbook) {
        setDriveUrl(initialUrl);
      }
      setHasDriveToken(Boolean(getDriveAccessToken()));
      setShowConfirmBar(false);
    }
  }, [isOpen, initialUrl, workbook]);

  // Persist Drive Alignment session & all performed actions so returning restores exact state
  useEffect(() => {
    saveWorkflowState<PersistedDriveAlignmentSession>('drive_alignment', userId, {
      driveUrl,
      workbook,
      selectedSheetName,
      columnMapping,
      showColumnMapper,
      rows,
      autoMapSubcategories,
      activeFilter,
      searchQuery,
      expandedRowId,
      completionSummary,
    });
  }, [
    userId,
    driveUrl,
    workbook,
    selectedSheetName,
    columnMapping,
    showColumnMapper,
    rows,
    autoMapSubcategories,
    activeFilter,
    searchQuery,
    expandedRowId,
    completionSummary,
  ]);

  const currentSheet: DriveWorkbookSheet | null = useMemo(() => {
    if (!workbook || workbook.sheets.length === 0) return null;
    return (
      workbook.sheets.find((s) => s.name === selectedSheetName) ||
      workbook.sheets[0]
    );
  }, [workbook, selectedSheetName]);

  const runReconciliation = useCallback(
    async (
      sheet: DriveWorkbookSheet,
      mappingOverride: DriveColumnMapping,
      autoMapOverride?: boolean
    ) => {
      setIsReconciling(true);
      setErrorMsg(null);
      setShowConfirmBar(false);
      const shouldAutoMap =
        autoMapOverride !== undefined ? autoMapOverride : autoMapSubcategories;
      try {
        const res = await fetch('/api/drive/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: sheet.rows,
            mapping: mappingOverride,
            baseCurrency,
            accounts: activeAccounts,
            incomes,
            expenses,
            transfers,
            categories: categoryNames,
            expenseCategoryPreferences: categoryPrefs,
            autoMapSubcategories: shouldAutoMap,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Could not reconcile spreadsheet rows.');
        }
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setExpandedRowId(null);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Reconciliation failed.');
      } finally {
        setIsReconciling(false);
      }
    },
    [
      baseCurrency,
      activeAccounts,
      incomes,
      expenses,
      transfers,
      categoryNames,
      categoryPrefs,
      autoMapSubcategories,
    ]
  );

  const fetchSpreadsheetFromDrive = useCallback(
    async (tokenOverride?: string, targetUrl?: string) => {
      const token = tokenOverride || getDriveAccessToken();
      if (!token) {
        setHasDriveToken(false);
        setNeedsReconnect(true);
        return;
      }

      const urlToLoad = (targetUrl ?? driveUrl).trim();
      const fileId = extractGoogleDriveFileId(urlToLoad);
      if (!fileId) {
        setErrorMsg('Enter a valid Google Drive file link or file ID.');
        return;
      }

      setIsLoadingFile(true);
      setErrorMsg(null);
      setNeedsReconnect(false);
      setCompletionSummary(null);
      setShowConfirmBar(false);

      try {
        const res = await fetch('/api/drive/read-spreadsheet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ fileIdOrUrl: urlToLoad }),
        });

        const data = await res.json();
        if (res.status === 401) {
          clearDriveAccessToken();
          setHasDriveToken(false);
          setNeedsReconnect(true);
          setErrorMsg(
            data?.error || 'Google Drive session expired. Please reconnect Google Drive.'
          );
          return;
        }
        if (!res.ok) {
          throw new Error(data?.error || 'Unable to load spreadsheet from Google Drive.');
        }

        const loaded: DriveLoadedWorkbook = data;
        setWorkbook(loaded);
        const firstSheet = loaded.sheets[0];
        if (firstSheet) {
          setSelectedSheetName(firstSheet.name);
          setColumnMapping(firstSheet.autoMapping || {});
          await runReconciliation(firstSheet, firstSheet.autoMapping || {});
        } else {
          setRows([]);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to read file from Google Drive.');
      } finally {
        setIsLoadingFile(false);
      }
    },
    [driveUrl, runReconciliation]
  );

  const handleConnectDrive = async () => {
    setIsConnecting(true);
    setErrorMsg(null);
    setNeedsReconnect(false);
    try {
      const { accessToken } = await connectGoogleDriveReadOnly();
      setHasDriveToken(true);
      await fetchSpreadsheetFromDrive(accessToken, driveUrl);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Google sign-in was closed before completing.');
      } else {
        setErrorMsg(
          err?.message || 'Could not connect Google Drive. Please try again.'
        );
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSelectSheet = async (sheetName: string) => {
    if (!workbook) return;
    const found = workbook.sheets.find((s) => s.name === sheetName);
    if (!found) return;
    setSelectedSheetName(found.name);
    setColumnMapping(found.autoMapping || {});
    await runReconciliation(found, found.autoMapping || {});
  };

  const handleMappingChange = async (
    field: keyof DriveColumnMapping,
    headerName: string
  ) => {
    if (!currentSheet) return;
    const nextMapping: DriveColumnMapping = {
      ...columnMapping,
      [field]: headerName || undefined,
    };
    setColumnMapping(nextMapping);
    await runReconciliation(currentSheet, nextMapping);
  };

  const handleToggleAutoMapSubcategories = (enabled: boolean) => {
    setAutoMapSubcategories(enabled);
    setRows((prev) =>
      prev.map((row) => {
        if (row.proposed.recordType !== 'expense') return row;
        const baseCat = row.originalCategory ?? row.proposed.category;
        const baseSub = row.originalSubcategory ?? row.proposed.subcategory ?? '';

        let nextCategory = row.proposed.category;
        let nextSubcategory = row.proposed.subcategory || '';
        let nextAutoMapped = Boolean(row.autoMappedCategory);

        if (enabled) {
          const resolved = resolveCategoryFromSubcategory(
            row.proposed.category || baseCat,
            row.proposed.subcategory || baseSub,
            categoryPrefs
          );
          if (resolved.mapped) {
            nextCategory = resolved.category;
            nextSubcategory = resolved.subcategory;
            nextAutoMapped = true;
          }
        } else if (row.autoMappedCategory) {
          nextCategory = baseCat || row.proposed.category;
          nextSubcategory = baseSub;
          nextAutoMapped = false;
        }

        if (
          nextCategory === row.proposed.category &&
          nextSubcategory === (row.proposed.subcategory || '') &&
          nextAutoMapped === Boolean(row.autoMappedCategory)
        ) {
          return row;
        }

        const nextProposed: ProposedAlignedRecord = {
          ...row.proposed,
          category: nextCategory,
          subcategory: nextSubcategory,
        };

        if (row.matchedRecordId && row.existingSnapshot) {
          const nextDiffs = computeReconciliationDiffs(
            row.existingSnapshot,
            nextProposed,
            accounts
          );
          const nextStatus: ReconciliationStatus =
            nextDiffs.length === 0 ? 'matched' : 'difference';
          return {
            ...row,
            proposed: nextProposed,
            autoMappedCategory: nextAutoMapped,
            diffs: nextDiffs,
            status: nextStatus,
            approved: nextDiffs.length > 0 ? row.approved : false,
          };
        }

        return {
          ...row,
          proposed: nextProposed,
          autoMappedCategory: nextAutoMapped,
        };
      })
    );
  };

  const updateRowProposed = (
    rowId: string,
    patch: Partial<ProposedAlignedRecord>
  ) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        const nextProposed: ProposedAlignedRecord = {
          ...row.proposed,
          ...patch,
        };
        let nextAutoMapped = Boolean(row.autoMappedCategory);

        // If user manually changes category, clear auto-mapped flag;
        // if user sets a subcategory while Auto-map is enabled, resolve its parent category from Settings.
        if (patch.category !== undefined && patch.subcategory === undefined) {
          nextAutoMapped = false;
        }
        if (
          autoMapSubcategories &&
          nextProposed.recordType === 'expense' &&
          patch.subcategory !== undefined &&
          patch.subcategory.trim()
        ) {
          const resolved = resolveCategoryFromSubcategory(
            nextProposed.category,
            patch.subcategory,
            categoryPrefs
          );
          if (resolved.mapped) {
            nextProposed.category = resolved.category;
            nextProposed.subcategory = resolved.subcategory;
            nextAutoMapped = true;
          }
        }

        if (row.matchedRecordId && row.existingSnapshot) {
          const nextDiffs = computeReconciliationDiffs(
            row.existingSnapshot,
            nextProposed,
            accounts
          );
          const nextStatus: ReconciliationStatus =
            nextDiffs.length === 0 ? 'matched' : 'difference';
          return {
            ...row,
            proposed: nextProposed,
            autoMappedCategory: nextAutoMapped,
            diffs: nextDiffs,
            status: nextStatus,
            approved: nextDiffs.length > 0 ? row.approved : false,
          };
        }
        return {
          ...row,
          proposed: nextProposed,
          autoMappedCategory: nextAutoMapped,
        };
      })
    );
  };

  const revertSingleFieldToApp = (
    rowId: string,
    field: keyof ProposedAlignedRecord
  ) => {
    const target = rows.find((r) => r.rowId === rowId);
    if (!target || !target.existingSnapshot) return;
    updateRowProposed(rowId, {
      [field]: target.existingSnapshot[field],
    } as Partial<ProposedAlignedRecord>);
  };

  const toggleRowApproved = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        if (row.status === 'matched') return row;
        return { ...row, approved: !row.approved };
      })
    );
  };

  const handleBulkSelect = (mode: 'missing' | 'difference' | 'none') => {
    setRows((prev) =>
      prev.map((row) => {
        if (mode === 'none') return { ...row, approved: false };
        if (row.status === mode) return { ...row, approved: true };
        return row;
      })
    );
  };

  const handleToggleSelectAllVisible = (selectAll: boolean) => {
    const visibleIds = new Set(filteredRows.map((r) => r.rowId));
    setRows((prev) =>
      prev.map((row) => {
        if (!visibleIds.has(row.rowId) || row.status === 'matched') return row;
        return { ...row, approved: selectAll };
      })
    );
  };

  const counts = useMemo(() => {
    let matched = 0;
    let differences = 0;
    let missing = 0;
    let approvedAdds = 0;
    let approvedUpdates = 0;

    for (const r of rows) {
      if (r.status === 'matched') matched++;
      else if (r.status === 'difference') {
        differences++;
        if (r.approved) approvedUpdates++;
      } else {
        missing++;
        if (r.approved) approvedAdds++;
      }
    }
    return {
      total: rows.length,
      matched,
      differences,
      missing,
      approvedAdds,
      approvedUpdates,
      totalApproved: approvedAdds + approvedUpdates,
    };
  }, [rows]);

  const autoMappedCount = useMemo(
    () =>
      rows.filter(
        (r) => r.proposed.recordType === 'expense' && Boolean(r.autoMappedCategory)
      ).length,
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (activeFilter !== 'all' && row.status !== activeFilter) return false;
      if (!q) return true;
      const accName = accountById.get(row.proposed.accountId)?.name || '';
      const haystack = [
        row.proposed.date,
        formatDateDDMMYYYY(row.proposed.date),
        row.proposed.recordType,
        row.proposed.counterparty,
        row.proposed.category,
        row.proposed.subcategory || '',
        row.proposed.notes,
        row.proposed.currency,
        String(row.proposed.amount),
        accName,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, activeFilter, searchQuery, accountById]);

  const approvedBreakdown = useMemo(() => {
    const selected = rows.filter((r) => r.approved && r.status !== 'matched');
    const summary = {
      addIncomes: 0,
      addExpenses: 0,
      addTransfers: 0,
      updateIncomes: 0,
      updateExpenses: 0,
      updateTransfers: 0,
    };
    for (const r of selected) {
      const isUpdate = r.status === 'difference' && Boolean(r.matchedRecordId);
      if (r.proposed.recordType === 'income') {
        if (isUpdate) summary.updateIncomes++;
        else summary.addIncomes++;
      } else if (r.proposed.recordType === 'transfer') {
        if (isUpdate) summary.updateTransfers++;
        else summary.addTransfers++;
      } else {
        if (isUpdate) summary.updateExpenses++;
        else summary.addExpenses++;
      }
    }
    return summary;
  }, [rows]);

  const buildApprovalPayload = (): DriveAlignmentApprovalPayload => {
    const payload: DriveAlignmentApprovalPayload = {
      additions: { incomes: [], expenses: [], transfers: [] },
      updates: { incomes: [], expenses: [], transfers: [] },
    };

    for (const row of rows) {
      if (!row.approved || row.status === 'matched') continue;
      const p = row.proposed;
      const cleanAmt = roundTo2Decimals(Math.abs(Number(p.amount) || 0));
      if (cleanAmt <= 0) continue;

      const txCurr = (p.currency || baseCurrency).toUpperCase();
      const targetAcc = accountById.get(p.accountId);
      const accCurr = getAccountCurrency(targetAcc, baseCurrency);

      const baseConv = convertCurrency2dp(cleanAmt, txCurr, baseCurrency, fxSnapshot);

      const isUpdate = row.status === 'difference' && Boolean(row.matchedRecordId);

      if (p.recordType === 'income') {
        const accConv = convertCurrency2dp(cleanAmt, txCurr, accCurr, fxSnapshot);
        const incomeBody = {
          date: p.date,
          quarter: getQuarterFromDate(p.date),
          clientOrSource: p.counterparty || 'Drive Income',
          category: settings.incomeCategories?.[0] || 'General Income',
          receiptId: `DRV-${p.date.replace(/-/g, '')}-${row.rowIndex}`,
          grossAmount: baseConv.convertedAmount,
          currency: accCurr,
          originalGrossAmount: accConv.convertedAmount,
          exchangeRate: baseConv.exchangeRate2dp,
          accountId: p.accountId,
          notes: p.notes || '',
          savingsRate: 0,
          allocatedDeductions: [],
        };
        if (isUpdate && row.matchedRecordId) {
          payload.updates.incomes.push({
            id: row.matchedRecordId,
            patch: {
              date: incomeBody.date,
              quarter: incomeBody.quarter,
              clientOrSource: incomeBody.clientOrSource,
              grossAmount: incomeBody.grossAmount,
              currency: incomeBody.currency,
              originalGrossAmount: incomeBody.originalGrossAmount,
              exchangeRate: incomeBody.exchangeRate,
              accountId: incomeBody.accountId,
              notes: incomeBody.notes,
            },
          });
        } else {
          payload.additions.incomes.push(incomeBody);
        }
      } else if (p.recordType === 'transfer') {
        const toAccId = p.toAccountId || p.accountId;
        const toAcc = accountById.get(toAccId);
        const destCurr = getAccountCurrency(toAcc, baseCurrency);
        const destConv = convertCurrency2dp(cleanAmt, txCurr, destCurr, fxSnapshot);
        const transferBody = {
          date: p.date,
          sourceAccountId: p.accountId,
          destinationAccountId: toAccId,
          amount: baseConv.convertedAmount,
          sourceCurrency: txCurr,
          sourceAmount: cleanAmt,
          destinationCurrency: destCurr,
          destinationAmount: destConv.convertedAmount,
          exchangeRate: destConv.exchangeRate2dp,
          transferType: 'general' as const,
          description: p.notes || p.counterparty || 'Aligned transfer',
        };
        if (isUpdate && row.matchedRecordId) {
          payload.updates.transfers.push({
            id: row.matchedRecordId,
            patch: transferBody,
          });
        } else {
          payload.additions.transfers.push(transferBody);
        }
      } else {
        const expenseBody = {
          date: p.date,
          category: p.category || categoryNames[0] || 'Other',
          subcategory: p.subcategory || undefined,
          recipient: p.counterparty || undefined,
          description: p.notes || p.counterparty || p.category || 'Aligned expense',
          notes: p.notes || '',
          amount: baseConv.convertedAmount,
          currency: txCurr,
          originalAmount: cleanAmt,
          exchangeRate: baseConv.exchangeRate2dp,
          accountId: p.accountId,
        };
        if (isUpdate && row.matchedRecordId) {
          payload.updates.expenses.push({
            id: row.matchedRecordId,
            patch: expenseBody,
          });
        } else {
          payload.additions.expenses.push(expenseBody);
        }
      }
    }

    return payload;
  };

  const handleConfirmApply = async () => {
    const payload = buildApprovalPayload();
    const totalPending =
      payload.additions.incomes.length +
      payload.additions.expenses.length +
      payload.additions.transfers.length +
      payload.updates.incomes.length +
      payload.updates.expenses.length +
      payload.updates.transfers.length;

    if (totalPending === 0) {
      setErrorMsg('Select at least one valid record with an amount above 0.');
      setShowConfirmBar(false);
      return;
    }

    setIsApplying(true);
    setErrorMsg(null);
    try {
      const result = await onApplyAlignment(payload);
      setCompletionSummary(result);
      setShowConfirmBar(false);
      // Mark applied rows as aligned locally so the table reflects the saved state immediately
      setRows((prev) =>
        prev.map((row) =>
          row.approved && row.status !== 'matched'
            ? {
                ...row,
                status: 'matched',
                approved: false,
                existingSnapshot: { ...row.proposed },
                diffs: [],
              }
            : row
        )
      );
      setExpandedRowId(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save aligned records.');
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen) return null;

  const isBusy = isConnecting || isLoadingFile || isReconciling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 sm:p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-alignment-title"
    >
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-2xl">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <h2
              id="drive-alignment-title"
              className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate"
            >
              Google Drive Record Alignment
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Read-only Drive sync · Match existing records, adjust differences, and approve additions
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>

        {/* Source Bar: Drive URL + Connect / Load */}
        <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-4 py-3 sm:px-6 space-y-2.5">
          <div className="flex flex-col md:flex-row md:items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <label
                htmlFor="drive-alignment-url"
                className="sr-only"
              >
                Google Drive Spreadsheet Link
              </label>
              <input
                id="drive-alignment-url"
                type="text"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                placeholder="Paste Google Drive spreadsheet link or file ID"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-300 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!hasDriveToken || needsReconnect ? (
                <button
                  type="button"
                  onClick={handleConnectDrive}
                  disabled={isConnecting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                >
                  <svg
                    className="h-4 w-4 shrink-0"
                    viewBox="0 0 48 48"
                    aria-hidden="true"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>
                    {isConnecting ? 'Connecting...' : 'Sign in with Google'}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fetchSpreadsheetFromDrive()}
                    disabled={isBusy}
                    style={{ backgroundColor: 'var(--app-accent)' }}
                    className="rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isLoadingFile ? 'Reading Drive...' : workbook ? 'Reload Sheet' : 'Load Sheet'}
                  </button>
                  <button
                    type="button"
                    onClick={handleConnectDrive}
                    disabled={isBusy}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    Switch Account
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Unboxed File Metadata + Sheet Tabs + Column Mapper Toggle */}
          {workbook && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {workbook.fileName}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {workbook.sheets.length}{' '}
                  {workbook.sheets.length === 1 ? 'tab' : 'tabs'}
                </span>
                {workbook.modifiedTime && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Updated {formatDateDDMMYYYY(workbook.modifiedTime)}
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {workbook.sheets.length > 1 && (
                  <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-0.5 overflow-x-auto max-w-full">
                    {workbook.sheets.map((sheet) => {
                      const active = sheet.name === currentSheet?.name;
                      return (
                        <button
                          key={sheet.name}
                          type="button"
                          onClick={() => handleSelectSheet(sheet.name)}
                          disabled={isBusy}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                          }`}
                        >
                          {sheet.name} ({sheet.totalRowCount})
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowColumnMapper((prev) => !prev)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  {showColumnMapper ? 'Hide Column Mapping' : 'Column Mapping'}
                </button>
              </div>
            </div>
          )}

          {/* Collapsible Column Mapping Strip */}
          {showColumnMapper && currentSheet && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              {MAPPING_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {label}
                  </label>
                  <select
                    value={columnMapping[key] || ''}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                    disabled={isReconciling}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-300 focus:outline-none"
                  >
                    <option value="">Not mapped</option>
                    {currentSheet.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline Alerts */}
        {errorMsg && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 sm:px-6 text-xs text-rose-700 dark:text-rose-300">
            <span>{errorMsg}</span>
            {needsReconnect && (
              <button
                type="button"
                onClick={handleConnectDrive}
                className="rounded-md bg-rose-700 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-800 whitespace-nowrap shrink-0"
              >
                Reconnect Google Drive
              </button>
            )}
          </div>
        )}

        {completionSummary && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 sm:px-6 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <span>
              Alignment complete · {completionSummary.addedCount} added ·{' '}
              {completionSummary.updatedCount} updated in your ledger.
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-emerald-300 dark:border-emerald-700 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 whitespace-nowrap shrink-0"
            >
              Done
            </button>
          </div>
        )}

        {/* Filter Toolbar (when workbook loaded) */}
        {workbook && !isBusy && rows.length > 0 && (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1 overflow-x-auto">
              {(
                [
                  { id: 'all', label: `All (${counts.total})` },
                  { id: 'difference', label: `Differences (${counts.differences})` },
                  { id: 'missing', label: `Missing (${counts.missing})` },
                  { id: 'matched', label: `Matched (${counts.matched})` },
                ] as { id: FilterTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by payee, category, account, notes..."
                className="w-full sm:w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleBulkSelect('difference')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Select Differences
              </button>
              <button
                type="button"
                onClick={() => handleBulkSelect('missing')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Select Missing
              </button>
              <button
                type="button"
                onClick={() => handleBulkSelect('none')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Main Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Initial Unconnected State */}
          {!workbook && !isBusy && (
            <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-14 text-center space-y-4">
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {hasDriveToken
                    ? 'Ready to read your Google Drive spreadsheet'
                    : 'Connect Google Drive to start alignment'}
                </h3>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Save N Know reads your Excel, CSV, or Google Sheets file with read-only
                  permission, matches it against your existing ledger, flags differences side
                  by side, and waits for your approval before saving any record.
                </p>
              </div>
              {!hasDriveToken ? (
                <button
                  type="button"
                  onClick={handleConnectDrive}
                  className="inline-flex items-center gap-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>Sign in with Google (Read-Only Drive)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fetchSpreadsheetFromDrive()}
                  style={{ backgroundColor: 'var(--app-accent)' }}
                  className="rounded-lg px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Load Spreadsheet
                </button>
              )}
            </div>
          )}

          {/* Loading Skeleton */}
          {isBusy && (
            <div className="space-y-2.5 py-2" aria-busy="true">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {isConnecting
                  ? 'Completing Google Drive sign-in...'
                  : isLoadingFile
                    ? 'Reading spreadsheet from Google Drive...'
                    : 'Matching spreadsheet rows against your ledger...'}
              </div>
              {[1, 2, 3, 4, 5, 6].map((idx) => (
                <div
                  key={idx}
                  className="h-11 w-full animate-pulse rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/80"
                />
              ))}
            </div>
          )}

          {/* Loaded Empty State */}
          {workbook && !isBusy && rows.length === 0 && (
            <div className="mx-auto max-w-md py-12 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No financial rows detected in this tab
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Open Column Mapping above to map your Amount, Debit, or Credit column, or
                select another worksheet tab.
              </p>
            </div>
          )}

          {/* Side-by-Side Reconciliation Table */}
          {workbook && !isBusy && rows.length > 0 && (
            <ReconciliationTable
              rows={filteredRows}
              accounts={activeAccounts}
              operatingAccounts={operatingAccounts}
              categoryPrefs={categoryPrefs}
              baseCurrency={baseCurrency}
              fxSnapshot={fxSnapshot}
              autoMapSubcategories={autoMapSubcategories}
              autoMappedCount={autoMappedCount}
              onToggleAutoMapSubcategories={handleToggleAutoMapSubcategories}
              expandedRowId={expandedRowId}
              onToggleExpand={setExpandedRowId}
              onToggleApprove={toggleRowApproved}
              onToggleSelectAllVisible={handleToggleSelectAllVisible}
              onUpdateProposed={updateRowProposed}
              onRevertField={revertSingleFieldToApp}
            />
          )}
        </div>

        {/* Sticky Footer + Explicit Confirmation Gate */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 px-4 py-3 sm:px-6">
          {showConfirmBar ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-700 dark:text-slate-200 space-y-0.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Confirm alignment changes to Save N Know
                </div>
                <div className="text-slate-600 dark:text-slate-400">
                  {counts.approvedAdds > 0
                    ? `Add ${approvedBreakdown.addExpenses} expenses, ${approvedBreakdown.addIncomes} incomes, ${approvedBreakdown.addTransfers} transfers`
                    : 'No new additions'}
                  {' · '}
                  {counts.approvedUpdates > 0
                    ? `Update ${approvedBreakdown.updateExpenses} expenses, ${approvedBreakdown.updateIncomes} incomes, ${approvedBreakdown.updateTransfers} transfers`
                    : 'No existing updates'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowConfirmBar(false)}
                  disabled={isApplying}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmApply}
                  disabled={isApplying}
                  style={{ backgroundColor: 'var(--app-accent)' }}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {isApplying ? 'Applying Changes...' : 'Confirm & Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {counts.approvedAdds} additions · {counts.approvedUpdates} updates ·{' '}
                {counts.total - counts.totalApproved} skipped
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={counts.totalApproved === 0 || isBusy || isApplying}
                  onClick={() => setShowConfirmBar(true)}
                  style={{ backgroundColor: 'var(--app-accent)' }}
                  className="rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                >
                  Review & Apply ({counts.totalApproved})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
