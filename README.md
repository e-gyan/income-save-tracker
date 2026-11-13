# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v3.9.0`)

**Save N Know** is an enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Unified 2×2 Record Card & Pop-Up Details Architecture (`RecordCard.tsx`, `server.ts`, `DashboardView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`, `AccountsView.tsx`, `BudgetsView.tsx`, `AnalyticsView.tsx`)**:
  - **2×2 Card Face Contract**:
    - **Top Left**: **Subcategory** with its intuitive subcategory color indicator (`resolveIntuitiveSubcategoryColor`). Category and subcategory are never doubled on the card face.
    - **Bottom Left (Beneath Subcategory)**: **Account** name (or `Source → Destination` for transfers).
    - **Top Right**: **Amount**, color-coded by record type: **Emerald** (`text-emerald-600`) for Income, **Red** (`text-rose-600`) for Expense, and **Blue** (`text-blue-600`) for Transfer.
    - **Bottom Right (Beneath Amount)**: **Date only** (`dd/mm/yyyy`). Time (`hh:mm`) is omitted from the card face and shown inside the pop-up modal.
  - **Strict Separation of Titles from Notes & Descriptions**: Notes and descriptions are never used as the display name or title of any card or record on the frontend or backend (`/api/import/parse`, `/api/expenses/update`, `/api/records/format-card`).
  - **Click-to-Expand Pop-Up Modal**: Clicking any record card opens a mobile-scrollable **Record Details Pop-Up Modal** (`ExpenseDetailPopupModal`, `IncomeDetailPopupModal`, `TransferDetailPopupModal`) displaying the full `dd/mm/yyyy, hh:mm` timestamp, Category, Subcategory (with color badge), Account, Recipient/Source, Notes/Description, Deductions breakdown, and **Edit** / **Delete** actions.
- **Multi-Purpose Budgets & Goals Engine (`finance.ts`, `budgetCalculations.ts`, `BudgetsView.tsx`, `server.ts`, `App.tsx`)**:
  - **Expense-Linked Budgets (`purposeType: 'budget'`)**: Track spending limits across single or multiple expense subcategories and optional account scope with real-time spend warnings and residual calculations.
  - **Transfer & Savings-Linked Goals (`purposeType: 'goal'`)**: Track progress toward a target amount for a specific cause (`goalCause`) funded via account transfers (`AccountTransfer`) and/or automated savings allocations (`getSavingsSplitTransfers`).
- **Auto-Recreation After Expiry & Configurable Recreation Days (`budgetCalculations.ts`, `BudgetsView.tsx`, `server.ts`, `App.tsx`)**:
  - Users can specify whether a budget or goal automatically recreates after its date period expires (`autoRecreate: boolean`) and for how many days (`recreateDays: number`). Expired non-recreating items are isolated in the **Expired / Disabled** tab.
- **Record Grouping by Week, Month, or Year (`dateFilters.ts`)**:
  - Group transaction records by **All**, **Week**, **Month**, or **Year** across Overview, Income, Expenses, Account History, and Budget/Goal Transactions.

---

## 2. System Architecture

```text
├── src/
│   ├── App.tsx                         # Root state orchestrator, budget/goal reconciliation, cross-board expense/income editing & deletion
│   ├── index.css                       # Global Tailwind v4 typography, theme variables, text wrapping & surface rules
│   ├── types/
│   │   └── finance.ts                  # Enterprise domain models (IncomeReceipt, FlexibleExpense, AccountTransfer, FinancialBudget, UserSettings)
│   ├── lib/
│   │   ├── currencyService.ts          # Real-time FX market rate sync, account native currency helpers & 2-point floating conversion engine
│   │   ├── calculations.ts             # Account-native & system-base ledger engine, savings split transfers & subcategory color engine
│   │   ├── budgetCalculations.ts       # Multi-purpose Budget & Goal evaluator, auto-recreation rollover (recreateDays) & expired isolation engine
│   │   ├── deductionIntelligence.ts    # Pattern-learning engine for deductions & Savings Vault debit learning (learnSavingsVaultDebitAccount)
│   │   ├── colorThemes.ts              # Persistent functional color palettes & CSS custom property injector
│   │   ├── dateFilters.ts              # dd/mm/yyyy formatter, arrival-time sorting (sortRecordsByArrivalTime) & Week/Month/Year record grouping
│   │   ├── firebase.ts                 # Firebase Auth (Google Sign-In) & Firestore initialization with error diagnostics
│   │   └── firestoreService.ts         # Real-time Firestore subscriptions & persistence
│   └── components/
│       ├── RecordCard.tsx              # Unified 2x2 Record Card component & mobile-scrollable Income/Expense/Transfer Pop-Up Detail Modals
│       ├── Header.tsx                  # Compact mobile-first static top bar (h-12 sm:h-14) with Save N Know branding, date filters & Menu button
│       ├── Navigation.tsx              # Primary navigation metadata ("Income" label) & collapsible mobile 2-column date filter grid
│       ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login details, Views, Date Filter & Theme
│       ├── EditExpenseModal.tsx        # Global mobile-scrollable modal to edit any expense transaction across all boards & move subcategories
│       ├── BudgetsView.tsx             # Multi-purpose Budgets, Goals & Expired/Disabled tabs with 2x2 RecordCard transaction history
│       ├── DashboardView.tsx           # Overview workspace with 2x2 RecordCards, subcategory color bars & pop-up detail modals
│       ├── IncomeLogView.tsx           # Income workspace with 2x2 RecordCards & interactive Income Details Pop-Up Modal (Deductions, Edit, Delete)
│       ├── FlexibleExpensesView.tsx    # Expense workspace with 2x2 RecordCards, subcategory color indicators & Expense Details Pop-Up Modal
│       ├── AccountsView.tsx            # Multi-account ledger with 2x2 RecordCards for Income, Expenses & Transfers in Account History
│       ├── AnalyticsView.tsx           # MoM category bar charts, breakdowns & 2x2 RecordCards in Expense Transactions list
│       ├── SettingsView.tsx            # Settings with Subcategory Move tool, Income Sources/Origins/Account Types, Vaults & Deductions
│       ├── DeductionAgentModal.tsx     # Smart deduction suggestion modal with mobile-scrollable layout
│       ├── FloatingQuickActions.tsx    # Mobile-scrollable Quick Record modals with automated Savings Vault debit learning & dd/mm/yyyy dates
│       ├── WrapSelect.tsx              # Accessible custom select component with gentle multi-line option wrapping
│       ├── ConfirmDeleteModal.tsx      # Mobile-scrollable confirmation modal for destructive actions
│       └── CleanSheetModal.tsx         # Mobile-scrollable reset modal
├── server.ts                           # Express server (port 3000) + /api/records/format-card + /api/import/parse + /api/expenses/update + /api/budgets/*
├── firebase-blueprint.json             # Canonical Firestore entity schema & collection path definitions
├── firestore.rules                     # Zero-trust user-isolated Firestore security rules
├── render.yaml                         # Render cloud deployment blueprint
└── CHANGELOG.md                        # Semantic versioning release log
```

---

## 3. Component and Module Reference

| Component / Module | Responsibility |
| :--- | :--- |
| `src/components/RecordCard.tsx` | Implements `<RecordCard />` (Top-Left: Subcategory with color dot; Bottom-Left: Account; Top-Right: Emerald/Red/Blue Amount; Bottom-Right: `dd/mm/yyyy` date) and `<ExpenseDetailPopupModal />`, `<IncomeDetailPopupModal />`, `<TransferDetailPopupModal />` (showing `dd/mm/yyyy, hh:mm`, full metadata, and Edit/Delete actions). |
| `src/components/IncomeLogView.tsx` | Renders income records using `<RecordCard />` and opens a pop-up modal containing `dd/mm/yyyy, hh:mm`, Source/Origin, interactive Defined Deductions with subcategory colors, Net Income routing, Edit, and Delete. |
| `src/components/FlexibleExpensesView.tsx` | Renders all expense records (both Cards and Grouped views) using `<RecordCard />` and `<ExpenseDetailPopupModal />` without doubling category/subcategory or using notes/descriptions as titles. |
| `server.ts` | Provides `POST /api/records/format-card` for canonical backend record card formatting and ensures `/api/import/parse` and `/api/expenses/update` never fall back to `notes` or `description` as record titles. |

---

## 4. GitHub File Change Summary (`v3.9.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `server.ts` | Updated `/api/import/parse` and `/api/expenses/update` so notes and descriptions are never used as record titles (`clientOrSource`, `recipient`, or `subcategory`), and added `POST /api/records/format-card` returning the canonical 2×2 card payload and `dd/mm/yyyy, hh:mm` pop-up metadata. |
| `src/components/RecordCard.tsx` | Created unified `<RecordCard />` component (Top-Left Subcategory + color dot, Bottom-Left Account, Top-Right Emerald/Red/Blue Amount, Bottom-Right `dd/mm/yyyy` date) and mobile-scrollable `<ExpenseDetailPopupModal />`, `<IncomeDetailPopupModal />`, and `<TransferDetailPopupModal />` showing `dd/mm/yyyy, hh:mm` and Edit/Delete controls. |
| `src/components/FlexibleExpensesView.tsx` | Replaced inline-expanding expense cards in Cards and Grouped views with `<RecordCard />` and `<ExpenseDetailPopupModal />`, and ensured `handleSubmitBatch` never uses notes as record descriptions. |
| `src/components/IncomeLogView.tsx` | Replaced inline-expanding income cards with `<RecordCard />` and a mobile-scrollable Income Details Pop-Up Modal displaying `dd/mm/yyyy, hh:mm`, Source/Notes, Defined Deductions with subcategory colors, Edit, and Delete. |
| `src/components/DashboardView.tsx` | Replaced Recent Income and Recent Expenses rows with `<RecordCard />` and wired `<IncomeDetailPopupModal />` and `<ExpenseDetailPopupModal />`. |
| `src/components/AccountsView.tsx` | Replaced Income, Expense/Vault Debit/Credit, and Transfer rows in the Account Ledger History modal with `<RecordCard />` and wired `<IncomeDetailPopupModal />`, `<ExpenseDetailPopupModal />`, and `<TransferDetailPopupModal />`. |
| `src/components/BudgetsView.tsx` | Replaced Goal transfer history rows and Budget expense history rows in the Budget/Goal Options modal with `<RecordCard />`, `<ExpenseDetailPopupModal />`, and `<TransferDetailPopupModal />`. |
| `src/components/AnalyticsView.tsx` | Replaced Section 7 Expense Transactions rows with `<RecordCard />` and `<ExpenseDetailPopupModal />`. |
| `src/components/FloatingQuickActions.tsx` | Updated Quick Expense creation so `description` uses `subLabel || catLabel` (never `notes`) and resolves subcategory color accurately. |
| `src/components/EditExpenseModal.tsx` | Updated expense editing so `description` uses `cleanSub || cleanCategory` (never `notes`) and resolves subcategory color accurately. |
| `src/App.tsx` | Connected `onDeleteExpense` and `onDeleteIncome` callbacks to `DashboardView`, `BudgetsView`, and `AnalyticsView` for pop-up record deletion and aligned subcategory color resolution on imported expenses. |
| `README.md` | Documented the unified 2×2 `<RecordCard />` architecture, Pop-Up Record Details Modals, and per-file GitHub change log. |

---

## 5. Local Development and Production Deployment

```bash
# Install dependencies
npm install

# Run development server on port 3000
npm run dev

# Type-check and build production bundle
npm run lint
npm run build
```
