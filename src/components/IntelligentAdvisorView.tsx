import React, { useState, useMemo, useEffect, useRef } from 'react';
import { UserSettings, IncomeReceipt, FlexibleExpense, FinancialAccount } from '../types/finance.ts';
import { calculateMonthlySummary, calculateAccountSummaries, formatAmount } from '../lib/calculations.ts';
import { getAccessToken, loginWithGoogle } from '../lib/firebase.ts';
import {
  listGoogleDriveFolders,
  listGoogleDriveFiles,
  fetchDriveDocument,
  GoogleDriveFolder,
  GoogleDriveFile,
} from '../lib/driveService.ts';
import {
  ParsedDocument,
  parseUploadedFile,
} from '../lib/documentParser.ts';

interface IntelligentAdvisorViewProps {
  incomes: IncomeReceipt[];
  settings: UserSettings;
  expenses: FlexibleExpense[];
  accounts?: FinancialAccount[];
  currency: string;
}

export const IntelligentAdvisorView: React.FC<IntelligentAdvisorViewProps> = ({
  incomes,
  settings,
  expenses,
  accounts = [],
  currency,
}) => {
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [modelUsed, setModelUsed] = useState<string>('gemini-3.8-flash');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState('');

  // Google Drive Integration States
  const [driveToken, setDriveToken] = useState<string | null>(() => getAccessToken());
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [driveFolders, setDriveFolders] = useState<GoogleDriveFolder[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [manualFolderIdInput, setManualFolderIdInput] = useState<string>('');
  const [driveFolderName, setDriveFolderName] = useState('');
  const [folderFiles, setFolderFiles] = useState<GoogleDriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [driveStatusMessage, setDriveStatusMessage] = useState<string | null>(null);

  // Attached Strategic Documents (from Drive or Local Upload)
  const [attachedDocs, setAttachedDocs] = useState<ParsedDocument[]>([]);
  const [isParsingLocalFile, setIsParsingLocalFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Note Modal/State
  const [isAddingManualNote, setIsAddingManualNote] = useState(false);
  const [manualNoteTitle, setManualNoteTitle] = useState('');
  const [manualNoteSnippet, setManualNoteSnippet] = useState('');

  const summary = calculateMonthlySummary(incomes, settings, expenses);
  const { summaries, totalCashAcrossAllAccounts } = calculateAccountSummaries(
    accounts,
    incomes,
    expenses,
    settings,
    []
  );

  // Check Drive access token on mount
  useEffect(() => {
    const token = getAccessToken();
    setDriveToken(token);
    if (token) {
      loadFolders(token);
    }
  }, []);

  const loadFolders = async (token: string) => {
    setIsLoadingFolders(true);
    setDriveStatusMessage(null);
    try {
      const folders = await listGoogleDriveFolders(token);
      setDriveFolders(folders);
      if (folders.length > 0 && !selectedFolderId) {
        handleSelectFolder(folders[0].id, folders[0].name, token);
      }
    } catch (err: any) {
      console.warn('Could not auto-load Drive folders:', err.message);
      setDriveStatusMessage('Drive authorized. Select a folder or enter a Folder ID below.');
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const handleConnectDrive = async () => {
    setIsConnectingDrive(true);
    setErrorMessage(null);
    try {
      const res = await loginWithGoogle();
      if (res.accessToken) {
        setDriveToken(res.accessToken);
        await loadFolders(res.accessToken);
        setDriveStatusMessage('Connected to Google Drive with read access.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to authenticate with Google Drive.');
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleSelectFolder = async (folderId: string, folderNameStr: string, tokenToUse?: string) => {
    setSelectedFolderId(folderId);
    setDriveFolderName(folderNameStr);
    const token = tokenToUse || driveToken || getAccessToken();
    if (!token || !folderId) return;

    setIsLoadingFiles(true);
    setDriveStatusMessage(`Scanning folder "${folderNameStr}"...`);

    try {
      const files = await listGoogleDriveFiles(folderId, token);
      setFolderFiles(files);

      // Auto-load and parse the top documents from this folder (including .pdf and .epub)
      const parsedList: ParsedDocument[] = [];
      const filesToRead = files.slice(0, 8); // Top files

      for (const f of filesToRead) {
        try {
          const parsed = await fetchDriveDocument(f.id, f.name, f.mimeType, token);
          parsedList.push(parsed);
        } catch (fileErr) {
          console.warn(`Could not extract document ${f.name}:`, fileErr);
        }
      }

      // Merge into attachedDocs (prevent duplicates by ID)
      setAttachedDocs((prev) => {
        const existingIds = new Set(prev.map((d) => d.id));
        const newOnes = parsedList.filter((d) => !existingIds.has(d.id));
        return [...prev, ...newOnes];
      });

      setDriveStatusMessage(
        `Loaded ${parsedList.length} strategic files (.pdf, .epub, docs, sheets) from "${folderNameStr}".`
      );
    } catch (err: any) {
      console.error('Error reading files in folder:', err);
      setDriveStatusMessage(`Unable to read files from folder: ${err.message}`);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Allow manual entry of folder ID (e.g. shared folders)
  const handleLoadManualFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFolderIdInput.trim()) return;
    const cleanId = manualFolderIdInput.trim().replace(/^.*folders\//, '').replace(/\?.*$/, '');
    handleSelectFolder(cleanId, `Folder [${cleanId.slice(0, 8)}...]`);
  };

  // Local File Upload (.pdf, .epub, .txt, .csv, etc.)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsParsingLocalFile(true);
    setErrorMessage(null);

    const newlyParsed: ParsedDocument[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const parsed = await parseUploadedFile(file);
        newlyParsed.push(parsed);
      } catch (err: any) {
        console.error(`Error parsing file ${file.name}:`, err);
        setErrorMessage(`Could not parse ${file.name}: ${err.message}`);
      }
    }

    if (newlyParsed.length > 0) {
      setAttachedDocs((prev) => [...prev, ...newlyParsed]);
    }

    setIsParsingLocalFile(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveDoc = (id: string) => {
    setAttachedDocs((prev) => prev.filter((d) => d.id !== id));
  };

  const handleAddManualNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualNoteTitle.trim()) return;
    const doc: ParsedDocument = {
      id: `note_${Date.now()}`,
      title: manualNoteTitle.trim(),
      fileType: 'text',
      snippet: manualNoteSnippet.trim() || 'Custom financial target and business goal note',
    };
    setAttachedDocs((prev) => [...prev, doc]);
    setManualNoteTitle('');
    setManualNoteSnippet('');
    setIsAddingManualNote(false);
  };

  // Dynamic Inquiries based directly on user's real ledger numbers
  const dynamicSuggestions = useMemo(() => {
    const hasData = incomes.length > 0;
    const avgIncome = hasData ? summary.cumulativeGross / incomes.length : 10000;
    const totalSaved = summary.cumulativeQuarterSavingsAllocated;
    const investmentPortion = totalSaved * 0.2;
    const emergencyPortion = totalSaved * 0.45;

    return [
      {
        id: 'dyn-alloc',
        title: 'Savings Vault Allocation Strategy',
        description: hasData
          ? `Evaluate vault split on ${formatAmount(totalSaved, currency)} saved (${formatAmount(emergencyPortion, currency)} Emergency vs ${formatAmount(investmentPortion, currency)} Investment).`
          : `Model initial allocation structure under ${settings.quarterlyRates.q1TargetRate}% Q1 savings rate.`,
        query: hasData
          ? `Assess the distribution and performance of current net savings of ${formatAmount(totalSaved, currency)} across our savings vaults. In combination with our Google Drive strategic documents (.pdf, .epub, spreadsheets), provide guidance on capital acceleration and reinvestment.`
          : `Provide strategic capital allocation recommendations for setting up our savings vaults with a target Q1 savings rate of ${settings.quarterlyRates.q1TargetRate}%.`,
      },
      {
        id: 'dyn-outflow',
        title: 'Mandatory Deductions and Outflow Audit',
        description: hasData
          ? `Audit ${formatAmount(summary.cumulativeMandatoryDeductions, currency)} mandatory cuts (including 2.5% support) against ${formatAmount(summary.cumulativeFlexibleExpenses, currency)} expenses.`
          : `Optimize mandatory fees (${currency} ${settings.subscriptionFee} subscription, ${currency} ${settings.dataBundleFee} data, 2.5% support) for incoming receipts.`,
        query: hasData
          ? `Audit our cash outflow efficiency: We have incurred ${formatAmount(summary.cumulativeMandatoryDeductions, currency)} in mandatory deductions (subscription: ${currency} ${settings.subscriptionFee}, data bundle: ${currency} ${settings.dataBundleFee}, 2.5% support for others, and project buildings) and spent ${formatAmount(summary.cumulativeFlexibleExpenses, currency)} in flexible expenses. Evaluate whether discretionary outflows threaten liquid reserves based on the budget targets in our attached documents.`
          : `Evaluate whether mandatory deduction settings (${currency} ${settings.subscriptionFee} subscription, ${currency} ${settings.dataBundleFee} data, 2.5% support, and ${settings.projectBuildingsRate}% project buildings) leave adequate disposable liquidity for a baseline receipt of ${formatAmount(avgIncome, currency)}.`,
      },
      {
        id: 'dyn-runway',
        title: 'Multi-Account Cash Forecast and Runway',
        description: `Analyze liquidity across all ${accounts.length} active accounts (${formatAmount(totalCashAcrossAllAccounts, currency)} total cash).`,
        query: `Examine the cash distribution across all accounts: We hold a total cash position of ${formatAmount(totalCashAcrossAllAccounts, currency)} distributed across ${accounts.length} accounts. Forecast runway assuming average monthly expenses and predict cash balance milestones over the next 6 months, taking into account the strategic milestones in our attached documents.`,
      },
      {
        id: 'dyn-quarterly',
        title: 'Quarterly Trajectory and Rate Discipline',
        description: `Compare actual savings rate (${summary.totalSavingsRate.toFixed(1)}%) against target quarterly rates (Q1: ${settings.quarterlyRates.q1TargetRate}%, Q4: ${settings.quarterlyRates.q4TargetRate}%).`,
        query: `Analyze our quarterly savings discipline: Our current effective savings rate is ${summary.totalSavingsRate.toFixed(1)}% compared to governed targets of Q1: ${settings.quarterlyRates.q1TargetRate}%, Q2: ${settings.quarterlyRates.q2TargetRate}%, Q3: ${settings.quarterlyRates.q3TargetRate}%, and Q4: ${settings.quarterlyRates.q4TargetRate}%. Model scenarios for sustaining savings targets as receipt volume scales.`,
      },
    ];
  }, [incomes, summary, settings, accounts, currency, totalCashAcrossAllAccounts]);

  const runAnalysis = async (queryPrompt?: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    const financialState = {
      currency,
      incomesCount: incomes.length,
      cumulativeGross: summary.cumulativeGross,
      cumulativeMandatoryDeductions: summary.cumulativeMandatoryDeductions,
      cumulativeAvailableAfterCuts: summary.cumulativeAvailableAfterCuts,
      cumulativeFlexibleExpenses: summary.cumulativeFlexibleExpenses,
      cumulativeSavingsAllocated: summary.cumulativeQuarterSavingsAllocated,
      effectiveSavingsRate: summary.totalSavingsRate,
      accounts: accounts.map((a) => {
        const sum = summaries.find((s) => s.account.id === a.id);
        return {
          name: a.name,
          type: a.type,
          currentCashBalance: sum?.currentCashBalance || 0,
        };
      }),
      savingsPillarsBreakdown: settings.savingsBuckets.map((b) => ({
        name: b.name,
        percentage: b.percentage,
        amount: summary.cumulativeQuarterSavingsAllocated * (b.percentage / 100),
      })),
      quarterlyTargetRates: settings.quarterlyRates,
      quarterlyAggregates: summary.quarterlyAggregates,
    };

    const driveFolderContext = {
      folderName: driveFolderName.trim() || (selectedFolderId ? 'Google Drive Folder' : undefined),
      documents: attachedDocs
        .filter((d) => !d.base64Data)
        .map((d) => ({
          title: d.title,
          fileType: d.fileType,
          snippet: d.snippet,
        })),
    };

    // Prepare attached documents with native PDF base64 and EPUB text
    const attachedDocumentsPayload = attachedDocs.map((d) => ({
      title: d.title,
      fileType: d.fileType,
      mimeType: d.mimeType,
      snippet: d.snippet,
      base64Data: d.base64Data,
    }));

    try {
      const res = await fetch('/api/ai/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialState,
          driveFolderContext:
            driveFolderContext.documents.length > 0 || driveFolderContext.folderName
              ? driveFolderContext
              : undefined,
          attachedDocuments: attachedDocumentsPayload,
          userQuery: queryPrompt || customQuery || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.analysis) {
        setAnalysisText(data.analysis);
        if (data.modelUsed) setModelUsed(data.modelUsed);
      } else {
        setErrorMessage(data.error || 'Failed to complete financial diagnosis.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error communicating with analysis service.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Model Badge */}
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Intelligent Financial Advisor
            </h1>
            <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
              AI: Gemini 3.8 Flash
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Synthesizes your live multi-account financial ledger with Google Drive folders, uploaded PDFs, and EPUB books for strategic capital allocation.
          </p>
        </div>
      </div>

      {/* Google Drive and Strategic Documents Control Panel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 font-bold text-base">
              📚
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  Folder Context and Document Ingestion
                </h2>
                {driveToken && (
                  <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md">
                    Drive Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Supports Google Drive folders, native .pdf documents, .epub eBooks, spreadsheets, and strategy files.
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {!driveToken ? (
              <button
                type="button"
                onClick={handleConnectDrive}
                disabled={isConnectingDrive}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-2xs flex items-center gap-2"
              >
                <span>{isConnectingDrive ? 'Connecting...' : 'Connect Google Drive'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => driveToken && loadFolders(driveToken)}
                disabled={isLoadingFolders}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
              >
                {isLoadingFolders ? 'Refreshing...' : '↻ Refresh Folders'}
              </button>
            )}

            {/* Direct Upload Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept=".pdf,.epub,.txt,.csv,.json,.doc,.docx"
              className="hidden"
            />
            <button
              type="button"
              disabled={isParsingLocalFile}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border border-indigo-300 bg-indigo-50/70 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 transition-colors shadow-2xs flex items-center gap-1.5"
            >
              <span>{isParsingLocalFile ? 'Parsing File...' : '+ Upload .PDF / .EPUB'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddingManualNote(!isAddingManualNote)}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs"
            >
              {isAddingManualNote ? 'Cancel Note' : '+ Add Note'}
            </button>
          </div>
        </div>

        {/* Drive Folder Selection Row */}
        {driveToken && (
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Google Drive Folder
                </label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => {
                    const selected = driveFolders.find((f) => f.id === e.target.value);
                    if (selected) {
                      handleSelectFolder(selected.id, selected.name);
                    }
                  }}
                  disabled={isLoadingFolders}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-800 focus:outline-hidden shadow-2xs"
                >
                  <option value="">
                    {isLoadingFolders ? 'Loading Drive folders...' : '-- Select a Drive Folder --'}
                  </option>
                  {driveFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      📁 {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <form onSubmit={handleLoadManualFolder} className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Or paste Drive Folder ID"
                    value={manualFolderIdInput}
                    onChange={(e) => setManualFolderIdInput(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-slate-800 focus:outline-hidden shadow-2xs"
                  />
                  <button
                    type="submit"
                    className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors shadow-2xs"
                  >
                    Load
                  </button>
                </form>
              </div>
            </div>

            {driveStatusMessage && (
              <p className="text-[11px] text-indigo-900 bg-indigo-50/80 px-3 py-1.5 rounded-lg border border-indigo-100">
                ℹ️ {driveStatusMessage}
              </p>
            )}
          </div>
        )}

        {/* Attached Documents Context (PDF, EPUB, Docs, Sheets) */}
        {attachedDocs.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Active Strategic Documents and Books in Context ({attachedDocs.length}):
              </span>
              <button
                type="button"
                onClick={() => setAttachedDocs([])}
                className="text-[11px] text-slate-500 hover:text-rose-600 underline"
              >
                Clear all files
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {attachedDocs.map((doc) => {
                const isPdf = doc.fileType === 'pdf';
                const isEpub = doc.fileType === 'epub';
                const badgeClass = isPdf
                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                  : isEpub
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : doc.fileType === 'sheet'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : 'bg-sky-100 text-sky-800 border-sky-200';

                return (
                  <div
                    key={doc.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start justify-between gap-2 shadow-2xs"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}
                        >
                          {doc.fileType.toUpperCase()}
                        </span>
                        <span className="text-xs font-bold text-slate-900 truncate block">
                          {doc.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2">
                        {isPdf
                          ? 'Ingested directly via Gemini 3.8 Flash multimodal reasoning.'
                          : isEpub
                          ? 'Full chapter texts parsed and synthesized.'
                          : doc.snippet}
                      </p>
                      {doc.sizeBytes && (
                        <span className="text-[10px] text-slate-400 font-mono block">
                          {(doc.sizeBytes / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveDoc(doc.id)}
                      className="text-slate-400 hover:text-rose-600 text-base leading-none p-1"
                      title="Remove document from context"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Manual Document / Note Input */}
        {isAddingManualNote && (
          <form
            onSubmit={handleAddManualNote}
            className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5 space-y-3"
          >
            <h3 className="text-xs font-bold text-indigo-950">
              Attach Custom Financial Target or Strategic Note
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <input
                  type="text"
                  required
                  placeholder="Note Title (e.g. Q2 Expansion Plan)"
                  value={manualNoteTitle}
                  onChange={(e) => setManualNoteTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-800 focus:outline-hidden"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  placeholder="Key targets / context (e.g. Target monthly savings GHS 20,000, new project allocation GHS 50,000)"
                  value={manualNoteSnippet}
                  onChange={(e) => setManualNoteSnippet(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-800 focus:outline-hidden"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddingManualNote(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-indigo-900 px-4 py-1 text-xs font-semibold text-white hover:bg-indigo-950"
              >
                Attach to Context
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Dynamic Scenario Cards */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Dynamic Strategic Inquiries (Live Ledger and Documents)
          </h2>
          <span className="text-[11px] text-slate-500 font-mono">
            Derived directly from your active numbers and attached files
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {dynamicSuggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={isLoading}
              onClick={() => runAnalysis(item.query)}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-xs transition-all flex flex-col justify-between group"
            >
              <div>
                <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-900 block transition-colors">
                  {item.title}
                </span>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  {item.description}
                </p>
              </div>
              <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-indigo-700">
                <span>Run diagnostic</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Inquiry Input */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <label className="block text-xs font-bold text-slate-900 mb-1.5">
          Ask Custom Strategic Decision / Forecast Question
        </label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            placeholder="e.g. Review our attached eBook chapter and Drive files: how should we deploy the 20 Investment Use fund over the next 6 months?"
            value={customQuery}
            onChange={(e) => setCustomQuery(e.target.value)}
            className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 focus:border-slate-800 focus:outline-hidden focus:ring-1 focus:ring-slate-800 shadow-2xs"
          />
          <button
            type="button"
            disabled={isLoading}
            onClick={() => runAnalysis()}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 transition-all shadow-2xs whitespace-nowrap"
          >
            {isLoading ? 'Analyzing Ledger and Files...' : 'Run Gemini 3.8 Flash Analysis'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-900 font-medium">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Diagnostic Output */}
      {analysisText && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Financial Diagnosis and Strategic Forecast
              </h2>
              <span className="text-[11px] text-indigo-700 font-mono font-medium">
                Model: {modelUsed} · Integrated Live Ledger, Accounts, and Document Context
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAnalysisText(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-semibold px-2 py-1 rounded"
            >
              Clear
            </button>
          </div>

          <div className="prose prose-slate max-w-none text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans text-slate-800">
            {analysisText}
          </div>
        </div>
      )}
    </div>
  );
};
