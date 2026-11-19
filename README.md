# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.9.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Backend-Driven Category & Subcategory Editing with Full Record Cascade (`server.ts`, `App.tsx`, `SettingsView.tsx`, `calculations.ts`)**:
  - Dedicated `POST /api/categories/edit` endpoint atomically updates edited category and/or subcategory names on the backend, merges cleanly into matching categories, preserves subcategory colors, and cascades replacements across all matching **Expenses**, **Income Allocated Deductions**, **Defined Deduction Rules**, and **Budgets** with Firestore persistence and offline fallback.
  - Settings supports editing a category together with its subcategories in a single step or clicking any subcategory chip for instant inline editing, displaying a clear confirmation of the updated name and synced record count.
- **Backend-Validated Deduction & Category Integrity (`server.ts`, `calculations.ts`, `SettingsView.tsx`)**:
  - Dedicated `POST /api/settings/deductions/define` endpoint and enhanced `POST /api/settings/modify` normalization strictly lock the user's selected **Expense Category** and **Subcategory** (including `None`) when defining or editing a deduction rule.
  - Preserves the clean original New/Edit Deduction Rule interface while removing automatic category/subcategory overrides during typing, saving, or cross-app resolution (`Income & Deductions`, `Quick Income`, `Expenses`, `Budgets`, `Analytics`).
- **Backend-Powered Automated Manual Transfers to Savings Vaults (`server.ts`, `deductionIntelligence.ts`, `AccountsView.tsx`, `FloatingQuickActions.tsx`, `App.tsx`)**:
  - Direct checkbox right beneath the transfer `Amount` input asking users whether to **Transfer to Savings Vaults**.
  - Distributes the transfer amount across active Savings Vaults by percentage rate (with 2dp FX conversion and per-vault inclusion toggles) and generates matched automated vault debit expenses with inline editing and `+ Set Debit` support.
- **Dynamic Top-5 Frequent Expense Suggestions & Smooth Editing (`deductionIntelligence.ts`, `FlexibleExpensesView.tsx`, `FloatingQuickActions.tsx`, `index.css`)**:
  - Dynamically learns top-5 recurring category/subcategory expense patterns from recorded history using frequency + recency weighting, dominant operating account detection, and median recent typical amounts while leaving `To / Cause` and `Notes` blank.
- **Date-Responsive Expenses "By Category" View with Backend Aggregation (`FlexibleExpensesView.tsx`, `App.tsx`, `server.ts`)**:
  - `By Category` mode filters live against global and local date filters, excludes vault credits from spend totals, and syncs grouped category totals with `POST /api/expenses/by-category`.
- **Collapsed-by-Default Analytics Workspace & Expanded Color/Display Automation (`AnalyticsView.tsx`, `colorThemes.ts`, `Sidebar.tsx`, `SettingsView.tsx`)**:
  - Analytics sections start collapsed by default; includes 11 color palettes (`Rose`, `Fuchsia`, `Slate`, `Cyan`, `Sky`, etc.) without label descriptions and `6:45 AM/PM` + `Auto` display modes.

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
│   ├── App.tsx                         # Root state orchestrator, category/subcategory cascade sync, batch handlers & 6:45 AM/PM + Auto theme engine
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (ThemeMode, AppColorTheme, UserSettings, IncomeReceipt, FlexibleExpense, Accounts, Budgets)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # 11 color palettes, blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, user-respecting category preferences, strict deduction mapping, 2dp FX & account summaries
│   │   ├── deductionIntelligence.ts    # Vault distribution & debit planning, Top-5 expense learning & deduction rule suggestions
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Income recording, draft-smooth deductions & editable vault debits
│       ├── FlexibleExpensesView.tsx    # Multi-item expense recording, blank To/Notes suggestions & date-filtered By Category sync with backend
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated (deductions + manual vault transfers) & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds with vault distribution & auto-debit automation
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal (blocks editing of income deduction expenses)
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar) with magnified icon+count tabs & FX conversion
│       └── SettingsView.tsx            # Settings customization, unified category/subcategory editor with cascade feedback & clean deduction rule selectors
├── server.ts                           # Express server (port 3000) + /api/categories/edit + /api/settings/deductions/define + /api/settings/modify + /api/transfers/* + /api/expenses/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.9.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `server.ts` | Added `POST /api/categories/edit` to rename categories and/or subcategories on the backend, preserve subcategory colors, merge duplicate target names, and cascade replacements across deduction rules, expenses, income deductions, and budgets with an update summary. |
| `src/App.tsx` | Added `handleEditCategoryOrSubcategory` calling `POST /api/categories/edit` with offline fallback, atomic React/localStorage state sync, and chunked Firestore persistence of modified settings, expenses, incomes, and budgets; wired it to `SettingsView`. |
| `src/components/SettingsView.tsx` | Upgraded Expense Categories & Subcategories editing so users can edit a category and its subcategories together or individually inline, display immediate backend-updated names, and show a concise summary of automatically updated records. |
| `src/lib/calculations.ts` | Prevented `getEffectiveExpenseCategoryPreferences` from re-inserting `"Giving and Speaking"` / `"Givings"` once user category preferences exist, and bumped `APP_VERSION` to `4.9.0`. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.9.0`. |
| `README.md` | Updated enterprise documentation and `v4.9.0` per-file GitHub commit change log. |
