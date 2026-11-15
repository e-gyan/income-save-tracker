# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.3.3`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Static Top Header + 6-Icon Non-Scrolling BottomMenuBar + Full Icon-and-Name Sidebar (`Navigation.tsx`, `App.tsx`, `Sidebar.tsx`, `Header.tsx`)**:
  - **6-Icon Non-Scrolling BottomMenuBar**: Displays `Overview`, `Income`, `Expenses`, `Budgets`, `Accounts`, and `Analytics` (omitting `Settings`) in a fixed 6-column layout (`grid-cols-6`) with large clickable icons (`h-7 w-7 sm:h-8 sm:w-8`) and no horizontal scrolling required.
  - **Sidebar with Icons & Names**: The top-right `Sidebar` drawer displays all 7 workspace views (`Overview`, `Income`, `Expenses`, `Budgets`, `Accounts`, `Analytics`, `Settings`) with both their icons and names alongside count and alert badges.
  - **Rock-Solid Pop-Ups, Scrolling & Clamped Sliding**: Removed CSS transforms from the scrollable middle workspace container so all `position: fixed` pop-ups lock cleanly to the viewport, vertical scrolling is jitter-free, and horizontal swipe sliding transitions smoothly with strict start/end boundary clamping.
- **Budgets & Goals Magnified Icon + Count Toggle Bar (`BudgetsView.tsx`)**:
  - Removed the text labels (`Budgets`, `Goals`, `Expired / Disabled`) from the toggle tab bar and magnified the tab icons (`h-5 w-5 sm:h-6 sm:w-6`) alongside magnified count badges (`text-xs sm:text-sm font-mono font-extrabold`).
- **Income Deduction Expense Transactions: Delete-Only, Non-Editable (`RecordCard.tsx`, `EditExpenseModal.tsx`, `App.tsx`, `calculations.ts`, `server.ts`)**:
  - Income deduction expense transactions (`exp_ded_<incomeId>_<deductionId>`) are strictly non-editable (`Edit` is hidden in the transaction pop-up and blocked by `EditExpenseModal`, `handleUpdateExpense`, and `POST /api/expenses/update`), while users can delete any income deduction expense transaction with confirmation (`Delete` / `Confirm Delete`), removing the deduction from the parent income receipt via `POST /api/expenses/delete-deduction` and Cloud Firestore.

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
│   ├── App.tsx                         # Root state orchestrator with static top Header, stable scrollable middle workspace, clamped horizontal swipe & static BottomMenuBar
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + persisted auth session
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # Functional color themes + Accounting Figure Color presets & CSS variable engine
│   │   ├── calculations.ts             # Allocation engine, 2dp currency reconciliation & savings vault logic
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   ├── components/
│   │   ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 6-icon non-scrolling BottomMenuBar (Overview through Analytics, omitting Settings)
│   │   ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│   │   ├── Sidebar.tsx                 # Collapsible top-right drawer with all 7 workspace views (icons + names), count/alert badges, account auth & theme controls
│   │   ├── RecordCard.tsx              # Unified 2x2 Transaction Card & Income/Expense/Transfer Pop-Up Modals with delete confirmation
│   │   ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│   │   ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view with magnified icon+count toggle tabs, FX conversion display & auto-recreation
│   │   ├── DashboardView.tsx           # Overview with Recent Transactions By grouping and Allocation Flow
│   │   ├── IncomeLogView.tsx           # Income & Deductions recording, Recent Transactions By grouping & edit/delete modals
│   │   ├── FlexibleExpensesView.tsx    # Expenses workspace with Recent Transactions By grouping & category breakdowns
│   │   ├── AccountsView.tsx            # Operating Accounts, Savings Vaults & Recent Transactions By account history
│   │   └── SettingsView.tsx            # Seamless textbox editing, Subcategory Move tool, Vaults, Deductions & File Import
├── server.ts                           # Express server (port 3000) + /api/expenses/delete-deduction + /api/fx/convert-intelligence + /api/settings/modify
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.3.3`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/components/Navigation.tsx` | Updated `BOTTOM_NAV_ITEMS` to include `Overview` (`dashboard`) and omit `Settings` (`settings`), and increased the `BottomMenuBar` icon dimensions to `h-7 w-7 sm:h-8 sm:w-8` inside `h-12 sm:h-14` buttons. |
| `src/components/Sidebar.tsx` | Restored `renderNavIcon` alongside each menu option's name (`item.label`) in the `Sidebar` drawer while keeping count and alert badges. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.3.3`. |
| `README.md` | Documented `v4.3.3` `BottomMenuBar` (`Overview` through `Analytics` with larger icons, omitting `Settings`), `Sidebar` icons and names, and per-file GitHub commit summaries. |




