# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.7.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Backend-Powered Automated Manual Transfers to Savings Vaults (`server.ts`, `deductionIntelligence.ts`, `AccountsView.tsx`, `FloatingQuickActions.tsx`, `App.tsx`)**:
  - Direct checkbox right beneath the transfer `Amount` input asking users whether to **Transfer to Savings Vaults**.
  - When selected, the transfer amount is automatically distributed across every configured Savings Vault by its percentage rate (with 2dp FX conversion and per-vault inclusion toggles).
  - Applies matched automated vault debit expenses for each distributed vault (matching prior vault-debit expenses per vault), with master toggle, per-vault debit selection, inline cause/category/amount/note editing, and optional `+ Set Debit` configuration.
  - Handled on the backend via `POST /api/transfers/automate-savings-vaults` with atomic batch persistence via `handleAddTransfers` and `handleAddExpenses`.
- **Dynamic Top-5 Frequent Expense Suggestions & Smooth Editing (`deductionIntelligence.ts`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`, `index.css`)**:
  - Dynamically learns top-5 recurring category/subcategory expense patterns from recorded history using frequency + recency weighting, dominant operating account detection, and median recent typical amounts.
  - Selecting a suggestion populates account, currency, category, subcategory, and amount while keeping `To / Cause` and `Notes` blank for clean contextual entry.
- **Date-Responsive Expenses "By Category" View with Backend Aggregation (`FlexibleExpensesView.tsx`, `App.tsx`, `server.ts`)**:
  - `By Category` mode filters live against both global header/sidebar `timeRange` presets and `Recent Transactions By` (`All | Week | Month | Year`), excludes vault credits from spend totals, and syncs grouped category totals with `POST /api/expenses/by-category`.
- **Editable Automated Savings Vault Debits & Refined Income Form Order (`IncomeLogView.tsx`, `FloatingQuickActions.tsx`)**:
  - Users opting into automated savings vault debits can toggle individual vaults and edit each planned debit inline (`To / Cause`, `Category`, `Subcategory`, `Debit Amount`, `Notes`).
- **Collapsed-by-Default Analytics Workspace & Expanded Color/Display Automation (`AnalyticsView.tsx`, `colorThemes.ts`, `Sidebar.tsx`, `SettingsView.tsx`)**:
  - Analytics sections start collapsed by default; includes `Rose`, `Fuchsia`, `Slate`, `Cyan`, and `Sky` palettes without descriptive labels and `6:45 AM/PM` + `Auto` system display modes.

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
│   ├── App.tsx                         # Root state orchestrator, batch handleAddTransfers/handleAddExpenses & 6:45 AM/PM + Auto theme engine
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (ThemeMode, AppColorTheme, UserSettings, IncomeReceipt, FlexibleExpense, Accounts, Budgets)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # 11 color palettes (incl. Rose, Fuchsia, Slate, Cyan, Sky), blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, 2dp FX reconciliation, account summaries & manual vault transfer accumulation
│   │   ├── deductionIntelligence.ts    # Manual transfer vault distribution & debit planning, Top-5 expense learning & vault debit intelligence
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar (omits Budgets & Settings)
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, clean Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Income recording, draft-smooth deductions & editable vault debits
│       ├── FlexibleExpensesView.tsx    # Multi-item expense recording, blank To/Notes suggestions & date-filtered By Category sync with backend
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated (deductions + manual vault transfers) & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds with vault distribution & auto-debit automation
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar) with magnified icon+count tabs & FX conversion
│       └── SettingsView.tsx            # Settings customization with 4-option Display Mode & clean Color Palette swatches
├── server.ts                           # Express server (port 3000) + /api/transfers/automate-savings-vaults + /api/expenses/* + /api/fx/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.7.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `server.ts` | Added `POST /api/transfers/automate-savings-vaults` endpoint to distribute manual transfers across Savings Vaults by configured rate with 2dp FX conversion and generate matched vault-debit expense payloads per vault. |
| `src/lib/deductionIntelligence.ts` | Added `ManualTransferVaultShare`, `buildManualTransferSavingsVaultPlan`, and `requestBackendManualTransferAutomation` to compute proportional vault transfer shares and automated per-vault debit plans with backend sync and offline fallback. |
| `src/App.tsx` | Added atomic batch `handleAddTransfers` with collision-free IDs and sequential timestamps, and passed `onAddTransfers` to `AccountsView` and `FloatingQuickActions`. |
| `src/components/AccountsView.tsx` | Added the `"Transfer to Savings Vaults"` checkbox directly beneath `Amount` in the Transfer Funds drawer with per-vault rate distribution toggles, automated vault debit toggle, inline debit editing, `+ Set Debit` support, and backend-synced execution. |
| `src/components/FloatingQuickActions.tsx` | Added the `"Transfer to Savings Vaults"` checkbox directly beneath `Amount` in the Quick Transfer modal with per-vault rate distribution, automated vault debit selection/editing, and backend-synced execution. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.7.0`. |
| `README.md` | Updated enterprise architecture documentation and added the `v4.7.0` per-file GitHub commit change log. |
