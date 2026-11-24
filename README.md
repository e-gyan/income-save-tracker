# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.14.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, Google Drive spreadsheet alignment & side-by-side reconciliation, file import & ingestion, expense intelligence, biometric app security, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Auto-Map Subcategories & Side-by-Side Reconciliation Table (`ReconciliationTable.tsx`, `DriveAlignmentModal.tsx`, `driveAlignment.ts`, `SettingsView.tsx`, `server.ts`)**:
  - Dedicated `ReconciliationTable` rendered immediately after a spreadsheet is selected, placing each **Imported Record (Spreadsheet)** directly side-by-side with its matched **Existing App Record**.
  - Includes an **Auto-map subcategories** toggle switch in the Reconciliation Table that automatically assigns the parent category defined in Settings whenever an imported record carries a known subcategory (and cleanly restores original values when toggled off), with live auto-mapping on inline subcategory edits and in Settings File Import (`POST /api/import/parse` and `POST /api/drive/reconcile`).
  - Visually highlights field-level differences in **Amounts** (with numeric variance and live 2dp FX previews), **Dates**, **Categories / Subcategories**, **Accounts**, **Payees / Sources**, and **Notes**, with one-click **Keep App** field reverts, expandable inline editing, and individual plus select-all approval checkboxes.
- **App-Wide `dd/mm/yyyy` Date Standardization (`dateFilters.ts`, `driveAlignment.ts`, all Views & Modals)**:
  - Unified `formatDateDDMMYYYY` and `formatDateTimeDDMMYYYY` formatting applied consistently across transaction cards, Reconciliation Table rows and diffs, Settings import previews and release logs, Revision History, Savings allocations, Account notes, Budgets, Analytics, and Income/Expense queues.
- **Full Session, Navigation & Workflow State Restoration (`appStateRestore.ts`, `App.tsx`, `SettingsView.tsx`, `DriveAlignmentModal.tsx`)**:
  - Integrates browser History (`pushState` / `replaceState` / `popstate`) with session/local storage so pressing **Back / Forward**, switching tabs, reloading, or resuming the PWA restores the exact previous view, active date filter, per-tab scroll position, open Drive Alignment modal, and all performed workflow actions (selected rows, inline adjustments, field reverts, Auto-map toggle, filters, search queries, and file import previews).
- **Google Drive Read-Only Spreadsheet Connection (`firebase.ts`, `DriveAlignmentModal.tsx`, `SettingsView.tsx`, `App.tsx`)**:
  - Connects to Google Drive with read-only permission (`drive.readonly`) via Firebase Google Auth with strict in-memory token caching (cleared on sign-out, never stored in browser storage).
  - Pre-filled with the target Google Drive spreadsheet link beside File Import in Settings (`POST /api/drive/read-spreadsheet` & `POST /api/drive/reconcile`), supporting **Excel (`.xlsx` / `.xls`)**, **CSV / TSV**, and multi-tab **Google Sheets** with worksheet tab switching and live Column Mapping.
- **Reliable Multi-Record Income & Expense Batch Recording (`App.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `FloatingQuickActions.tsx`)**:
  - Multi-item expense batches and multi-entry income queues save atomically with collision-proof IDs, functional React state updaters, awaited `Promise.all` Firestore persistence, explicit account preservation, row validation, and a one-tap `Show All Dates` action.
- **Complete Individual Savings Vault Debiting & Group Credit + Earnings (`deductionIntelligence.ts`, `server.ts`, `AccountsView.tsx`)**:
  - Debits every active individual Savings Vault specified by the user and enables Group Credit mode with exact remaining committed principal tracking and optional commitment earnings (`Cause Earnings`).
- **Backend-Managed Prospective Savings Vault Percentages (`server.ts`, `calculations.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - `POST /api/settings/vault-rates/update` freezes historical income splits while applying updated vault percentages prospectively to new income records.
- **PWA / Android Biometric App Lock (`biometricAuth.ts`, `BiometricLockScreen.tsx`, `server.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Opt-in WebAuthn platform biometric gate with offline PWA verification, salted SHA-256 backup passcode, and automatic resume lock.

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
│   ├── App.tsx                         # Root state orchestrator, History API + session restoration, BiometricLockScreen gate & atomic persistence
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (IncomeReceipt, FlexibleExpense, Accounts, Budgets, UserSettings)
│   ├── lib/
│   │   ├── appStateRestore.ts          # Navigation history snapshots, per-tab scroll persistence & workflow state restoration helpers
│   │   ├── dateFilters.ts              # Local calendar presets, arrival sorting & unified dd/mm/yyyy date/time formatters
│   │   ├── firebase.ts                 # Firebase Auth (including read-only Google Drive in-memory OAuth token) & persistent Firestore cache
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, settings persistence & backend snapshot sync
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
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Single & multi-entry income batch queue, all-vault automated debits & dd/mm/yyyy display
│       ├── FlexibleExpensesView.tsx    # Multi-item expense batch recording with validation, account hydration & date-filtered By Category sync
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated All-Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & snapshot-locked pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds & Group Credit + Earnings workflow
│       ├── RecordCard.tsx              # Transaction detail card rendering dd/mm/yyyy dates & snapshot-locked vault split shares
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── RevisionHistoryView.tsx     # Semantic version log & rollback view with dd/mm/yyyy timestamps
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar)
│       └── SettingsView.tsx            # Settings customization, persisted File Import + Google Drive Alignment, subcategory matching & Biometric Lock
├── server.ts                           # Express server (port 3000) + /api/drive/* + /api/import/parse + /api/transfers/* + /api/settings/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.14.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/lib/appStateRestore.ts` | Added navigation history snapshot builders/parsers (`buildHistoryStateSnapshot`, `parseHistoryStateSnapshot`), aligned restorable tabs with `ActiveTab`, and provided per-user navigation and workflow storage helpers. |
| `src/components/ReconciliationTable.tsx` | Added the **Auto-map subcategories** switch toolbar with live auto-mapped count and inline `Auto-mapped` row cue; standardized imported, existing, and editor dates to `dd/mm/yyyy`. |
| `src/components/DriveAlignmentModal.tsx` | Wired `autoMapSubcategories` toggle and live in-place re-mapping (plus inline subcategory edit auto-mapping), sent `expenseCategoryPreferences` to `/api/drive/reconcile`, persisted/restored full Drive session state with all performed user actions, and formatted modified dates and search matching as `dd/mm/yyyy`. |
| `src/components/SettingsView.tsx` | Passed `expenseCategoryPreferences` to `/api/import/parse` with client-side subcategory-to-category resolution, persisted/restored Settings import preview and Drive modal state across navigation returns, and formatted all displayed dates as `dd/mm/yyyy`. |
| `src/App.tsx` | Wired full state restoration using History API (`pushState`/`replaceState`/`popstate`), per-tab scroll position preservation, `visibilitychange`/`pagehide` flushing, and synced Drive modal open state across Back/Forward returns. |
| `src/components/RevisionHistoryView.tsx` | Standardized revision timestamps to `dd/mm/yyyy · HH:mm` via `formatDateTimeDDMMYYYY`. |
| `src/components/SavingsDetailView.tsx` | Standardized savings allocation dates to `dd/mm/yyyy` via `formatDateDDMMYYYY`. |
| `src/components/IncomeLogView.tsx` | Standardized queued income receipt dates to `dd/mm/yyyy` via `formatDateDDMMYYYY`. |
| `src/components/AccountsView.tsx` | Standardized generated vault debit/credit note dates to `dd/mm/yyyy` via `formatDateDDMMYYYY`. |
| `src/lib/calculations.ts` | Bumped `APP_VERSION` to `4.14.0` and added `v4.14.0` release log entry. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.14.0`. |
| `README.md` | Updated enterprise component architecture and `v4.14.0` per-file GitHub commit change log. |
