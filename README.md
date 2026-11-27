# Save N Know: Financial Allocation and Multi-Account Ledger (`v4.18.0`)

**Save N Know** is an installable Progressive Web App (PWA) for personal and business capital allocation, multi-account ledger tracking, expense budgeting and savings goal management, account-driven FX currency conversion, Google Drive spreadsheet alignment and side-by-side reconciliation, file import and ingestion, expense intelligence, biometric app security, and automated savings vaults. Built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Seamless Performance, Instant Saves, and Fluid Mobile Interactions (`App.tsx`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`, `index.css`)**:
  - Optimistic non-blocking saves update local state and cache immediately while persisting to Cloud Firestore in parallel background operations.
  - Closed global modals unmount completely to avoid background computation, while heavy Quick Record memos run only when their modal is open.
  - Deferred live spend and vault checks (`useDeferredValue`) keep number and text inputs in Expenses and Quick Record responsive without delay or breaks, paired with zero-delay mobile tap and horizontal menu scroll CSS.
- **Today Date Filter and Collapsible-by-Default Analytics (`dateFilters.ts`, `appStateRestore.ts`, `AnalyticsView.tsx`)**:
  - Added **Today** to the date filter presets across Header, Navigation, Sidebar, and session restoration.
  - Made every section in Analytics (including Financial Summary, Accounts: Income and Expenses, and Key Financial Performance Metrics) collapsed by default and expanded on user request.
- **App Assistant Agent with Live Database and Occurrence Intelligence (`appAssistantIntelligence.ts`, `DeductionAgentModal.tsx`, `server.ts`, `App.tsx`)**:
  - Accessible from Quick Record as the primary agent of the app with a minimalist three-tab workspace (**Assistant**, **Insights**, and **Actions**) and live KPI strip (Operating Cash, Savings Vaults, 30-Day Spend, and Budget Health).
  - Evaluates live account balances, budget limits, recurring expense and income occurrences, spending drivers, and deduction patterns to inform, guide, navigate directly to app views, and record entries in one click, with deterministic local database fallback when offline.
- **Accurate Expense Category and Subcategory Synchronization (`calculations.ts`, `server.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Renaming or merging an expense category or subcategory updates all existing flexible expenses, income allocated deductions, defined deduction rules, and budgets using normalized label matching (`and`, spacing, punctuation) and unique subcategory ownership.
  - Prevents phantom duplicate categories from being recreated from historical transactions whose subcategories already belong to a user-defined category in Settings.
  - Persists updated records to Cloud Firestore before saving updated settings so real-time listeners never pair renamed categories with stale expense records.
- **High-Volume Scalability and Responsive Performance (`RecordCard.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `AccountsView.tsx`, `AnalyticsView.tsx`, `firestoreService.ts`, `dateFilters.ts`, `App.tsx`)**:
  - Precomputed O(1) `Map` indexes for accounts and subcategory colors, Schwartzian-transform timestamp sorting, `React.memo` transaction cards, `useDeferredValue` search filtering, `useTransition` view and date switches, lazy expanded-only deduction calculations, and progressive pagination.
  - Coalesced `localStorage` cache writes with `pagehide` flush, debounced backend snapshot synchronization, chunked parallel writes, and chunked Firestore `writeBatch` operations.
- **Custom Date Filter (`dd/mm/yyyy`) for Transactions and Analytics (`dateFilters.ts`, `Header.tsx`, `Navigation.tsx`, `Sidebar.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `appStateRestore.ts`, `App.tsx`)**:
  - Supports single-day, closed-range, and open-ended date selections formatted as `dd/mm/yyyy`, with matching transaction counts and session/Back-Forward restoration.
- **Analytics: Accounts Income vs. Expenses and Key Financial Performance (`AnalyticsView.tsx`)**:
  - Provides **Accounts: Income and Expenses** (filterable across All, Operating, and Savings Vaults) alongside **Key Financial Performance Metrics** (Savings Rate, Expense-to-Income Ratio, Net Retention, Avg Daily and Monthly Spend, Operating Cash Runway, Top Cost Driver, Peak Expense and Income, Budget Adherence, Net Vault Growth, and Account Transfer volume).
- **Auto-Map Subcategories and Side-by-Side Reconciliation (`ReconciliationTable.tsx`, `DriveAlignmentModal.tsx`, `driveAlignment.ts`, `SettingsView.tsx`, `server.ts`)**:
  - Aligns imported spreadsheet rows side-by-side with matched existing records, with an **Auto-map subcategories** toggle, highlighted field diffs, per-field reverts, inline editing, and batch approval.
- **Targeted Transaction Restore (`nov24Restore.ts`, `firestoreService.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Detects imported transactions from `24/11/2026` while preserving manual entries and earlier records, with review and atomic batch restore.
- **Multi-Record Batch Entry, All-Vault Debiting, and Biometric Lock (`firebase.ts`, `deductionIntelligence.ts`, `biometricAuth.ts`, `server.ts`)**:
  - Atomic multi-record income and expense recording, individual Savings Vault debiting, Group Credit and Earnings, prospective vault rate updates, and opt-in WebAuthn biometric app lock.

---

## 2. System Architecture

```text
├── public/
│   ├── icon.svg                        # Brand vector icon
│   ├── pwa-192x192.png                 # Android home screen icon (192x192)
│   ├── pwa-512x512.png                 # Android splash and launcher icon (512x512)
│   ├── pwa-maskable-512x512.png        # Android adaptive maskable icon (512x512)
│   └── apple-touch-icon.png            # iOS home screen touch icon (180x180)
├── src/
│   ├── index.css                       # Tailwind CSS v4 styles, theme variables, and input rules
│   ├── App.tsx                         # Root state orchestrator, category cascade persistence, History API restoration, and Firestore subscriptions
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (IncomeReceipt, FlexibleExpense, Accounts, Budgets, UserSettings)
│   ├── lib/
│   │   ├── calculations.ts             # Allocation engine, effective expense category resolution, snapshot-locked vault splits, 2dp FX, and account summaries
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, chunked writeBatch operations, coalesced localStorage, and debounced cloud snapshot sync
│   │   ├── dateFilters.ts              # Calendar presets, CustomDateRange support, arrival sorting, and dd/mm/yyyy formatters
│   │   ├── appStateRestore.ts          # Navigation history snapshots, per-tab scroll persistence, and workflow restoration helpers
│   │   ├── firebase.ts                 # Firebase Auth (read-only Google Drive in-memory OAuth token) and persistent Firestore cache
│   │   ├── driveAlignment.ts           # Drive URL parser, subcategory-to-category resolver, reconciliation types, and diff engine
│   │   ├── biometricAuth.ts            # WebAuthn platform biometric enrollment, verification, and backup passcode
│   │   ├── colorThemes.ts              # 11 color palettes, blended light canvas tints, and schedule helper
│   │   ├── deductionIntelligence.ts    # Full-vault debit planning, expense learning, and deduction rule suggestions
│   │   ├── appAssistantIntelligence.ts # Live database snapshot, occurrence detection, proactive insights, and local App Assistant engine
│   │   ├── budgetCalculations.ts       # Multi-purpose Budgets and Goals evaluation, FX conversion rates, and recurring period creation
│   │   └── nov24Restore.ts             # Detector for 24/11/2026 Drive and File imported transactions
│   └── components/
│       ├── SettingsView.tsx            # Settings customization, Expense Categories and Subcategories management, File Import, Drive Alignment, and Biometric Lock
│       ├── FlexibleExpensesView.tsx    # Paginated expenses feed with O(1) lookup maps, deferred search, Custom Dates trigger, and batch recording
│       ├── IncomeLogView.tsx           # Paginated income feed with deferred search, lazy deduction math, Custom Dates trigger, and batch queue
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated and Allocation Flow
│       ├── AnalyticsView.tsx           # Accounts Income vs. Expenses, Key Financial Performance Metrics, Category and MoM insights, and recent expenses
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds, Group Credit and Earnings, and Account History modal
│       ├── BudgetsView.tsx             # Multi-purpose Budgets and Goals view
│       ├── SavingsDetailView.tsx       # Savings pillars and sub-bucket distribution across deductions and manual vault transfers
│       ├── RecordCard.tsx              # Memoized transaction card rendering dd/mm/yyyy dates and detail pop-up modals
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Transfer Fund, Income, Expense) and App Assistant launcher
│       ├── DeductionAgentModal.tsx     # Redesigned minimalist App Assistant workspace (Assistant chat, Insights, and Actions)
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, active date label, and drawer trigger
│       ├── Navigation.tsx              # Mobile date presets, Custom Date Range Bar (dd/mm/yyyy), and 5-item BottomMenuBar
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with Date Filter, Display Mode, Color Themes, and navigation views
│       ├── ReconciliationTable.tsx     # Side-by-side Imported vs. Existing table with Auto-map subcategories toggle and batch approval
│       ├── DriveAlignmentModal.tsx     # Full-screen Google Drive alignment workspace with persisted session state and column mapper
│       ├── BiometricLockScreen.tsx     # Full-screen biometric and backup passcode unlock gate
│       └── RevisionHistoryView.tsx     # Semantic version log and rollback view
├── server.ts                           # Express server (port 3000) serving Vite middleware and API routes (/api/categories/*, /api/drive/*, /api/import/*, /api/fx/*, /api/ai/*)
├── firebase-blueprint.json             # Firestore entity blueprint schema
├── firestore.rules                     # Cloud Firestore security rules
└── README.md                           # Enterprise documentation and GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.18.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/App.tsx` | Converted income, batch income, and expense saves to optimistic non-blocking persistence with parallel Firestore writes for settings and batch transfers; conditionally mounted EditExpenseModal, DeductionAgentModal, and CleanSheetModal only when open so closed modals use zero CPU. |
| `src/components/FlexibleExpensesView.tsx` | Deferred live budget and account spend checks via `useDeferredValue` and removed per-keystroke vault history scans on recipient typing so entering figures and text stays instant without delay or breaks. |
| `src/components/FloatingQuickActions.tsx` | Guarded heavy transfer, vault, and frequent-expense memos by active modal state and deferred live spend checks so browsing menus and typing in Quick Record remain fluid. |
| `src/components/AnalyticsView.tsx` | Wrapped the top Financial Summary KPI grid in a collapsible card and set Financial Summary, Accounts: Income and Expenses, and Key Financial Performance Metrics to collapsed by default so all Analytics elements expand only on user request. |
| `src/lib/dateFilters.ts` | Added the `Today` (`today`) preset to `TimeRangePreset`, `REDESIGNED_DATE_FILTER_OPTIONS`, and `isDateInPreset`. |
| `src/lib/appStateRestore.ts` | Added `today` to `VALID_RANGES` so Today filter selections restore cleanly across reloads and navigation. |
| `src/index.css` | Added `-webkit-tap-highlight-color: transparent` on interactive controls and smooth touch horizontal scroll rules for fluid mobile menu navigation. |
| `src/lib/calculations.ts` | Bumped `APP_VERSION` to `4.18.0` and prepended the `v4.18.0` release log entry. |
| `README.md` | Updated enterprise product documentation and `v4.18.0` per-file GitHub commit change summary using `and` consistently. |
