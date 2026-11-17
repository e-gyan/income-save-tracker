# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.4.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Automated Respective Savings Vault Debits After Saving Rate Deduction (`deductionIntelligence.ts`, `IncomeLogView.tsx`, `FloatingQuickActions.tsx`, `SettingsView.tsx`, `server.ts`)**:
  - Added an interactive checkbox workflow right after deducting a saving rate into Savings Vaults (in both `IncomeLogView` Record Income & confirmation modal, `FloatingQuickActions` Quick Income modal, and `SettingsView` default preference) asking users whether to automate vault debit expenses from each respective Savings Vault.
  - Matches each funded Savings Vault against its historical vault-debit expense records (`vaultAction !== 'credit'`), previews the matched vault causes and amounts (with per-vault opt-out toggles), converts multi-currency amounts cleanly via 2-point FX rates, and creates editable/deletable vault debit expense transactions automatically on save.
- **Unified Savings Accumulated Including Manual Account-to-Savings-Vault Transfers (`calculations.ts`, `DashboardView.tsx`, `AnalyticsView.tsx`, `AccountsView.tsx`, `SavingsDetailView.tsx`)**:
  - Added `getManualSavingsVaultTransfersBreakdown` to account for both **previous (historical)** and **new** manual transfers from operating/non-vault accounts into Savings Vaults (plus direct Net-Income-to-Savings-Vault routes, netted against any vault-to-operating returns) inside **Savings Accumulated** metrics across Overview (`DashboardView`), Analytics (`AnalyticsView` KPI, quarter/month tables, pie & pillar breakdowns), Accounts (`AccountsView`), Savings Detail (`SavingsDetailView`), and Monthly Summary (`calculateMonthlySummary`).
- **Resilient Cloud Firestore Long-Polling & Offline Persistence (`firebase.ts`, `firestoreService.ts`)**:
  - Configured `initializeFirestore` with `experimentalForceLongPolling: true`, `persistentLocalCache` (`persistentMultipleTabManager()`), and global `setLogLevel('silent')` on both `firebase/app` and `firebase/firestore` so Cloud Run / iframe proxy environments bypass WebChannel 10-second timeouts and seamlessly operate in offline cache mode.
- **Static Top Header + 6-Icon Non-Scrolling BottomMenuBar + Full Icon-and-Name Sidebar (`Navigation.tsx`, `App.tsx`, `Sidebar.tsx`, `Header.tsx`)**:
  - **6-Icon Non-Scrolling BottomMenuBar**: Displays `Overview`, `Income`, `Expenses`, `Budgets`, `Accounts`, and `Analytics` in a fixed 6-column layout with large clickable icons.
  - **Sidebar with Icons & Names**: The top-right `Sidebar` drawer displays all 7 workspace views with icons, names, count badges, account auth, and theme controls.
- **Budgets & Goals & Delete-Only Income Deduction Expenses (`BudgetsView.tsx`, `RecordCard.tsx`, `EditExpenseModal.tsx`)**:
  - Magnified icon + count toggle tabs, live FX conversion rates, automatic weekly/monthly/yearly recurrence, and strict delete-only protection on income-deduction expenses (`exp_ded_`, `exp_cut_`).

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
│   ├── App.tsx                         # Root state orchestrator, static top Header, scrollable workspace, BottomMenuBar & vault-debit wiring
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (UserSettings, IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer, FinancialBudget)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # Functional color themes + Accounting Figure Color presets & CSS variable engine
│   │   ├── calculations.ts             # Allocation engine, 2dp FX reconciliation, account summaries & manual vault transfer accumulation
│   │   ├── deductionIntelligence.ts    # Learned deduction suggestions + buildAutomatedSavingsVaultDebitPlan & payload generator
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 6-icon non-scrolling BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with all 7 workspace views (icons + names), badges & auth
│       ├── IncomeLogView.tsx           # Income recording, Recent Transactions By grouping & automated vault debit checkbox/preview
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Income, Expense, Transfer) with automated vault debit checkbox
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated (deductions + manual vault transfers) & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & pillar metrics reflecting income splits + manual account-to-vault transfers
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, unified Total Savings Accumulated & ledger history
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view with magnified icon+count toggle tabs & FX conversion
│       └── SettingsView.tsx            # Settings customization including autoDebitSavingsVaults default preference
├── server.ts                           # Express server (port 3000) + /api/savings/vault-debit-plan + /api/expenses/* + /api/fx/* + /api/settings/modify
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.4.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/types/finance.ts` | Added optional `autoDebitSavingsVaults?: boolean` preference field to `UserSettings`. |
| `firebase-blueprint.json` | Documented `autoDebitSavingsVaults` on the `UserSettings` schema entity. |
| `src/lib/firestoreService.ts` | Persisted and hydrated `autoDebitSavingsVaults` in `fetchUserSettings` and `saveUserSettings`. |
| `src/lib/deductionIntelligence.ts` | Implemented `buildAutomatedSavingsVaultDebitPlan` and `plannedVaultDebitToExpensePayload` to match each funded Savings Vault against its past vault-debit expenses and produce currency-converted debit expense records. |
| `src/lib/calculations.ts` | Added `autoDebitSavingsVaults: false` default, implemented `getManualSavingsVaultTransfersBreakdown` covering historical and new manual operating-to-vault transfers (and net-to-vault routes), and integrated it into `calculateAccountSummaries` and `calculateMonthlySummary`. |
| `src/App.tsx` | Updated `handleAddIncome` to return the created `IncomeReceipt` and passed `onAddExpenses={handleAddExpenses}` to `IncomeLogView` so automated vault debits persist alongside new income records. |
| `src/components/IncomeLogView.tsx` | Added the "Automate vault debit from respective savings vaults" checkbox with matched per-vault preview and individual vault toggles in both the Record Income form and net transfer confirmation modal. |
| `src/components/FloatingQuickActions.tsx` | Added the automated vault debit checkbox and per-vault preview/execution flow inside the Quick Record Income modal and fixed quick net currency display formatting. |
| `src/components/SettingsView.tsx` | Added the persistent "Automate vault debit from respective savings vaults by default" setting toggle in Net Income & Savings Routing. |
| `src/components/DashboardView.tsx` | Included historical and new manual account-to-savings-vault transfers in Overview `Savings Accumulated` KPI, currency buckets, and clamped Allocation Flow bar widths. |
| `src/components/AnalyticsView.tsx` | Included manual account-to-savings-vault transfers in Analytics `Savings Accumulated`, quarterly/monthly series, currency buckets, and per-vault pillar cards. |
| `src/components/AccountsView.tsx` | Surfaced manual vault transfer count breakdown beneath `Total Savings Accumulated` in Accounts & Transfers. |
| `src/components/SavingsDetailView.tsx` | Included manual account-to-savings-vault transfers in `Total Savings Accumulated` and per-pillar savings totals in Savings Detail. |
| `server.ts` | Added `POST /api/savings/vault-debit-plan` endpoint for backend per-vault debit planning parity. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.4.0`. |
| `README.md` | Updated enterprise architecture documentation and `v4.4.0` per-file GitHub commit change log. |
