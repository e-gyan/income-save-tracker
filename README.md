# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v3.3.0`)

**Save N Know** is an enterprise-grade personal and business capital allocation, multi-account ledger, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Month-over-Month Category Spending Bar Chart (Creeping Expense Tracker)**:
  - **Visual MoM Category Bar Comparison**: Dedicated bar chart visualization in **Analytics & Insights** that compares monthly spending across each expense category (`By Category` multi-month trajectory bars with dashed monthly average line vs. `By Month` clustered category bars).
  - **Creeping Expense Detection**: Automatically calculates month-over-month spend deltas (`+amount` and `+%`), highlights the **Top Creeping Category**, and provides a one-click **Creeping Up** filter so users can immediately isolate categories with rising costs.
- **Global Totals Currency Mode Toggle (`Base Currency` vs. `Account Original Currency`)**:
  - **One-Click Global Toggle in Settings**: Switch `totalsCurrencyMode` between **Base (`settings.currency`)** and **Account Currency (`original`)** in **Settings → View Totals In**.
  - **Base Currency Mode (`'base'`)**: Consolidates all KPIs and account cards in the system's base currency using real-time **2-point floating** market exchange rate conversions, with secondary original-currency captions when foreign accounts exist.
  - **Account Original Currency Mode (`'original'`)**: Displays all KPI totals grouped in each account's native currency (e.g., `$1,200.00 + GH₵4,500.00`) and displays account cards in their native currency alongside a real-time market-converted base currency caption (`≈ GH₵...`).
- **Account-Driven Currency Model & Native-Currency Income Persistence**:
  - **Flexible App and Account Currencies**: Set a global primary base currency in **Settings** (`GHS`, `USD`, `EUR`, `GBP`, `NGN`, `KES`, `ZAR`, `CAD`, `AUD`, `JPY`, `INR`) while assigning any currency to individual accounts (`account.currency`). Each account's currency governs how transactions operate on that account across the app.
  - **Save Income in Account Currency Without Conversion**: When adding or importing a new income into an account whose currency differs from the system currency, the income and its allocated deductions are saved and displayed directly in that account's native currency (`grossAmount: rawEnteredAmount`, `originalGrossAmount: rawEnteredAmount`, `currency: accountCurrency`) without conversion.
  - **Real-Time Market Conversion on Consolidated Totals**: All consolidated system totals (**Dashboard**, **Analytics**, **Monthly Summary**, **Savings Vaults**, and **Total Balance Across Accounts**) automatically convert non-base currency incomes, deductions, expenses, transfers, and account balances into `settings.currency` using real-time **2-point floating** market exchange rates (`convertCurrency2dp`).
  - **Real-Time Conversion on Spending & Transfers**: When spending or transferring from an account whose currency differs from the main app currency, the transaction operates in the account's currency and converts in real time across the source account currency, destination account currency, and system base currency.
- **Seamless Backend File Import & Database Synchronization (`POST /api/import/parse`)**:
  - Import financial records directly from **Settings → Import Records & Files** using `.csv`, `.tsv`, `.json`, `.txt`, `.md`, `.pdf`, or `.bak` backup files.
  - Combines deterministic multi-format parsing (including JSON/NDJSON/base64/delimited `.bak` archives) with AI fallback (`gemini-3.1-flash-lite`) to extract **Incomes**, **Expenses**, **Accounts**, and **Transfers**, preserving native account currencies on incomes while converting expenses, transfers, and system totals at real-time 2-point floating market rates.
- **Standardized Executive Terminology**:
  - Standardized all income metrics across the platform from *Gross Income* to **Total Income** and savings metrics from *Savings Transfers* to **Savings Accumulated**.
- **Intelligent Quarterly Savings and Defined Deductions Engine**:
  - Supports quarter-aware savings deduction rates based on the income record's date.
  - Non-retroactive rate updates: modifying quarterly savings rates in **Settings** applies only to subsequent income records without altering historical ledgers.
  - Custom per-income rate overrides (`isCustomRateOverride`) and **Net Income Routing** to designated accounts.
- **Virtual Accounts and Attached Main Accounts (Operating and Savings Vaults)**:
  - Any Operating Account or Savings Vault can be marked as a **Virtual Account** attached to a non-virtual **Main Account** (`custodianAccountId`).
  - All transfers, spending, debits, and credits on a virtual account or savings vault are reflected in both the virtual account/vault AND its attached Main Account, while **Total Balance Across Accounts** is calculated strictly from Main (non-virtual) accounts to prevent double-counting.
- **Savings Vaults — Debit and Credit Cause Lifecycle**:
  - **Debit Vault**: Deploy funds from a Savings Vault for an investment or capital cause deducting from both the Savings Vault and its attached Main Account.
  - **Credit Vault / Credit Instance**: Credit a debited cause instance once the cause matures or ends, crediting both the Savings Vault and its attached Main Account.
- **Intuitive Backend Expense Subcategory Color Engine**:
  - Automatically assigns semantic, high-contrast colors to expense subcategories on the backend using financial domain keyword intelligence with deterministic FNV-1a hash fallback and interactive palette customization in **Settings**.

---

## 2. System Architecture

```text
├── src/
│   ├── App.tsx                         # Root state orchestrator, Firestore sync, batch file import handler & quick-action FAB
│   ├── index.css                       # Global Tailwind v4 typography, theme variables, text wrapping & surface rules
│   ├── types/
│   │   └── finance.ts                  # Enterprise domain models (IncomeReceipt, FlexibleExpense, FinancialAccount, AccountTransfer, UserSettings)
│   ├── lib/
│   │   ├── currencyService.ts          # Real-time FX market rate sync, account native currency helpers & 2-point floating conversion engine
│   │   ├── calculations.ts             # Account-native & system-base ledger engine, virtual/main account rollup & subcategory color engine
│   │   ├── deductionIntelligence.ts    # Pattern-learning engine suggesting deductions from historical income & expense data
│   │   ├── colorThemes.ts              # Persistent functional color palettes & CSS custom property injector
│   │   ├── dateFilters.ts              # Global date preset filtering (All, Today, 7D, Month, Quarter, YTD)
│   │   ├── firebase.ts                 # Firebase Auth (Google Sign-In) & Firestore initialization with error diagnostics
│   │   └── firestoreService.ts         # Real-time Firestore subscriptions, multi-currency field persistence & local cache fallback
│   └── components/
│       ├── Header.tsx                  # Static top bar with Save N Know branding, theme switcher & Google Sign-In
│       ├── Navigation.tsx              # Static sub-header with collapsible menu trigger & global date filter
│       ├── Sidebar.tsx                 # Auto-closing left navigation drawer
│       ├── DashboardView.tsx           # Executive KPI strip (Total Income, Savings Accumulated), allocation flow & native-currency accounts
│       ├── IncomeLogView.tsx           # Account-currency income entry (saved without conversion), quarterly rates & net routing
│       ├── FlexibleExpensesView.tsx    # Multi-item expense batch recorder with account currency & real-time FX conversion
│       ├── AccountsView.tsx            # Account native currency ledger, automatic FX on Transfer Funds & Vault Debit/Credit modals
│       ├── AnalyticsView.tsx           # Quarterly Savings Vaults vs. Flexible Expenses pie chart & subcategory visual analytics
│       ├── SettingsView.tsx            # Base App Currency, File Import (.csv/.json/.txt/.pdf/.bak) & Database Sync, vaults & deductions
│       ├── DeductionAgentModal.tsx     # Smart deduction suggestion modal learned from user ledger history
│       ├── FloatingQuickActions.tsx    # Floating action shortcut (+ button) for Transfer Fund, Income & Expense with account currency FX
│       ├── WrapSelect.tsx              # Accessible custom select component with gentle multi-line option wrapping
│       └── ConfirmDeleteModal.tsx      # Confirmation modal for destructive actions
├── server.ts                           # Express server (port 3000) + /api/fx/rates live FX proxy + /api/import/parse file ingestion engine
├── firebase-blueprint.json             # Canonical Firestore entity schema & collection path definitions
├── firestore.rules                     # Zero-trust user-isolated Firestore security rules
├── render.yaml                         # Render cloud deployment blueprint
└── CHANGELOG.md                        # Semantic versioning release log
```

---

## 3. Component and Module Reference

| Component / Module | Responsibility |
| :--- | :--- |
| `server.ts` (`/api/fx/rates` & `/api/import/parse`) | Provides live market exchange rate synchronization (`rates2dp`) and multi-format file import parsing (`.csv`, `.tsv`, `.json`, `.txt`, `.md`, `.pdf`, `.bak`), saving imported incomes in their account/record currency without conversion while converting expenses, transfers, and totals at real-time 2-point floating rates. |
| `src/lib/currencyService.ts` | Client FX service providing `fetchMarketExchangeRates`, `roundTo2Decimals`, `format2PointFloat`, `getExchangeRate`, `convertCurrency2dp`, `getAccountCurrency`, `convertBaseToAccountCurrency`, and `getAccountNativeBalance`. |
| `src/lib/calculations.ts` | Core financial calculation engine: resolves native vs. base income amounts (`getIncomeNativeGross`, `getIncomeBaseGross`), computes each account's exact native ledger (`nativeCurrentCashBalance`) alongside real-time converted base summaries, and converts non-base currency deductions, expenses, and transfers on consolidated totals. |
| `src/lib/firestoreService.ts` | Manages real-time `onSnapshot` listeners and writes for `settings`, `incomes`, `flexible_expenses`, `accounts`, `transfers`, and `revisions`, including multi-currency FX fields on accounts, incomes, expenses, and transfers. |
| `src/components/SettingsView.tsx` | Houses **Base App Currency**, **Import Records & Files** (`.csv`, `.tsv`, `.json`, `.txt`, `.md`, `.pdf`, `.bak` upload, sample CSV template, parsed record preview, and one-click database import), **Savings Vaults**, **Defined Deductions**, and **Subcategory Colors**. |
| `src/components/AccountsView.tsx` | Displays each account and its Account History modal in its own native currency (`account.currency`) without FX round-trip drift, and performs real-time 2-point floating conversion when transferring funds or debiting/crediting savings vaults. |
| `src/components/FlexibleExpensesView.tsx` | Defaults expense currency to the selected account's currency and performs real-time 2-point floating conversion when spending from an account whose currency differs from the main app currency. |
| `src/components/IncomeLogView.tsx` | Syncs income currency to the selected Receiving Account's currency, saves new and edited incomes in that currency without conversion, displays income cards in their native currency, and shows real-time market conversion for consolidated totals and cross-currency net transfers. |
| `src/components/FloatingQuickActions.tsx` | Floating bottom-right `+` shortcut menu that syncs currency to the selected account, saves new incomes in the account's currency without conversion, and converts transfers and expenses in real time. |

---

## 4. Local Development and Production Deployment

```bash
# Install dependencies
npm install

# Run development server on port 3000
npm run dev

# Type-check and build production bundle
npm run lint
npm run build
```
