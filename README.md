# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.10.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, biometric app security, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Backend-Managed Prospective Savings Vault Percentages (`server.ts`, `calculations.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Dedicated `POST /api/settings/vault-rates/update` endpoint freezes existing income records' savings deductions with their historical `savingsSplitSnapshot` using the previous vault percentages before applying updated vault rates.
  - Every new income record stamps its active `savingsSplitSnapshot` at save time, and `computeSavingsBreakdownForDeduction` ensures transfers, account balances, analytics, and income cards always calculate historical entries from their locked rates while new incomes use the updated percentages.
- **PWA / Android Biometric App Lock (`biometricAuth.ts`, `BiometricLockScreen.tsx`, `server.ts`, `App.tsx`, `SettingsView.tsx`)**:
  - Opt-in biometric lock gate rendered before any app content is displayed, using WebAuthn platform authenticators (`authenticatorAttachment: 'platform'`, `userVerification: 'required'`) to trigger native Android BiometricPrompt (Fingerprint / Face Unlock / Device Credential), iOS Face ID / Touch ID, or desktop platform biometrics in installed PWAs.
  - Backed by `POST /api/security/biometric/challenge` and `POST /api/security/biometric/verify` with full offline PWA verification, optional salted SHA-256 4–6 digit backup passcode, automatic re-lock on app resume (`visibilitychange`), and clean Settings toggles.
- **Backend-Driven Category & Subcategory Editing with Full Record Cascade (`server.ts`, `App.tsx`, `SettingsView.tsx`, `calculations.ts`)**:
  - Dedicated `POST /api/categories/edit` endpoint atomically updates edited category and/or subcategory names on the backend, preserves subcategory colors, and cascades replacements across all matching **Expenses**, **Income Allocated Deductions**, **Defined Deduction Rules**, and **Budgets**.
- **Backend-Validated Deduction & Category Integrity (`server.ts`, `calculations.ts`, `SettingsView.tsx`)**:
  - Dedicated `POST /api/settings/deductions/define` endpoint locks exact user-selected **Expense Category** and **Subcategory** (including `None`) across the app.
- **Backend-Powered Automated Manual Transfers to Savings Vaults (`server.ts`, `deductionIntelligence.ts`, `AccountsView.tsx`, `FloatingQuickActions.tsx`, `App.tsx`)**:
  - Direct transfer checkbox distributes transfer amounts across active Savings Vaults by percentage rate with 2dp FX conversion and matched automated vault debits.
- **Dynamic Top-5 Frequent Expense Suggestions, Date-Responsive "By Category" View & Expanded Theme Automation**:
  - Learns recurring expense patterns while leaving `To / Cause` and `Notes` blank, aggregates `By Category` with `POST /api/expenses/by-category`, starts Analytics collapsed by default, and includes 11 color palettes plus `6:45 AM/PM` and `Auto` display modes.

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
│   ├── App.tsx                         # Root state orchestrator, BiometricLockScreen gate, visibilitychange relock, prospective vault-rate sync & batch handlers
│   ├── types/
│   │   └── finance.ts                  # TypeScript models (IncomeDeductionItem.savingsSplitSnapshot, UserSettings biometric fields, Accounts, Budgets)
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + experimentalForceLongPolling
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, biometric settings persistence & backend snapshot sync
│   │   ├── biometricAuth.ts            # WebAuthn Android/Platform Biometric enrollment & verification + salted SHA-256 backup passcode & offline fallback
│   │   ├── colorThemes.ts              # 11 color palettes, blended light canvas tints & 6:45 schedule helper
│   │   ├── calculations.ts             # Allocation engine, snapshot-locked computeSavingsBreakdownForDeduction, 2dp FX & account summaries
│   │   ├── deductionIntelligence.ts    # Vault distribution & debit planning, Top-5 expense learning & deduction rule suggestions
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation, FX conversion rates & recurring period auto-recreation
│   └── components/
│       ├── BiometricLockScreen.tsx     # Full-screen Android/PWA biometric & backup passcode unlock gate blocking app content
│       ├── Navigation.tsx              # Mobile date filter + renderNavIcon + 5-item icon+label BottomMenuBar
│       ├── Header.tsx                  # Static top navigation bar with clickable Overview brand, date filter & drawer trigger
│       ├── Sidebar.tsx                 # Collapsible top-right drawer with 2x2 Display Mode selector, Color Palette swatches & 7 nav views
│       ├── IncomeLogView.tsx           # Income recording, draft-smooth deductions & snapshot-locked historical split display
│       ├── FlexibleExpensesView.tsx    # Multi-item expense recording, blank To/Notes suggestions & date-filtered By Category sync with backend
│       ├── FloatingQuickActions.tsx    # Quick-add modals (Automated Vault Transfer, Income, Quick Expense)
│       ├── DashboardView.tsx           # Overview with unified Savings Accumulated & Allocation Flow
│       ├── AnalyticsView.tsx           # Analytics charts & snapshot-locked pillar metrics (all sections collapsed by default)
│       ├── AccountsView.tsx            # Operating Accounts, Savings Vaults, Transfer Funds & snapshot-locked routed transfer history
│       ├── RecordCard.tsx              # Transaction detail card rendering snapshot-locked vault split shares
│       ├── SavingsDetailView.tsx       # Savings pillars & sub-bucket distribution across deductions and manual vault transfers
│       ├── EditExpenseModal.tsx        # Standalone expense editing modal
│       ├── BudgetsView.tsx             # Multi-purpose Budgets & Goals view (accessible via Sidebar)
│       └── SettingsView.tsx            # Settings customization, prospective vault rate controls & App Security / Biometric Lock card
├── server.ts                           # Express server (port 3000) + /api/settings/vault-rates/update + /api/security/biometric/* + /api/categories/edit + /api/transfers/*
├── firebase-blueprint.json             # Firestore entity blueprint schema
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.10.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `src/types/finance.ts` | Added `savingsSplitSnapshot?: SavingsSplitShare[]` to `IncomeDeductionItem` and `biometricLockEnabled` / `biometricLockOnResume` preferences to `UserSettings`. |
| `src/lib/biometricAuth.ts` | Created WebAuthn platform authenticator module for Android BiometricPrompt / PWA biometric enrollment and verification, plus salted SHA-256 backup passcode support and offline fallback. |
| `src/components/BiometricLockScreen.tsx` | Created full-screen biometric lock gate rendered before app content with automatic native biometric prompt, retry control, and backup passcode fallback. |
| `server.ts` | Added `POST /api/settings/vault-rates/update` to freeze existing income vault splits using prior rates before saving new percentages, plus `POST /api/security/biometric/challenge` and `POST /api/security/biometric/verify` WebAuthn routes. |
| `src/lib/calculations.ts` | Exported `computeSavingsBreakdownForDeduction` to evaluate income deductions from frozen `savingsSplitSnapshot` entries across transfers, allocations, and account summaries; bumped `APP_VERSION` to `4.10.0`. |
| `src/lib/firestoreService.ts` | Persisted `biometricLockEnabled` and `biometricLockOnResume` fields in `fetchUserSettings` and `saveUserSettings`. |
| `src/App.tsx` | Wired `BiometricLockScreen` startup/resume lock gate, added `handleUpdateSavingsVaultRates` with offline fallback and chunked Firestore sync, and stamped `savingsSplitSnapshot` onto newly recorded incomes. |
| `src/components/SettingsView.tsx` | Routed Savings Vault rate edits through `onUpdateSavingsVaultRates` with prospective-update confirmation notice, and added the collapsible App Security & Biometric Lock card. |
| `src/components/AccountsView.tsx` | Switched incoming routed deduction breakdown to `computeSavingsBreakdownForDeduction` so historical account history preserves prior vault percentages. |
| `src/components/AnalyticsView.tsx` | Switched savings pillar aggregation to `computeSavingsBreakdownForDeduction` so historical analytics remain unchanged after vault rate updates. |
| `src/components/RecordCard.tsx` | Switched income card savings split breakdown to `computeSavingsBreakdownForDeduction` to display each record's locked vault percentages. |
| `src/components/IncomeLogView.tsx` | Switched recorded income card savings split breakdown to `computeSavingsBreakdownForDeduction` while keeping new-income previews on active rates. |
| `src/components/Header.tsx` | Bumped `APP_VERSION` to `4.10.0`. |
| `firebase-blueprint.json` | Documented `biometricLockEnabled` and `biometricLockOnResume` fields under `UserSettings`. |
| `README.md` | Updated enterprise documentation and `v4.10.0` per-file GitHub commit change log. |

