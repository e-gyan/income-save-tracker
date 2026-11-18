# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.6.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Dynamic Top-5 Frequent Expense Suggestions & Smooth Editing (`deductionIntelligence.ts`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`, `index.css`)**:
  - Dynamically learns top-5 recurring category/subcategory expense patterns from recorded history using frequency + recency weighting, dominant operating account detection, and median recent typical amounts.
  - Selecting a suggested expense populates account, currency, category, subcategory, and amount while keeping `To / Cause` and `Notes` blank for clean contextual entry.
  - Smooth text and numeric field editing across the app via draft-aware inputs and `manualAccountOverride` protection against unintended cursor/value resets.
- **Date-Responsive Expenses "By Category" View with Backend Aggregation (`FlexibleExpensesView.tsx`, `App.tsx`, `server.ts`)**:
  - `By Category` mode filters live against both global header/sidebar `timeRange` presets and `Recent Transactions By` (`All | Week | Month | Year`), excludes vault credits from spend totals, and syncs grouped category totals with `POST /api/expenses/by-category`.
- **Editable Automated Savings Vault Debits & Refined Income Form Order (`IncomeLogView.tsx`, `FloatingQuickActions.tsx`)**:
  - Users who opt into automated savings vault debits can both deselect individual vaults and edit each planned debit inline (`To / Cause`, `Category`, `Subcategory`, `Debit Amount`, `Notes`) in `IncomeLogView` and Quick Record Income.
  - Placed `Account` directly above the `Currency / Total Income / Date` block in `IncomeLogView`.
- **Collapsed-by-Default Analytics Workspace (`AnalyticsView.tsx`)**:
  - All collapsible sections in Analytics load collapsed by default so users expand only the charts and breakdowns they want to inspect.
- **Expanded App Color Palette & 6:45 AM / 6:45 PM Display Automation (`types/finance.ts`, `colorThemes.ts`, `SettingsView.tsx`, `Sidebar.tsx`, `App.tsx`)**:
  - Includes `Rose`, `Fuchsia`, `Slate`, `Cyan`, and `Sky` (plus existing palette swatches) with clean names only and no descriptive labels.
  - Added `6:45 AM/PM` scheduled display mode (switches to Light blended with the active color theme at `6:45 AM` and Dark at `6:45 PM`), while `Auto` tracks the device's system preference.

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
│   ├── App.tsx                         # Root state orchestrator, 6:45 AM/PM & Auto system theme engine, BottomMenuBar & timeRange wiring
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (ThemeMode, AppColorTheme, UserSettings, IncomeReceipt, FlexibleExpense, Accounts, Budgets)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # 11 color palettes (incl. Rose, Fuchsia, Slate, Cyan, Sky), blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, 2dp FX reconciliation, account summaries & manual vault transfer accumulation
│   │   ├── deductionIntelligence.ts    # Frequency+recency Top-5 expense learning, automated vault debit planning & deduction learning
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar (omits Budgets & Settings)
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, clean Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Income recording (Account swapped above Currency/Income/Date), draft-smooth deductions & editable vault debits
│       ├── FlexibleExpensesView.tsx    # Multi-item expense recording, blank To/Notes suggestions & date-filtered By Category sync with backend
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Transfer, Defined-only Income with editable vault debits, Quick Expense with blank To/Notes)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated (deductions + manual vault transfers) & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, unified Total Savings Accumulated & ledger history
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar) with magnified icon+count tabs & FX conversion
│       └── SettingsView.tsx            # Settings customization with 4-option Display Mode & clean Color Palette swatches
├── server.ts                           # Express server (port 3000) + /api/expenses/by-category + /api/savings/vault-debit-plan + /api/fx/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.6.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/types/finance.ts` | Extended `ThemeMode` with `'schedule'` and added `'fuchsia'`, `'cyan'`, and `'sky'` to `AppColorTheme`. |
| `src/lib/colorThemes.ts` | Added `Fuchsia`, `Cyan`, and `Sky` palettes (alongside `Rose` and `Slate`), stripped `functionLabel` and `uxInsight` copy, enhanced light canvas color blending, added `getScheduledThemeIsDark` (`6:45 AM` light / `6:45 PM` dark), and updated `getPersistedThemeMode`. |
| `src/index.css` | Added explicit text-selection and touch-manipulation rules on form inputs and textareas for smooth typing and erasing. |
| `src/components/AnalyticsView.tsx` | Set all 7 collapsible Analytics section states to collapsed (`true`) on initial load. |
| `src/components/Sidebar.tsx` | Updated Display Mode controls to `Light`, `Dark`, `6:45 AM/PM`, and `Auto`, and rendered color swatches cleanly without descriptive labels. |
| `src/components/SettingsView.tsx` | Added `6:45 AM/PM` and `Auto` Display Mode controls and removed label descriptions from App Color Palette cards. |
| `src/lib/deductionIntelligence.ts` | Upgraded `learnTopFrequentExpenses` to learn category/subcategory frequency + recency patterns with dominant account and median recent amounts while keeping `recipient` and `notes` blank. |
| `src/App.tsx` | Wired `6:45 AM/PM` timer + visibility listener and OS `prefers-color-scheme` system listener for `Auto`, updated `Sidebar` props, and passed `timeRange` into `FlexibleExpensesView`. |
| `server.ts` | Added date-preset filtering helpers and `POST /api/expenses/by-category` endpoint computing filtered category totals while excluding vault credits. |
| `src/components/FlexibleExpensesView.tsx` | Left `To / Cause` and `Notes` blank on suggestion tap, added `manualAccountOverride` row guard, filtered `By Category` by `timeRange` and `groupByPeriod`, excluded vault credits from spend totals, and synced `/api/expenses/by-category`. |
| `src/components/IncomeLogView.tsx` | Swapped `Account` directly above the `Currency / Total Income / Date` block, added inline editing for planned automated vault debits (form & confirmation modal), and added draft string state for smooth numeric deduction erasing. |
| `src/components/FloatingQuickActions.tsx` | Added inline editing for quick-record automated vault debits, draft string state for quick deduction inputs, blank `To / Cause` & `Notes` on frequent expense apply, and manual account override protection. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.6.0`. |
| `README.md` | Updated enterprise architecture documentation and added the `v4.6.0` per-file GitHub commit change log. |
