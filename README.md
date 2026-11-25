# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.15.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, Google Drive spreadsheet alignment & side-by-side reconciliation, file import & ingestion, expense intelligence, biometric app security, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **High-Volume Scalability & Responsive Performance (`RecordCard.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `AccountsView.tsx`, `AnalyticsView.tsx`, `firestoreService.ts`, `dateFilters.ts`, `App.tsx`)**:
  - Eliminated O(N²) lookup scans via precomputed O(1) `Map` indexes for accounts and subcategory colors, Schwartzian-transform timestamp sorting, `React.memo` transaction cards, `useDeferredValue` non-blocking search filtering, `useTransition` view/date switches, lazy expanded-only deduction calculations on income rows, and progressive pagination across Expenses, Income, Account History, and Analytics feeds.
  - Coalesced `localStorage` cache writes (with `pagehide` flush), debounced backend snapshot synchronization, chunked parallel import saves, and chunked Firestore `writeBatch` operations keep interactions responsive regardless of record count.
- **Targeted Transaction Restore to `23/11/2026` (`nov24Restore.ts`, `firestoreService.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Accurately detects **only** transactions imported on `24/11/2026` (via Google Drive Alignment or Settings File Import) while preserving all manually recorded transactions and all records from `23/11/2026` or earlier.
  - Provides a dismissible workspace banner and a dedicated **Restore Transactions to 23/11/2026** review & confirmation card in Settings that removes detected `24/11/2026` imported records atomically across Firestore (`writeBatch`), local cache, and backend cloud snapshot.
- **Custom Date Filter (`dd/mm/yyyy`) for Transactions & Analytics (`dateFilters.ts`, `Header.tsx`, `Navigation.tsx`, `Sidebar.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `appStateRestore.ts`, `App.tsx`)**:
  - Adds a **Custom Dates** filter mode supporting single-day, closed-range, and open-ended date selections formatted strictly as `dd/mm/yyyy`, with matching income/expense/transfer counts, inline quick-access buttons on transaction views, and full session/Back-Forward restoration.
- **Redesigned Analytics: Accounts Income vs. Expenses & Key Financial Performance (`AnalyticsView.tsx`)**:
  - Excludes the legacy **Cash Flow Allocation & Trend Visuals** section and introduces **Accounts: Income & Expenses** (filterable across All / Operating / Savings Vaults, with paired comparative Inflow vs. Outflow bars, Direct Income & Expense totals, Net Flow, Expense Ratio, and current native/base balance) alongside **Key Financial Performance Metrics** (Savings Rate, Expense-to-Income Ratio, Net Retention, Avg Daily & Monthly Spend, Operating Cash Runway, Top Cost Driver, Peak Expense/Income with `dd/mm/yyyy` dates, Budget Adherence, Net Vault Growth, and Account Transfer volume).
- **Auto-Map Subcategories & Side-by-Side Reconciliation Table (`ReconciliationTable.tsx`, `DriveAlignmentModal.tsx`, `driveAlignment.ts`, `SettingsView.tsx`, `server.ts`)**:
  - Places each imported spreadsheet record directly side-by-side with its matched existing app record, with an **Auto-map subcategories** toggle, highlighted field diffs, per-field **Keep App** reverts, inline editing, and batch approval.
- **App-Wide `dd/mm/yyyy` Date Standardization & Full Session State Restoration (`dateFilters.ts`, `appStateRestore.ts`, `App.tsx`)**:
  - Unified `dd/mm/yyyy` display across all views and History API + session storage restoration of active tabs, date filters (including custom ranges), per-tab scroll positions, and active workflows.
- **Google Drive Read-Only Alignment, Multi-Record Batch Entry, All-Vault Debiting & Biometric Lock (`firebase.ts`, `deductionIntelligence.ts`, `biometricAuth.ts`, `server.ts`)**:
  - Read-only Google Drive spreadsheet sync, atomic multi-record income/expense batch recording, individual Savings Vault debiting and Group Credit + Earnings, prospective vault rate updates, and opt-in Android/PWA WebAuthn biometric app lock.

---

## 2. System Architecture

```text
├── public/
│   ├── icon.svg                        # Brand vector icon
│   ├── pwa-192x192.png                 # Android home screen icon (192x192, purpose: any)
│   ├── pwa-512x512.png                 # Android splash & Play/launcher icon (512x512, purpose: any)
│   ├── pwa-maskable-512x512.png        # Android adaptive maskable icon (512x512, purpose: maskable)
│   └── apple-touch-icon.png            # iOS home screen touch icon (180x180)
├── src/
│   ├── index.css                       # Tailwind CSS v4 styles, theme variables & smooth input interaction rules
│   ├── App.tsx                         # Root state orchestrator, useTransition routing, custom date state, Nov 23 restore, History API restoration & atomic persistence
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (IncomeReceipt, FlexibleExpense, Accounts, Budgets, UserSettings)
│   ├── lib/
│   │   ├── nov24Restore.ts             # Targeted detector for 24/11/2026 Drive/File imported transactions for safe restore to 23/11/2026
│   │   ├── appStateRestore.ts          # Navigation history snapshots (including customDateRange), per-tab scroll persistence & workflow restoration helpers
│   │   ├── dateFilters.ts              # Calendar presets, CustomDateRange support, Schwartzian arrival sorting & dd/mm/yyyy formatters
│   │   ├── firebase.ts                 # Firebase Auth (read-only Google Drive in-memory OAuth token) & persistent Firestore cache
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, chunked writeBatch deletes, coalesced localStorage & debounced backend snapshot sync
│   │   ├── driveAlignment.ts           # Drive URL parser, subcategory-to-category resolver, reconciliation types & dd/mm/yyyy diff engine
│   │   ├── biometricAuth.ts            # WebAuthn Android/Platform Biometric enrollment & verification + backup passcode
│   │   ├── colorThemes.ts              # 11 color palettes, blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, snapshot-locked vault splits, 2dp FX & account summaries
│   │   ├── deductionIntelligence.ts    # Full-vault debit planning, Top-5 expense learning & deduction rule suggestions
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── ReconciliationTable.tsx     # Side-by-side Imported vs. Existing table with Auto-map subcategories toggle, dd/mm/yyyy dates & approval checkboxes
│       ├── DriveAlignmentModal.tsx     # Full-screen Google Drive alignment workspace with persisted session state, sheet tabs & column mapper
│       ├── BiometricLockScreen.tsx     # Full-screen Android/PWA biometric & backup passcode unlock gate
│       ├── Navigation.tsx              # Mobile date presets + desktop/mobile Custom Date Range Bar (dd/mm/yyyy) + 5-item BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, custom date label & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with Date Filter (including Custom From/To inputs), Display Mode, Color Themes & 7 views
│       ├── IncomeLogView.tsx           # Paginated income feed with deferred search, lazy expanded-only deduction math, Custom Dates trigger & batch queue
│       ├── FlexibleExpensesView.tsx    # Paginated expenses feed with O(1) lookup maps, deferred search, Custom Dates trigger & batch recording
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated All-Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated & Allocation Flow
│       ├── AnalyticsView.tsx           # Accounts Income vs. Expenses, Key Financial Performance Metrics, Category/MoM insights & paginated recent expenses
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds, Group Credit + Earnings & paginated Account History modal
│       ├── RecordCard.tsx              # React.memo transaction card rendering dd/mm/yyyy dates & detail pop-up modals
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── RevisionHistoryView.tsx     # Semantic version log & rollback view with dd/mm/yyyy timestamps
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar)
│       └── SettingsView.tsx            # Settings customization, File Import, Google Drive Alignment, Restore to 23/11/2026 card & Biometric Lock
├── server.ts                           # Express server (port 3000) + /api/drive/* + /api/import/parse + /api/transfers/* + /api/settings/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.15.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/lib/nov24Restore.ts` | Created targeted detector (`findNov24ImportedTransactions`) identifying only income, expense, and transfer records imported on `24/11/2026` (via Google Drive Alignment or File Import) to restore transactions cleanly to `23/11/2026`. |
| `src/lib/dateFilters.ts` | Added `'custom'` time range preset and `CustomDateRange` (`startDate`/`endDate`) filtering with `dd/mm/yyyy` range labels, and optimized `sortRecordsByArrivalTime` using a Schwartzian transform to eliminate repeated date parsing during sorting. |
| `src/lib/appStateRestore.ts` | Persisted and sanitized `customDateRange` inside navigation history snapshots and per-user session state so custom date selections survive reloads and Back/Forward navigation. |
| `src/lib/firestoreService.ts` | Added chunked `writeBatch` deletion (`batchDeleteTransactions`) for atomic bulk purges, coalesced `localStorage` writes with `pagehide` flushing, and debounced backend cloud snapshot synchronization to prevent UI blocking under high record volume. |
| `src/components/RecordCard.tsx` | Wrapped `RecordCard` in `React.memo` to prevent unnecessary card re-renders across large transaction feeds. |
| `src/components/FlexibleExpensesView.tsx` | Replaced O(N²) per-row scans with O(1) `accountByIdMap` and `subcategoryColorMap`, added `useDeferredValue` search, memoized period grouping, progressive 50-item pagination, and custom date range filtering with quick trigger. |
| `src/components/IncomeLogView.tsx` | Added `useDeferredValue` search, O(1) `accountByIdMap`, memoized period grouping, progressive 40-item pagination, lazy expanded-only deduction calculations, and inline Custom Dates trigger. |
| `src/components/AccountsView.tsx` | Optimized Account History modal with O(1) account/color maps, memoized period grouping, and progressive 40-item pagination per section. |
| `src/components/Header.tsx` | Added `customDateRange` label display (`dd/mm/yyyy`) across desktop/mobile filter controls and bumped `APP_VERSION` to `4.15.0`. |
| `src/components/Navigation.tsx` | Added a responsive desktop and mobile Custom Date Range Bar with `From`/`To` date pickers, `dd/mm/yyyy` previews, `Single Day` and `Reset` actions, and live matching transaction counts. |
| `src/components/Sidebar.tsx` | Added inline `From`/`To` custom date inputs with `dd/mm/yyyy` labels inside the Date Filter drawer section when Custom Dates is active. |
| `src/components/SettingsView.tsx` | Added the **Restore Transactions to 23/11/2026** card under Import Transactions & Files with source breakdown (Drive vs. File Import), expandable record preview (`dd/mm/yyyy`), and confirmed atomic purge. |
| `src/components/AnalyticsView.tsx` | Removed **Cash Flow Allocation & Trend Visuals**; added **Accounts: Income & Expenses** (with All/Operating/Vaults filter and comparative bars) and **Key Financial Performance Metrics** (ratios, burn velocity, cash runway, top cost driver, peak transactions, budget adherence, and vault growth); added O(1) lookups and progressive pagination to Recent Expense Transactions. |
| `src/App.tsx` | Wired `customDateRange` filtering & History API restoration, `useTransition` for smooth tab/date switching, chunked parallel import writes, `handleRestoreToNov23` with dismissible workspace banner, and passed `budgets` and `customDateRange` to child views. |
| `src/lib/calculations.ts` | Bumped `APP_VERSION` to `4.15.0` and prepended the `v4.15.0` release log entry. |
| `README.md` | Updated enterprise product capabilities, system architecture, and `v4.15.0` per-file GitHub commit change log. |
