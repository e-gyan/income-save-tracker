# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.5.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **5-Option BottomMenuBar with Sizable Icons & Labels + Sidebar Budgets (`Navigation.tsx`, `Sidebar.tsx`)**:
  - **BottomMenuBar**: Displays `Overview`, `Income`, `Expenses`, `Accounts`, and `Analytics` in a fixed 5-column non-scrolling bar, omitting `Budgets` and `Settings`, with generous icons and concise view names positioned directly beneath each icon.
  - **Sidebar**: Retains all 7 workspace views (`Overview`, `Income`, `Expenses`, `Budgets`, `Accounts`, `Analytics`, `Settings`) with icons, names, alert/count badges, account authentication, and theme settings.
- **Top-5 Frequent Expenses Intelligence in Expense Recording (`deductionIntelligence.ts`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`)**:
  - Removed `"Suggested from Your History"` from Income recording flows (`IncomeLogView` and Quick Record Income) so Income deductions use user-defined Settings rules cleanly.
  - Replaced static `"Quick Cause"` presets in `FlexibleExpensesView` (and added inside `FloatingQuickActions` Quick Expense) with dynamic **Suggested from Your History (Top 5)** frequent-expense shortcuts ranked by occurrence frequency and recency, enabling one-tap population or multi-row addition of recurring expenses (cause/recipient, category, subcategory, account, currency, and typical amount).
- **Automated Respective Savings Vault Debits After Saving Rate Deduction (`deductionIntelligence.ts`, `IncomeLogView.tsx`, `FloatingQuickActions.tsx`, `SettingsView.tsx`, `server.ts`)**:
  - Interactive checkbox workflow right after deducting a saving rate into Savings Vaults asking users whether to automate vault debit expenses from each respective Savings Vault, matching past vault-debit expense records with per-vault toggles and FX conversion.
- **Unified Savings Accumulated Including Manual Account-to-Savings-Vault Transfers (`calculations.ts`, `DashboardView.tsx`, `AnalyticsView.tsx`, `AccountsView.tsx`, `SavingsDetailView.tsx`)**:
  - Accounts for both previous and new manual transfers from operating accounts into Savings Vaults (and direct Net-Income-to-Vault routes) across all Savings Accumulated KPIs and pillar views.
- **Resilient Cloud Firestore Long-Polling & Offline Persistence (`firebase.ts`, `firestoreService.ts`)**:
  - Configured `initializeFirestore` with `experimentalForceLongPolling: true`, `persistentLocalCache` (`persistentMultipleTabManager()`), and silent SDK logging for reliable offline-capable operation.

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
│   │   ├── deductionIntelligence.ts    # learnTopFrequentExpenses (Top-5 recurring expenses), buildAutomatedSavingsVaultDebitPlan & deduction learning
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar (omits Budgets & Settings)
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with all 7 workspace views (including Budgets & Settings), badges & auth
│       ├── IncomeLogView.tsx           # Income recording (Settings-defined deductions only), Recent Transactions & automated vault debit preview
│       ├── FlexibleExpensesView.tsx    # Multi-item expense recording with Top-5 frequent history tap-to-add shortcuts & vault cause tracking
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Transfer, Defined-only Income, Top-5 frequent Expense shortcuts)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated (deductions + manual vault transfers) & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & pillar metrics reflecting income splits + manual account-to-vault transfers
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, unified Total Savings Accumulated & ledger history
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar) with magnified icon+count tabs & FX conversion
│       └── SettingsView.tsx            # Settings customization including autoDebitSavingsVaults default preference
├── server.ts                           # Express server (port 3000) + /api/savings/vault-debit-plan + /api/expenses/* + /api/fx/* + /api/settings/modify
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.5.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/components/Navigation.tsx` | Omitted `budgets` from `BOTTOM_NAV_ITEMS` (keeping it in `NAV_ITEMS` for `Sidebar`), updated `BottomMenuBar` to a 5-column layout with sizable icons and names beneath, and aligned bar swipe order with `BOTTOM_NAV_ITEMS`. |
| `src/App.tsx` | Updated workspace horizontal swipe navigation to iterate strictly over `BOTTOM_NAV_ITEMS` so sliding between `Expenses` and `Accounts` skips Sidebar-only `Budgets` and `Settings`. |
| `src/lib/deductionIntelligence.ts` | Added `FrequentExpenseSuggestion` interface and `learnTopFrequentExpenses` helper to dynamically rank and return the top 5 most frequent expenses by occurrence count and recency. |
| `src/components/IncomeLogView.tsx` | Removed the `"Suggested from Your History (Tap to Select)"` block and history-inferred suggestion fallback from Income recording so only Settings-defined deductions appear. |
| `src/components/FlexibleExpensesView.tsx` | Replaced static `"Quick Cause"` presets with `"Suggested from Your History"` displaying the top 5 frequent expenses for one-tap expense entry (populating an empty row or appending a new row). |
| `src/components/FloatingQuickActions.tsx` | Restricted Quick Record Income deductions to Settings-defined cuts only and added Top-5 `"Suggested from Your History"` one-tap expense shortcuts to Quick Record Expense. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.5.0`. |
| `README.md` | Updated enterprise architecture documentation and added the `v4.5.0` per-file GitHub commit change log. |
