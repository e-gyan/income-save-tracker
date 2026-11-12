# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v3.6.0`)

**Save N Know** is an enterprise-grade personal and business capital allocation, multi-account ledger, recurring & custom subcategory budgeting, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Budgets Engine (`BudgetsView.tsx` & `budgetCalculations.ts`)**:
  - **Primary Menu Option (`Budgets`)**: Dedicated workspace accessible from the top-right menu drawer (`Sidebar.tsx`) with live badge counters for total budgets and active threshold/over-limit alerts.
  - **Flexible Period Recurrence**: Define budgets as **Recurring Weekly** (current Monday–Sunday cycle), **Recurring Monthly** (current calendar month), **Recurring Yearly** (current calendar year), or **Custom Period** (`customStartDate` to `customEndDate`). Elapsed recurring budgets automatically recreate for the new period.
  - **Minimalist Clickable Budget Card & Pop-Up Budget Options Modal**:
    - Each defined **Budget Card** displays only the **Budget Name**, **Top Bar Row** (Start Period on top-left, Usage `%` in the middle, End Period on top-right), **Progress Bar with the Alert Mark embedded inside the bar**, **Bottom Bar Row** (`0.00` starting currency on bottom-left, Spent currency in the middle, Budget Amount on bottom-right), and **Residual Amount** beneath on the left.
    - Clicking any budget card opens the **Pop-Up Budget Options Modal** displaying **Selected Subcategories** (with colors and spend breakdown), **Accounts Chosen**, **History of Transactions**, **Edit Budget**, and **Delete Budget**.
- **Streamlined Static Header on Mobile & Navigation Defaults (`Header.tsx`, `Navigation.tsx`, `App.tsx`)**:
  - **Default Menu Option**: Opens on **Overview** (`dashboard`) by default.
  - **Mobile Static Header (`Header.tsx`)**: Compact 48px (`h-12 sm:h-14`) header showing only `Save N Know` on the left (without adjacent menu option descriptions), responsive date filter controls, and the top-right `Menu` button.
  - **Renamed Menu Option**: Changed `"Income & Deductions"` to `"Income"`.
- **Income Fixed-Value Deductions Currency Equivalence & Unselected Default Sources (`IncomeLogView.tsx`, `FloatingQuickActions.tsx`, `calculations.ts`, `deductionIntelligence.ts`)**:
  - **Currency Equivalence for Fixed Deductions**: When recording income in a currency different from the app's base currency, any **Defined Deduction** or **Suggested from Your History** deduction with a **fixed value** (`type === 'fixed'`) is automatically converted to the equivalent value in the selected income currency.
  - **Unselected Default Options & Synced Quick Record**: **Income Source** and **Source** start unselected (`Select Income Source...` / `Select Source...`) until chosen by the user, are shared and persisted across both the full **Income** view and **Quick Record**, and have all pre-defined seed lists cleared from the codebase.
  - **Subcategory Color Badges on Deductions (`SettingsView.tsx`, `IncomeLogView.tsx`, `FloatingQuickActions.tsx`)**: Defined and expense deductions display only the subcategory description styled with its configured color badge.

---

## 2. System Architecture

```text
├── src/
│   ├── App.tsx                         # Root state orchestrator (default tab: Overview / 'dashboard'), Firestore sync & settings persistence
│   ├── index.css                       # Global Tailwind v4 typography, theme variables, text wrapping & surface rules
│   ├── types/
│   │   └── finance.ts                  # Enterprise domain models (IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer, FinancialBudget, UserSettings)
│   ├── lib/
│   │   ├── currencyService.ts          # Real-time FX market rate sync, account native currency helpers & 2-point floating conversion engine
│   │   ├── calculations.ts             # Account-native & system-base ledger engine, fixed-deduction FX conversion & subcategory color engine
│   │   ├── budgetCalculations.ts       # Budget period window resolver, recurring rollover engine, subcategory progress/residual evaluator & spend checks
│   │   ├── deductionIntelligence.ts    # Pattern-learning engine suggesting deductions with fixed-value FX equivalence conversion
│   │   ├── colorThemes.ts              # Persistent functional color palettes & CSS custom property injector
│   │   ├── dateFilters.ts              # Redesigned date filters (Last 7 days, This month, Last 31 days, Last month, This year, Last 365 days, Last year, All Time)
│   │   ├── firebase.ts                 # Firebase Auth (Google Sign-In) & Firestore initialization with error diagnostics
│   │   └── firestoreService.ts         # Real-time Firestore subscriptions & legacy pre-defined seed stripper
│   └── components/
│       ├── Header.tsx                  # Compact mobile-first static top bar (h-12 sm:h-14) with Save N Know branding (no menu subtitle), date filters & Menu button
│       ├── Navigation.tsx              # Primary navigation metadata ("Income" label) & collapsible mobile 2-column date filter grid
│       ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login details, Views, Date Filter & Theme
│       ├── BudgetsView.tsx             # Minimalist clickable budget cards (progress bar + alert mark + start/pct/end + 0.00/spent/budget + residual) & Pop-Up Budget Options Modal
│       ├── DashboardView.tsx           # Default Overview workspace: Executive KPI strip, allocation flow & native-currency accounts
│       ├── IncomeLogView.tsx           # Income workspace: unselected default Income Source/Source, fixed-deduction FX equivalence & subcategory color badges
│       ├── FlexibleExpensesView.tsx    # Multi-item expense batch recorder with real-time Budget & Account spend check alerts
│       ├── AccountsView.tsx            # Multi-account ledger without pre-defined account type seeds, live Transfer balance check & Vault modals
│       ├── AnalyticsView.tsx           # Mobile-responsive MoM category bar charts, compact labels & zero-overlap breakdowns
│       ├── SettingsView.tsx            # Base Currency, File Import, vaults & Defined Deductions showing only colored subcategory badge
│       ├── DeductionAgentModal.tsx     # Smart deduction suggestion modal learned from user ledger history
│       ├── FloatingQuickActions.tsx    # Quick Record modal synced with Income Source/Source options, fixed-deduction FX conversion & colored subcategory badges
│       ├── WrapSelect.tsx              # Accessible custom select component with gentle multi-line option wrapping
│       └── ConfirmDeleteModal.tsx      # Confirmation modal for destructive actions
├── server.ts                           # Express server (port 3000) + /api/fx/rates + /api/import/parse + /api/budgets/evaluate
├── firebase-blueprint.json             # Canonical Firestore entity schema & collection path definitions
├── firestore.rules                     # Zero-trust user-isolated Firestore security rules
├── render.yaml                         # Render cloud deployment blueprint
└── CHANGELOG.md                        # Semantic versioning release log
```

---

## 3. Component and Module Reference

| Component / Module | Responsibility |
| :--- | :--- |
| `src/components/BudgetsView.tsx` | Minimalist clickable budget cards showing only Name, Start/Percentage/End above the bar, Progress Bar with embedded Alert Mark, `0.00`/Spent/Budget beneath the bar, and Residual on the bottom-left; clicking a card opens the Pop-Up Budget Options Modal (Selected Subcategory, Accounts Chosen, History of Transactions, Edit Budget, Delete Budget). |
| `src/components/Header.tsx` | Mobile-optimized static header (`h-12 sm:h-14`) displaying `Save N Know` without adjacent menu descriptions, responsive date filter trigger, and top-right `Menu` button. |
| `src/components/Navigation.tsx` | Defines workspace navigation metadata (with `"Income"` label) and renders the mobile collapsible date filter bar (`grid-cols-2 sm:grid-cols-4`). |
| `src/components/IncomeLogView.tsx` | Full Income recording view with unselected default `Income Source` and `Source` dropdowns, automatic currency conversion for fixed-value Defined and Suggested deductions, and subcategory color badges. |
| `src/components/FloatingQuickActions.tsx` | Quick Record modal syncing custom `Income Source` and `Source` options to user settings, starting dropdowns unselected, converting fixed-value deductions to the selected income currency, and displaying colored subcategory badges. |
| `src/components/SettingsView.tsx` | Settings workspace where Defined Deductions display only the subcategory description with its color badge. |

---

## 4. GitHub File Change Summary (`v3.6.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/App.tsx` | Set default menu view to `Overview` (`'dashboard'`) and passed `onSaveSettings` to `FloatingQuickActions` so Quick Record persists new Income Source and Source options. |
| `src/components/Header.tsx` | Optimized static header for mobile screens (`h-12 sm:h-14`, compact controls) and removed the menu option description next to `Save N Know`. |
| `src/components/Navigation.tsx` | Renamed menu option `"Income & Deductions"` to `"Income"` and refined the mobile date filter bar to a clean 2-column mobile grid. |
| `src/lib/calculations.ts` | Cleared all pre-defined arrays (`DEFAULT_ACCOUNT_TYPES`, `DEFAULT_INCOME_SOURCES`, `DEFAULT_INCOME_ORIGINS`, `DEFAULT_INCOME_CATEGORIES`), added legacy seed sets, and updated `buildDefaultDeductionsForIncome` to convert fixed-value deductions into the selected income currency. |
| `src/lib/firestoreService.ts` | Added `stripLegacyPredefinedList` in `fetchUserSettings` to strip legacy pre-defined seed arrays on load. |
| `src/lib/deductionIntelligence.ts` | Updated `learnDeductionSuggestions` to convert fixed-value historical and defined deductions into the selected income currency using live market FX rates. |
| `src/components/AccountsView.tsx` | Cleared `CAUSE_PRESETS` pre-defined account types and started the Account Type selector unselected (`Select Account Type...`). |
| `src/components/SettingsView.tsx` | Updated Defined Deductions list items to show only the subcategory description with its color badge. |
| `src/components/IncomeLogView.tsx` | Updated header to `"Income"`, started `Income Source` and `Source` unselected until user selection, converted fixed-value suggested/defined deductions to the selected income currency, and rendered only colored subcategory descriptions on deduction badges. |
| `src/components/FloatingQuickActions.tsx` | Synced `Income Source` and `Source` options with user settings in Quick Record, started dropdowns unselected, converted fixed-value deductions to the selected currency, and rendered colored subcategory badges on deductions. |
| `src/components/BudgetsView.tsx` | Redesigned defined budget cards to be minimalist and clickable (showing Name, Start/`%`/End top row, Progress Bar with Alert Mark, `0.00`/Spent/Budget bottom row, and Residual on bottom-left) and added the Pop-Up Budget Options Modal (Selected Subcategory, Accounts Chosen, History of Transactions, Edit Budget, Delete Budget). |
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

