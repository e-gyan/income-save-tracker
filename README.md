# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v3.7.0`)

**Save N Know** is an enterprise-grade personal and business capital allocation, multi-account ledger, recurring & custom subcategory budgeting, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Record Grouping by Week, Month, or Year (`dateFilters.ts`, `DashboardView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`, `AccountsView.tsx`, `BudgetsView.tsx`)**:
  - Group transaction records by **All** (ungrouped), **Week**, **Month**, or **Year** across Overview, Income, Expenses, Account History, and Budget Transactions.
- **Unified `dd/mm/yyyy` Date Format & Arrival-Time Ordering (`dateFilters.ts`, `firestoreService.ts`)**:
  - Every displayed date across the application uses the `dd/mm/yyyy` format (`formatDateDDMMYYYY` and `formatDateTimeDDMMYYYY`).
  - Records are arranged chronologically as they come in by exact timestamp (`createdAt` / `date` via `sortRecordsByArrivalTime`, newest incoming records first).
- **Cross-Board Expense Transaction Editing (`EditExpenseModal.tsx`, `server.ts`, `App.tsx`)**:
  - Edit any expense transaction (both standalone recorded expenses and income deduction expenses) from **Overview**, **Expenses**, **Budgets**, **Accounts**, and **Analytics**, backed by `/api/expenses/update` and Firestore persistence.
- **Automated Savings Vault Debit Learning (`deductionIntelligence.ts`, `server.ts`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`, `App.tsx`)**:
  - Learns exclusively from past expenses debited from a **Savings Vault** (`isSavingsVaultAccount(acc, settings)` and `vaultAction !== 'credit'`) via `learnSavingsVaultDebitAccount` and `/api/expenses/vault-debit-learn`.
  - Automatically routes or suggests the matching Savings Vault debit (`accountId` + `vaultAction: 'debit'`) as new expenses come in.
- **Move Existing Subcategory to Another Category (`SettingsView.tsx`, `EditExpenseModal.tsx`, `FlexibleExpensesView.tsx`, `server.ts`, `App.tsx`)**:
  - Move any existing subcategory from one category to another category via `/api/categories/move-subcategory` and `handleMoveSubcategory`, automatically updating `settings.expenseCategoryPreferences` (preserving subcategory color), `settings.customCuts`, `expenses`, `incomes`, and `budgets`.
- **Up-to-Date Reactive Settings (`SettingsView.tsx`)**:
  - Keeps all Settings state synced with live changes to `settings` and `expenses`, including Expense Categories & Subcategories, Defined Deductions, Savings Vaults, Income Sources, Sources (Origins), and Account Types.
- **Mobile-Scrollable Pop-Up Modals**:
  - All pop-up modals (`EditExpenseModal`, `BudgetsView`, `AccountsView`, `IncomeLogView`, `FloatingQuickActions`, `DeductionAgentModal`, `ConfirmDeleteModal`, `CleanSheetModal`) use `max-h-[88dvh] sm:max-h-[90vh]` with scrollable containers (`overflow-y-auto overscroll-contain`) and sticky headers/action bars so buttons are always easy to reach on mobile screens.

---

## 2. System Architecture

```text
├── src/
│   ├── App.tsx                         # Root state orchestrator, cross-board expense editing, vault debit auto-routing & subcategory move handler
│   ├── index.css                       # Global Tailwind v4 typography, theme variables, text wrapping & surface rules
│   ├── types/
│   │   └── finance.ts                  # Enterprise domain models (IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer, FinancialBudget, UserSettings)
│   ├── lib/
│   │   ├── currencyService.ts          # Real-time FX market rate sync, account native currency helpers & 2-point floating conversion engine
│   │   ├── calculations.ts             # Account-native & system-base ledger engine, fixed-deduction FX conversion & subcategory color engine
│   │   ├── budgetCalculations.ts       # Budget period window resolver, dd/mm/yyyy dates, arrival-time sorting & spend checks
│   │   ├── deductionIntelligence.ts    # Pattern-learning engine for deductions & Savings Vault debit learning (learnSavingsVaultDebitAccount)
│   │   ├── colorThemes.ts              # Persistent functional color palettes & CSS custom property injector
│   │   ├── dateFilters.ts              # dd/mm/yyyy formatter, arrival-time sorting (sortRecordsByArrivalTime) & Week/Month/Year record grouping
│   │   ├── firebase.ts                 # Firebase Auth (Google Sign-In) & Firestore initialization with error diagnostics
│   │   └── firestoreService.ts         # Real-time Firestore subscriptions sorted by arrival time & legacy pre-defined seed stripper
│   └── components/
│       ├── Header.tsx                  # Compact mobile-first static top bar (h-12 sm:h-14) with Save N Know branding, date filters & Menu button
│       ├── Navigation.tsx              # Primary navigation metadata ("Income" label) & collapsible mobile 2-column date filter grid
│       ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login details, Views, Date Filter & Theme
│       ├── EditExpenseModal.tsx        # Global mobile-scrollable modal to edit any expense transaction across all boards & move subcategories
│       ├── BudgetsView.tsx             # Minimalist clickable budget cards & mobile-scrollable Pop-Up Budget Options Modal with grouped transactions & Edit
│       ├── DashboardView.tsx           # Overview workspace with All/Week/Month/Year grouping, dd/mm/yyyy dates & direct Expense Editing
│       ├── IncomeLogView.tsx           # Income workspace with All/Week/Month/Year grouping, arrival-time order, dd/mm/yyyy dates & scrollable modals
│       ├── FlexibleExpensesView.tsx    # Expense recorder with automated Vault Debit learning, All/Week/Month/Year grouping, Edit & Move Subcategory
│       ├── AccountsView.tsx            # Multi-account ledger with grouped Account History, Edit Expense buttons & mobile-scrollable modals
│       ├── AnalyticsView.tsx           # MoM category bar charts, breakdowns & collapsible Expense Transactions list with direct Edit
│       ├── SettingsView.tsx            # Up-to-date Settings with Subcategory Move tool, Income Sources/Origins/Account Types, Vaults & Deductions
│       ├── DeductionAgentModal.tsx     # Smart deduction suggestion modal with mobile-scrollable layout
│       ├── FloatingQuickActions.tsx    # Mobile-scrollable Quick Record modals with automated Savings Vault debit learning & dd/mm/yyyy dates
│       ├── WrapSelect.tsx              # Accessible custom select component with gentle multi-line option wrapping
│       ├── ConfirmDeleteModal.tsx      # Mobile-scrollable confirmation modal for destructive actions
│       └── CleanSheetModal.tsx         # Mobile-scrollable reset modal
├── server.ts                           # Express server (port 3000) + /api/fx/rates + /api/import/parse + /api/budgets/evaluate + /api/expenses/vault-debit-learn + /api/expenses/update + /api/categories/move-subcategory
├── firebase-blueprint.json             # Canonical Firestore entity schema & collection path definitions
├── firestore.rules                     # Zero-trust user-isolated Firestore security rules
├── render.yaml                         # Render cloud deployment blueprint
└── CHANGELOG.md                        # Semantic versioning release log
```

---

## 3. Component and Module Reference

| Component / Module | Responsibility |
| :--- | :--- |
| `src/lib/dateFilters.ts` | Provides `formatDateDDMMYYYY`, `formatDateTimeDDMMYYYY`, `sortRecordsByArrivalTime`, and `groupRecordsByPeriod` (`none`, `week`, `month`, `year`). |
| `src/lib/deductionIntelligence.ts` | Implements `learnSavingsVaultDebitAccount` to learn exclusively from past expenses debited from a Savings Vault (`vaultAction !== 'credit'`) and suggest/automate vault debits for incoming expenses. |
| `src/components/EditExpenseModal.tsx` | Mobile-scrollable modal allowing users to edit any expense transaction across all boards, apply learned Savings Vault debits, and move an existing subcategory to another category. |
| `src/components/SettingsView.tsx` | Reactive settings workspace keeping Categories, Subcategories, Defined Deductions, Savings Vaults, Income Sources, Origins, and Account Types up to date, plus a dedicated Move Subcategory tool. |
| `server.ts` | Backend API endpoints including `/api/expenses/vault-debit-learn`, `/api/expenses/update`, and `/api/categories/move-subcategory`. |

---

## 4. GitHub File Change Summary (`v3.7.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/lib/dateFilters.ts` | Added `formatDateDDMMYYYY`, `formatDateTimeDDMMYYYY`, `sortRecordsByArrivalTime`, and `groupRecordsByPeriod` (`none` / `week` / `month` / `year`) for unified `dd/mm/yyyy` dates and record grouping. |
| `src/lib/deductionIntelligence.ts` | Added `learnSavingsVaultDebitAccount` to learn exclusively from past Savings Vault debit expenses (`vaultAction !== 'credit'`) and auto-suggest vault debits on incoming expenses. |
| `src/lib/budgetCalculations.ts` | Updated budget period dates to `dd/mm/yyyy` and sorted matched budget expenses by arrival time (`sortRecordsByArrivalTime`). |
| `src/lib/firestoreService.ts` | Updated real-time Firestore listeners (`subscribeToIncomes`, `subscribeToFlexibleExpenses`, `subscribeToTransfers`) to sort records by arrival timestamp (`sortRecordsByArrivalTime`). |
| `server.ts` | Added backend routes `POST /api/expenses/vault-debit-learn`, `POST /api/expenses/update`, and `POST /api/categories/move-subcategory`. |
| `src/components/EditExpenseModal.tsx` | Created global mobile-scrollable `EditExpenseModal` component supporting cross-board expense editing, automated Savings Vault debit suggestions, `dd/mm/yyyy` dates, and inline subcategory moving. |
| `src/App.tsx` | Wired `EditExpenseModal`, `handleUpdateExpense` (for standalone and income deduction expenses), `handleMoveSubcategory`, and automated Savings Vault debit routing in `handleAddExpenses`. |
| `src/components/FlexibleExpensesView.tsx` | Added `All / Week / Month / Year` record grouping, `dd/mm/yyyy` timestamps, arrival-time sorting, automated Savings Vault debit learning on draft rows, `Edit` buttons on expenses, and inline subcategory move controls. |
| `src/components/FloatingQuickActions.tsx` | Added automated Savings Vault debit learning to Quick Expense, `dd/mm/yyyy` date preview, and mobile-scrollable containers (`max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto`) across all Quick Record modals. |
| `src/components/DashboardView.tsx` | Added `All / Week / Month / Year` grouping, arrival-time sorting, `dd/mm/yyyy` dates, and a collapsible Recent Expenses section with `Edit` buttons. |
| `src/components/BudgetsView.tsx` | Added `dd/mm/yyyy` dates on budget cards and modal, `All / Week / Month / Year` grouping for budget transactions, `Edit` buttons on transactions, and a mobile-scrollable budget options modal. |
| `src/components/AccountsView.tsx` | Added `All / Week / Month / Year` grouping in Account History modal, `dd/mm/yyyy` timestamps, arrival-time sorting, `Edit` buttons on account expenses, and mobile-scrollable account modals. |
| `src/components/IncomeLogView.tsx` | Added `All / Week / Month / Year` record grouping, arrival-time sorting, `dd/mm/yyyy` timestamps, and mobile-scrollable modal containers. |
| `src/components/AnalyticsView.tsx` | Sorted analyzed expenses by arrival time and added a collapsible Expense Transactions section with `dd/mm/yyyy` timestamps and direct `Edit` buttons. |
| `src/components/SettingsView.tsx` | Synced all Settings state reactively with `settings` and `expenses`, added Move Subcategory to Another Category controls, and added management for Income Sources, Origins, and Account Types. |
| `src/components/ConfirmDeleteModal.tsx` | Updated modal container to be mobile-scrollable (`max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain`). |
| `src/components/CleanSheetModal.tsx` | Updated modal container to be mobile-scrollable (`max-h-[88dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain`). |
| `src/components/DeductionAgentModal.tsx` | Updated modal container to `max-h-[88dvh] sm:max-h-[90vh]` for mobile scrolling. |
| `README.md` | Updated enterprise architecture documentation and per-file GitHub commit summary. |

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
