# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.11.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, biometric app security, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Reliable Multi-Record Income & Expense Batch Recording (`App.tsx`, `FlexibleExpensesView.tsx`, `IncomeLogView.tsx`, `FloatingQuickActions.tsx`)**:
  - Multi-item expense batches and multi-entry income queues save atomically with collision-proof IDs (`inc_*` / `exp_*`), functional React state updaters, and awaited `Promise.all` Firestore persistence so concurrent snapshots never drop submitted records.
  - Preserves explicitly selected operating accounts, resolves custom typed source/origin drafts automatically, validates incomplete rows clearly before submit, and surfaces a 1-tap `Show All Dates` action if newly saved records fall outside the active date filter.
- **Complete Individual Savings Vault Debiting (`deductionIntelligence.ts`, `server.ts`, `IncomeLogView.tsx`, `AccountsView.tsx`, `FloatingQuickActions.tsx`)**:
  - Automated and manual savings vault debiting plans and executes debits for **every** active individual Savings Vault specified by the user (including vaults without prior debit history), with per-vault customization and `Select All / Clear All` controls.
- **Savings Vault Group Credit & Commitment Earnings (`AccountsView.tsx`)**:
  - After debiting a Savings Vault, users can switch between **Group Credit** and **Single Debit** inside the Credit Vault modal, select individual debited causes or group chips, see the **exact remaining committed principal** (net of prior linked credits), enter the principal amount to credit back, and optionally record **earnings** generated from the commitment in one flow.
  - Principal credits allocate sequentially across selected debits (`linkedExpenseId`) while earnings post as a clean linked credit (`Cause Earnings`), updating both the Savings Vault and attached Main Account balances automatically.
- **Streamlined Accounts Workspace (`AccountsView.tsx`)**:
  - Removed the intermediate aggregate summary bar between Create Account and Operating Accounts for a direct, clutter-free account management workflow.
- **Backend-Managed Prospective Savings Vault Percentages (`server.ts`, `calculations.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Dedicated `POST /api/settings/vault-rates/update` endpoint freezes existing income records' savings deductions with their historical `savingsSplitSnapshot` before applying updated vault percentages prospectively to new income records.
- **PWA / Android Biometric App Lock (`biometricAuth.ts`, `BiometricLockScreen.tsx`, `server.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Opt-in WebAuthn platform biometric gate (`POST /api/security/biometric/challenge` and `POST /api/security/biometric/verify`) with offline PWA verification, salted SHA-256 backup passcode, and automatic resume lock.
- **Backend-Driven Category & Subcategory Editing with Full Record Cascade (`server.ts`, `App.tsx`, `SettingsView.tsx`, `calculations.ts`)**:
  - `POST /api/categories/edit` atomically updates category/subcategory names and cascades replacements across Expenses, Income Deductions, Deduction Rules, and Budgets.
- **Dynamic Top-5 Frequent Expense Suggestions, Date-Responsive "By Category" View & Expanded Theme Automation**:
  - Learns recurring expense patterns while leaving `To / Cause` and `Notes` blank, aggregates `By Category` with `POST /api/expenses/by-category`, collapses Analytics by default, and includes 11 color palettes plus `6:45 AM/PM` and `Auto` display modes.

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
│   ├── App.tsx                         # Root state orchestrator, BiometricLockScreen gate, atomic multi-record income/expense persistence & cloud sync
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (IncomeReceipt, FlexibleExpense, Accounts, Budgets, UserSettings)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, settings persistence & backend snapshot sync
│   │   ├── biometricAuth.ts            # WebAuthn Android/Platform Biometric enrollment & verification + backup passcode
│   │   ├── colorThemes.ts              # 11 color palettes, blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, snapshot-locked vault splits, 2dp FX & account summaries
│   │   ├── deductionIntelligence.ts    # Full-vault debit planning, Top-5 expense learning & deduction rule suggestions
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── BiometricLockScreen.tsx     # Full-screen Android/PWA biometric & backup passcode unlock gate
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Single & multi-entry income batch queue, all-vault automated debits & date-filter feedback
│       ├── FlexibleExpensesView.tsx    # Multi-item expense batch recording with validation, account hydration & date-filtered By Category sync
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated All-Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & snapshot-locked pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds & Group Credit + Earnings workflow
│       ├── RecordCard.tsx              # Transaction detail card rendering snapshot-locked vault split shares
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar)
│       └── SettingsView.tsx            # Settings customization, prospective vault rate controls & App Security / Biometric Lock card
├── server.ts                           # Express server (port 3000) + /api/transfers/automate-savings-vaults + /api/settings/* + /api/security/biometric/* + /api/categories/edit
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.11.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/lib/deductionIntelligence.ts` | Updated `buildAutomatedSavingsVaultDebitPlan` to generate debit plans for every funded Savings Vault (not just vaults with prior debit history), using learned defaults when available and clean vault defaults otherwise. |
| `server.ts` | Removed the prior-history gate in `POST /api/transfers/automate-savings-vaults` so every selected individual Savings Vault receives its automated debit entry. |
| `src/App.tsx` | Added `handleAddIncomes` batch handler and hardened `handleAddIncome` / `handleAddExpenses` with collision-proof IDs, functional state updates, awaited `Promise.all` Firestore writes, explicit account preservation, and date-filter reset callbacks. |
| `src/components/FlexibleExpensesView.tsx` | Added automatic row account hydration, clear multi-row validation feedback so incomplete rows are never silently dropped, and post-save date-filter visibility confirmation with a 1-tap `Show All Dates` button. |
| `src/components/IncomeLogView.tsx` | Added multi-record income batch queue (`+ Add Another Income`, `Save N Incomes`), draft source/origin auto-resolution, all-vault automated debit selection with `Select All / Clear All`, and date-filter visibility notice. |
| `src/components/FloatingQuickActions.tsx` | Enabled all-vault debiting in Quick Transfer, added Quick Expense account hydration, and added `Select All / Clear All` across all funded Savings Vaults in Quick Income. |
| `src/components/AccountsView.tsx` | Removed the 4-card aggregate summary bar between Create Account and Operating Accounts; enabled all-vault manual transfer debiting; added Savings Vault Group Credit mode with exact remaining committed principal tracking, cause filters, editable principal credit, and optional earnings recording. |
| `src/lib/calculations.ts` | Bumped `APP_VERSION` to `4.11.0` and added `v4.11.0` entry to `VERSION_RELEASE_LOG`. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.11.0`. |
| `README.md` | Updated enterprise documentation and `v4.11.0` per-file GitHub commit change log. |
