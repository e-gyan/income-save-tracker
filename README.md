# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.2.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Unified "Transactions" Terminology & "Recent Transactions By" Grouping (`DashboardView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`, `AccountsView.tsx`, `BudgetsView.tsx`, `AnalyticsView.tsx`, `SettingsView.tsx`, `RecordCard.tsx`, `CleanSheetModal.tsx`)**:
  - Standardized all transaction lists, period group bars (`Recent Transactions By` with `All`, `Week`, `Month`, `Year`), search inputs, empty states, and modals to use **Transactions** / **Transaction** terminology across the entire application.
- **Budgets & Goals Foreign Currency Conversion Rate Display & Backend FX Intelligence (`BudgetsView.tsx`, `budgetCalculations.ts`, `server.ts`)**:
  - **Live FX Conversion Rate Display**: Whenever a Budget or Goal is configured with a currency different from the defined app currency (`budgetCurrency !== baseCurrency`), the Create/Edit form, Budget/Goal card, and Budget/Goal Details Pop-Up Modal display the live 2-point floating conversion rate (`1 {BudgetCurrency} = {rate} {AppCurrency}`) alongside the App Currency Equivalent.
  - **Backend Multi-Currency Intelligence (`POST /api/fx/convert-intelligence` & `POST /api/budgets/evaluate`)**: Seamlessly converts expenses, account transfers, and savings split allocations across currencies with 2-point floating precision.
- **Automatic Recreation for Weekly, Monthly & Yearly Budgets/Goals; Custom Period Recreation Definition (`BudgetsView.tsx`, `budgetCalculations.ts`, `server.ts`)**:
  - **Automatic Cycle Recreation**: Budgets and Goals with `weekly`, `monthly`, or `yearly` date periods automatically recreate when each cycle ends (`autoRecreate = true`).
  - **Custom Period Recreation Definition**: Only when `periodType === 'custom'` is the user required to define whether the custom period should auto-recreate (`autoRecreate`) and for how many days (`recreateDays`). Expired custom budgets without auto-recreation are moved to the **Expired / Disabled** tab.
- **Delete Action Notification & Confirmation Across the App (`RecordCard.tsx`, `BudgetsView.tsx`, `SettingsView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`)**:
  - Every delete button across Income, Expense, and Transfer transaction pop-ups, Budget & Goal detail modals, and Settings (Savings Vaults, Categories, Subcategories, Income Sources, Origins, Account Types, and Defined Deductions) notifies the user of the impact of their action and requires explicit confirmation (`Confirm Delete` / `Yes` vs. `Cancel` / `No`) before deletion.
- **Seamless Textbox Modification in Settings (`SettingsView.tsx`, `server.ts`)**:
  - Draft-buffered textboxes for Savings Vault names and rates allow smooth typing (including spaces, decimals, and clearing fields) without cursor jumps or state resets, backed by `POST /api/settings/modify`.
  - Inline textbox rename/edit for Expense Subcategories (preserving custom colors), Income Sources, Sources/Origins, and Account Types.
- **Offline Logged-In Data Continuity & Instant Zero-Wait Refresh (`firebase.ts`, `firestoreService.ts`, `server.ts`, `App.tsx`, `Sidebar.tsx`)**:
  - Cloud Firestore `persistentLocalCache` and UID-scoped cloud snapshot hydration (`savenknow_authenticated_user_session`) keep signed-in users' data available offline and on instant browser refresh without dropping to the guest ledger.

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
│   ├── App.tsx                         # Root state orchestrator with synchronous frame-0 cloud cache hydration
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + persisted auth session
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # Functional color themes + Accounting Figure Color presets & CSS variable engine
│   │   ├── calculations.ts             # Allocation engine, 2dp currency reconciliation & savings vault logic
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   ├── components/
│   │   ├── RecordCard.tsx              # Unified 2x2 Transaction Card & Income/Expense/Transfer Pop-Up Modals with delete confirmation
│   │   ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view with FX conversion display, auto-recreation & delete confirmation
│   │   ├── DashboardView.tsx           # Overview with Recent Transactions By grouping and Allocation Flow
│   │   ├── IncomeLogView.tsx           # Income & Deductions recording, Recent Transactions By grouping & edit/delete modals
│   │   ├── FlexibleExpensesView.tsx    # Expenses workspace with Recent Transactions By grouping & category breakdowns
│   │   ├── AccountsView.tsx            # Operating Accounts, Savings Vaults & Recent Transactions By account history
│   │   └── SettingsView.tsx            # Seamless textbox editing, Subcategory Move tool, Vaults, Deductions & File Import
├── server.ts                           # Express server (port 3000) + /api/fx/convert-intelligence + /api/settings/modify + /api/budgets/*
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.2.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `server.ts` | Added `POST /api/fx/convert-intelligence` for 2-point floating multi-currency conversion across expenses, transfers, and savings allocations; added `POST /api/settings/modify` to normalize and persist Settings textbox modifications; updated `POST /api/budgets/evaluate` and `POST /api/budgets/reconcile` for automatic recreation on weekly/monthly/yearly periods and live FX conversion rate reporting. |
| `src/lib/budgetCalculations.ts` | Added `conversionRateToBase` and `inverseConversionRateToBase` to `EvaluatedBudget`, enabled automatic cycle recreation for `weekly`, `monthly`, and `yearly` periods while requiring explicit recreation definition only for `custom` periods, and enhanced multi-currency conversion in `getExpenseAmountInCurrency` and `getTransferAmountInCurrency`. |
| `src/components/BudgetsView.tsx` | Added live foreign currency conversion rate display (`1 {Currency} = {Rate} {AppCurrency}`) in the form, card footer, and details pop-up when budget currency differs from app currency; made weekly/monthly/yearly recreation automatic and required manual recreation definition only for custom periods; added delete action notification and confirmation inside the budget/goal pop-up modal; updated records terminology to transactions. |
| `src/components/RecordCard.tsx` | Added delete action notification and confirmation (`Confirm Delete` / `Cancel`) inside `ExpenseDetailPopupModal`, `TransferDetailPopupModal`, and `IncomeDetailPopupModal`, and updated default card fallback label to `Transaction`. |
| `src/components/SettingsView.tsx` | Added draft-buffered state for Savings Vault name and rate textboxes (`vaultDraftNames`, `vaultDraftRates`) for seamless typing without cursor jumps, added inline textbox editing and delete confirmation notifications for Expense Subcategories, Income Sources, Sources/Origins, and Account Types backed by `POST /api/settings/modify`, and updated records terminology to transactions. |
| `src/components/DashboardView.tsx` | Changed `Group Recent Records By` to `Recent Transactions By` and updated `records` labels to `transactions`. |
| `src/components/IncomeLogView.tsx` | Added `Recent Transactions By` label and updated search, list headers, count badges, and edit/delete modal titles from `Records` to `Transactions`. |
| `src/components/FlexibleExpensesView.tsx` | Added `Recent Transactions By` label to the period filter bar and wired expense pop-up deletion to the inline confirmation flow. |
| `src/components/AccountsView.tsx` | Updated `Group Account History By` to `Recent Transactions By` and replaced `records` labels with `transactions`. |
| `src/components/AnalyticsView.tsx` | Updated empty-state copy from `records` to `transactions`. |
| `src/components/CleanSheetModal.tsx` | Updated reset modal description from `income records` to `income transactions`. |
| `src/lib/calculations.ts` | Bumped `APP_VERSION` to `4.2.0` and added the `v4.2.0` release log entry. |
| `README.md` | Documented `v4.2.0` architecture, multi-currency FX intelligence, budget period recreation rules, delete confirmations, Settings textbox architecture, and per-file GitHub commit summaries. |
