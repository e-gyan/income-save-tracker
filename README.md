# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.0.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Android & iOS Progressive Web App (PWA) Installation (`vite.config.ts`, `index.html`, `usePWAInstall.ts`, `PWAInstallButton.tsx`, `public/*`)**:
  - **Android One-Tap Installation**: Includes a full Web App Manifest (`display: 'standalone'`, `192x192`, `512x512`, and `512x512 maskable` PNG icons), automated Service Worker precaching via `vite-plugin-pwa`, and an in-app **Install App** button in the top header and menu drawer that triggers Android's native `beforeinstallprompt` dialog.
  - **Offline Resilience**: Caches static application bundles and fonts for fast startup and shows an automatic `<OfflineIndicator />` banner when network connectivity drops while keeping local ledger storage active.
- **Unified 2×2 Record Card & Pop-Up Details Architecture (`RecordCard.tsx`, `server.ts`, `DashboardView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`, `AccountsView.tsx`, `BudgetsView.tsx`, `AnalyticsView.tsx`)**:
  - **Top Left**: **Subcategory** with its intuitive subcategory color indicator (`resolveIntuitiveSubcategoryColor`). Category and subcategory are never doubled on the card face.
  - **Bottom Left**: **Account** name (or `Source → Destination` for transfers).
  - **Top Right**: **Amount**, color-coded by record type: **Emerald** (`text-emerald-600`) for Income, **Red** (`text-rose-600`) for Expense, and **Blue** (`text-blue-600`) for Transfer.
  - **Bottom Right**: **Date only** (`dd/mm/yyyy`). Time (`hh:mm`) is shown inside the pop-up modal.
  - **Strict Separation of Titles from Notes & Descriptions**: Notes and descriptions are never used as the display name or title of any card or record.
  - **Click-to-Expand Pop-Up Modal**: Clicking any record card opens a mobile-scrollable **Record Details Pop-Up Modal** displaying `dd/mm/yyyy, hh:mm`, Category, Subcategory, Account, Recipient/Source, Notes/Description, Deductions, and **Edit** / **Delete** actions.
- **Multi-Purpose Budgets & Goals Engine (`finance.ts`, `budgetCalculations.ts`, `BudgetsView.tsx`, `server.ts`, `App.tsx`)**:
  - Supports **Expense-Linked Budgets** (`purposeType: 'budget'`) and **Transfer & Savings-Linked Goals** (`purposeType: 'goal'`), with configurable auto-recreation after expiry (`autoRecreate`, `recreateDays`) and an **Expired / Disabled** tab.

---

## 2. How to Install Save N Know on an Android Phone

1. Open the shared app URL in **Google Chrome** (or Microsoft Edge / Samsung Internet) on your Android phone.
2. Tap the **Install App** button in the top header bar (or open the top-right **Menu** drawer and tap **Install Now**).
3. Alternatively, tap Chrome's top-right **⋮ (Three Dots)** menu and select **Install app** or **Add to Home screen**.
4. Confirm by tapping **Install**. Save N Know will appear on your Android home screen and app drawer and launch in full-screen standalone mode without browser toolbars.

---

## 3. System Architecture

```text
├── public/
│   ├── icon.svg                        # Brand vector icon
│   ├── pwa-192x192.png                 # Android home screen icon (192x192, purpose: any)
│   ├── pwa-512x512.png                 # Android splash & Play/launcher icon (512x512, purpose: any)
│   ├── pwa-maskable-512x512.png        # Android adaptive maskable icon (512x512, purpose: maskable)
│   └── apple-touch-icon.png            # iOS home screen touch icon (180x180)
├── src/
│   ├── App.tsx                         # Root state orchestrator, budget/goal reconciliation & OfflineIndicator
│   ├── hooks/
│   │   └── usePWAInstall.ts            # BeforeInstallPrompt & standalone detection hook + online/offline status hook
│   ├── components/
│   │   ├── PWAInstallButton.tsx        # In-app Install App button, guided Android/iOS install modal & OfflineIndicator
│   │   ├── RecordCard.tsx              # Unified 2x2 Record Card component & mobile-scrollable Income/Expense/Transfer Pop-Up Modals
│   │   ├── Header.tsx                  # Compact mobile-first static top bar with Install App button, date filters & Menu button
│   │   ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login, PWA install card, Views, Date Filter & Theme
│   │   ├── BudgetsView.tsx             # Multi-purpose Budgets, Goals & Expired/Disabled tabs with 2x2 RecordCard transaction history
│   │   ├── DashboardView.tsx           # Overview workspace with 2x2 RecordCards & pop-up detail modals
│   │   ├── IncomeLogView.tsx           # Income workspace with 2x2 RecordCards & interactive Income Details Pop-Up Modal
│   │   ├── FlexibleExpensesView.tsx    # Expense workspace with 2x2 RecordCards & Expense Details Pop-Up Modal
│   │   ├── AccountsView.tsx            # Multi-account ledger with 2x2 RecordCards in Account History
│   │   ├── AnalyticsView.tsx           # MoM category bar charts, breakdowns & 2x2 RecordCards in Expense Transactions list
│   │   └── SettingsView.tsx            # Settings with Subcategory Move tool, Income Sources/Origins/Account Types, Vaults & Deductions
├── vite.config.ts                      # Vite + VitePWA manifest, service worker & Workbox runtime caching configuration
├── index.html                          # Mobile web app capable meta tags, theme-color & apple-touch-icon links
├── server.ts                           # Express server (port 3000) + API endpoints
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 4. GitHub File Change Summary (`v4.0.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `package.json` | Installed `vite-plugin-pwa` for automated Web App Manifest and Service Worker generation. |
| `vite.config.ts` | Configured `VitePWA` with standalone Android/iOS manifest, `192x192` / `512x512` / `maskable` icons, Workbox offline caching, and `devOptions.enabled: true`. |
| `tsconfig.json` | Added `vite-plugin-pwa/client` to `compilerOptions.types`. |
| `index.html` | Added `theme-color`, `mobile-web-app-capable`, `apple-mobile-web-app-capable`, `apple-touch-icon`, and `icon.svg` links in `<head>`. |
| `public/icon.svg`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/pwa-maskable-512x512.png`, `public/apple-touch-icon.png` | Created compliant brand vector and PNG home screen icons (including safe-zone padded maskable icon for Android adaptive launchers). |
| `src/hooks/usePWAInstall.ts` | Created `usePWAInstall` hook handling `beforeinstallprompt`, `appinstalled`, standalone detection, and `useOnlineStatus` hook. |
| `src/components/PWAInstallButton.tsx` | Created `<PWAInstallButton />` (for header and sidebar drawer) with native Android install prompt trigger, step-by-step phone install guide modal, and `<OfflineIndicator />`. |
| `src/components/Header.tsx` | Mounted `<PWAInstallButton variant="header" />` in the top navigation bar. |
| `src/components/Sidebar.tsx` | Mounted `<PWAInstallButton variant="sidebar" />` inside the top-right menu drawer. |
| `src/App.tsx` | Mounted `<OfflineIndicator />` for non-intrusive offline status feedback. |
| `README.md` | Documented Android PWA installation workflow, architecture, and per-file GitHub change summary. |
