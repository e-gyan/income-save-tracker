# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v3.5.0`)

**Save N Know** is an enterprise-grade personal and business capital allocation, multi-account ledger, recurring & custom subcategory budgeting, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Budgets Engine (`BudgetsView.tsx` & `budgetCalculations.ts`)**:
  - **Primary Menu Option (`Budgets`)**: Dedicated workspace accessible from the top-right menu drawer (`Sidebar.tsx`) with live badge counters for total budgets and active threshold/over-limit alerts.
  - **Flexible Period Recurrence**: Define budgets as **Recurring Weekly** (current Monday–Sunday cycle), **Recurring Monthly** (current calendar month), or **Custom Period** (`customStartDate` to `customEndDate`).
  - **Single or Multiple Subcategory Scope**: Assign either a **Single Subcategory** (`scopeType: 'single'`) or **Multiple Subcategories** (`scopeType: 'multiple'`) to each budget, with optional binding to a specific financial account (`accountId`).
  - **Budget Cards with Progress & Residual Visuals**: Each budget card renders real-time spent amount, usage percentage (`%`), residual remaining balance (`residualAmount` and `residualPercentage%`), a segmented **Subcategory Progress + Residual Visual Bar**, and per-subcategory progress breakdown bars.
  - **Real-Time Spend & Account Balance Checks with Alerts**: When recording expenses (`FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`) or transferring funds (`AccountsView.tsx`), the engine checks both matching subcategory budgets and source account balances (including attached Main Accounts for virtual accounts) in real time—displaying color-coded alerts (**Exceeded / Overdrawn** in rose, **Near Limit** in amber, **Within Budget / Sufficient** in emerald).
- **Redesigned Global Date Filters (`dateFilters.ts`, `Header.tsx`, `Navigation.tsx`, `Sidebar.tsx`)**:
  - Standardized date filter presets across desktop pills, tablet dropdown, mobile collapsible grid, and menu drawer:
    - **Last 7 days** (`7d`)
    - **This month** (`this_month`)
    - **Last 31 days** (`31d`)
    - **Last month** (`last_month`)
    - **This year** (`this_year`)
    - **Last 365 days** (`365d`)
    - **Last year** (`last_year`)
    - **All Time** (`all` — reset/full history)
- **Consolidated Mobile-First Header & Top-Right Menu Drawer**:
  - **Streamlined Single Top Bar (`Header.tsx`)**: Compact 56px top bar featuring `Save N Know` and the active workspace section on the left, effective date filter controls in the center/right, and a unified **Top-Right Menu** trigger.
  - **Bundled Top-Right Menu (`Sidebar.tsx`)**: Anchored to the top-right corner, bundling **App Name & Version (`v3.5.0`)**, **Account Login / Sign Out & Session Details**, **Workspace Views Navigation** (including **Budgets**), **Quick Date Filter**, **Appearance & Display Mode (`Light` / `Dark` / `Auto`)**, **8 Color Themes**, and **Reset Sheet**.
- **High-Contrast, Bold Quick Record Experience (`FloatingQuickActions.tsx`)**:
  - Floating `+` trigger and Quick Record action menu (`Transfer Fund`, `Income`, `Expense`, `Deduction Assistant`) with bold SVG icons, tinted icon badges, and real-time Budget & Account spend check alerts inside the Quick Expense modal.
- **Month-over-Month Category Spending Bar Chart (Creeping Expense Tracker)**:
  - Dedicated bar chart visualization in **Analytics & Insights** that compares monthly spending across each expense category and highlights creeping expenses.
- **Global Totals Currency Mode Toggle & Account-Driven FX Engine**:
  - Switch `totalsCurrencyMode` between **Base (`settings.currency`)** and **Account Currency (`original`)** in **Settings → View Totals In** with real-time **2-point floating** market exchange rate conversions (`convertCurrency2dp`).
- **Seamless Backend File Import & Database Synchronization (`POST /api/import/parse`)**:
  - Import `.csv`, `.tsv`, `.json`, `.txt`, `.md`, `.pdf`, or `.bak` backup files directly from **Settings → Import Records & Files**.

---

## 2. System Architecture

```text
├── src/
│   ├── App.tsx                         # Root state orchestrator, Firestore sync (incomes, expenses, accounts, transfers, budgets)
│   ├── index.css                       # Global Tailwind v4 typography, theme variables, text wrapping & surface rules
│   ├── types/
│   │   └── finance.ts                  # Enterprise domain models (IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer, FinancialBudget, UserSettings)
│   ├── lib/
│   │   ├── currencyService.ts          # Real-time FX market rate sync, account native currency helpers & 2-point floating conversion engine
│   │   ├── calculations.ts             # Account-native & system-base ledger engine, virtual/main account rollup & subcategory color engine
│   │   ├── budgetCalculations.ts       # Budget period window resolver, subcategory progress/residual evaluator & real-time spend/account check engine
│   │   ├── deductionIntelligence.ts    # Pattern-learning engine suggesting deductions from historical income & expense data
│   │   ├── colorThemes.ts              # Persistent functional color palettes & CSS custom property injector
│   │   ├── dateFilters.ts              # Redesigned date filters (Last 7 days, This month, Last 31 days, Last month, This year, Last 365 days, Last year, All Time)
│   │   ├── firebase.ts                 # Firebase Auth (Google Sign-In) & Firestore initialization with error diagnostics
│   │   └── firestoreService.ts         # Real-time Firestore subscriptions (including /users/{userId}/budgets) & local cache fallback
│   └── components/
│       ├── Header.tsx                  # Compact 56px top bar with Save N Know branding, redesigned desktop/mobile date filters & Menu button
│       ├── Navigation.tsx              # Collapsible 4-column mobile date filter grid (md:hidden) with full redesigned labels
│       ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login details, Views (with Budgets badge), Date Filter & Theme
│       ├── BudgetsView.tsx             # Budgets workspace: Weekly/Monthly/Custom budgets, Single/Multiple subcategories, Progress + Residual visual cards & alerts
│       ├── DashboardView.tsx           # Executive KPI strip (Total Income, Savings Accumulated), allocation flow & native-currency accounts
│       ├── IncomeLogView.tsx           # Account-currency income entry (saved without conversion), quarterly rates & net routing
│       ├── FlexibleExpensesView.tsx    # Multi-item expense batch recorder with real-time Budget & Account spend check alerts
│       ├── AccountsView.tsx            # Account native currency ledger, live Transfer balance check alert & Vault Debit/Credit modals
│       ├── AnalyticsView.tsx           # Mobile-responsive MoM category bar charts, compact labels & zero-overlap breakdowns
│       ├── SettingsView.tsx            # Mobile-responsive Base Currency, File Import (.csv/.json/.txt/.pdf/.bak), vaults & deductions
│       ├── DeductionAgentModal.tsx     # Smart deduction suggestion modal learned from user ledger history
│       ├── FloatingQuickActions.tsx    # Bold floating action shortcut (+ button) with real-time Budget & Account spend checks
│       ├── WrapSelect.tsx              # Accessible custom select component with gentle multi-line option wrapping
│       └── ConfirmDeleteModal.tsx      # Confirmation modal for destructive actions
├── server.ts                           # Express server (port 3000) + /api/fx/rates + /api/import/parse + /api/budgets/evaluate
├── firebase-blueprint.json             # Canonical Firestore entity schema & collection path definitions (including FinancialBudget)
├── firestore.rules                     # Zero-trust user-isolated Firestore security rules (including /budgets/{budgetId})
├── render.yaml                         # Render cloud deployment blueprint
└── CHANGELOG.md                        # Semantic versioning release log
```

---

## 3. Component and Module Reference

| Component / Module | Responsibility |
| :--- | :--- |
| `src/components/BudgetsView.tsx` | Mobile-fitted Budgets management workspace supporting Weekly, Monthly, Yearly, and Custom date budgets across Single or Multiple expense subcategories, rendering clean Progress + Residual visual bars, omitting single/multiple descriptions on cards, and revealing the Subcategory Breakdown alongside Recorded Expenses inside `View Expenses`. |
| `src/lib/budgetCalculations.ts` | Computes active budget date windows (`computeRecurringPeriodBounds`, `resolveBudgetPeriodWindow`), automatically recreates elapsed recurring budgets for the new period (`reconcileRecurringBudgets`), evaluates subcategory spend progress and residual balances (`evaluateBudgetProgress`, `evaluateAllBudgets`), and runs real-time pre-spend budget + account balance checks (`checkSpendAgainstBudgetsAndAccount`). |
| `src/lib/dateFilters.ts` | Implements the redesigned date filter presets (`Last 7 days`, `This month`, `Last 31 days`, `Last month`, `This year`, `Last 365 days`, `Last year`, and `All Time`) with exact calendar and rolling-day boundary calculation. |
| `src/components/Header.tsx` | Compact 56px sticky header displaying `Save N Know` and active workspace badge on the left, redesigned date filter pills/dropdown on desktop, mobile date filter trigger pill, and the top-right `Menu` button. |
| `src/components/Navigation.tsx` | Collapsible mobile date filter panel (`md:hidden`) rendering the redesigned date filter options in a clean 4-column responsive grid (`grid-cols-2 sm:grid-cols-4`). |
| `src/components/Sidebar.tsx` | Top-right slide-over menu drawer bundling Account & Login Details, Workspace Views (with live **Budgets** count and alert badge), Redesigned Date Filter grid, Display Mode, and Color Themes. |
| `src/components/FlexibleExpensesView.tsx` | Multi-item expense batch recorder with inline real-time **Account Balance** and **Subcategory Budget Progress + Residual** alert banners per draft expense row. |
| `src/components/FloatingQuickActions.tsx` | Quick Record modal with live **Budget & Account Spend Check** alerts when logging an expense. |
| `src/components/AccountsView.tsx` | Multi-account ledger with live source account balance check alerts inside the **Transfer Funds** form. |

---

## 4. GitHub File Change Summary (`v3.5.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/types/finance.ts` | Added `'yearly'` to `BudgetPeriodType` (`'weekly' \| 'monthly' \| 'yearly' \| 'custom'`) and added recurring period lifecycle fields (`activePeriodStart`, `activePeriodEnd`, `parentRecurringBudgetId`, `isArchivedPeriod`) to `FinancialBudget`. |
| `firebase-blueprint.json` | Updated `FinancialBudget` schema to include `yearly` recurrence and recurring period tracking properties (`activePeriodStart`, `activePeriodEnd`, `parentRecurringBudgetId`, `isArchivedPeriod`). |
| `firestore.rules` | Updated `isValidFinancialBudget` to validate recurring period tracking fields and deployed updated security rules to Firestore. |
| `src/lib/firestoreService.ts` | Updated `subscribeToBudgets` and `saveFinancialBudget` to persist `'yearly'` period budgets and recurring cycle fields. |
| `src/lib/budgetCalculations.ts` | Added `'yearly'` period calculation in `computeRecurringPeriodBounds` & `resolveBudgetPeriodWindow`, and implemented `reconcileRecurringBudgets` to automatically recreate recurring budgets when their weekly, monthly, or yearly period elapses. |
| `src/components/BudgetsView.tsx` | Added `Yearly` recurring period option, refined mobile layouts (`grid-cols-2` KPIs and period buttons, `grid-cols-3` mobile filter tabs), removed single/multiple descriptions from budget cards, and moved the Subcategory Breakdown inside the collapsible `View Expenses` section. |
| `src/App.tsx` | Wired `computeRecurringPeriodBounds` on budget creation/update and added automatic `reconcileRecurringBudgets` rollover sync to recreate elapsed recurring budgets in state and Firestore. |
| `README.md` | Updated enterprise documentation and GitHub per-file change summary. |

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
