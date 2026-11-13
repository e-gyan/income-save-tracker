# Save N Know: Enterprise Financial Allocation and Multi-Account Ledger (`v4.1.0`)

**Save N Know** is an installable Progressive Web App (PWA) and enterprise-grade personal and business capital allocation, multi-account ledger, multi-purpose expense budgeting & savings/transfer goal tracking, account-driven FX currency conversion, file import & ingestion, expense intelligence, and automated savings vault platform built with React 19, TypeScript, Tailwind CSS v4, Express, and Firebase (Authentication and Cloud Firestore).

---

## 1. Core Product Capabilities

- **Offline Logged-In Data Continuity & Instant Zero-Wait Refresh (`firebase.ts`, `firestoreService.ts`, `server.ts`, `App.tsx`, `Sidebar.tsx`)**:
  - **Firestore Persistent IndexedDB Cache**: Initialized Cloud Firestore with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` so signed-in users' Firestore collections (`settings`, `accounts`, `incomes`, `flexible_expenses`, `transfers`, `budgets`, `revisions`) remain available for reading and writing offline directly against their authenticated cloud cache without falling back to the unauthenticated local/guest ledger.
  - **Zero-Wait Refresh & Startup Hydration**: Persists the authenticated user session (`savenknow_authenticated_user_session`) and synchronously hydrates `currentUser`, `settings`, `accounts`, `incomes`, `expenses`, `transfers`, and `budgets` on initial mount (frame 0) from the signed-in user's UID-scoped cloud cache and backend cloud-session snapshot (`/api/session/cloud-snapshot/:uid`), eliminating loading delays on app launch or browser refresh.
- **Accounting Figure Color Override Configurable in Settings (`index.css`, `colorThemes.ts`, `finance.ts`, `SettingsView.tsx`, `App.tsx`)**:
  - Overrides the global app theme color specifically for monetary figures so **positive figures** render in **Emerald/Green** (`--figure-positive-color`, default `#059669`) and **negative figures** render in **Red** (`--figure-negative-color`, default `#e11d48`) as used in standard accounting.
  - **Configurable in Settings**: Users can toggle the accounting figure color override and choose their preferred positive figure shade (`Emerald #059669`, `Classic Green #16a34a`, `Forest Green #15803d`, `Teal Green #0d9488`) and negative figure shade (`Crimson Red #e11d48`, `Accounting Red #dc2626`, `Deep Ruby #b91c1c`, `Coral Red #ef4444`) directly inside **Settings → Appearance & Currency → Accounting Figure Colors**.
- **Dedicated Typography for Text vs. Figures (`index.html`, `index.css`)**:
  - **Text Font**: Uses **DM Sans** (`--font-sans`) for body copy, labels, and controls and **Outfit** (`--font-display`) for headings with natural proportional kerning.
  - **Figures Font**: Preserves **JetBrains Mono** (`--font-mono`, `tabular-nums`) strictly for all monetary figures, percentages, dates, and numerical metrics.
- **Android & iOS Progressive Web App (PWA) Installation (`vite.config.ts`, `index.html`, `usePWAInstall.ts`, `PWAInstallButton.tsx`, `public/*`)**:
  - **Android One-Tap Installation**: Includes a full Web App Manifest (`display: 'standalone'`, `192x192`, `512x512`, and `512x512 maskable` PNG icons), automated Service Worker precaching via `vite-plugin-pwa`, and an in-app **Install App** button in the top header and menu drawer.
- **Unified 2×2 Record Card & Pop-Up Details Architecture (`RecordCard.tsx`, `server.ts`, `DashboardView.tsx`, `IncomeLogView.tsx`, `FlexibleExpensesView.tsx`, `AccountsView.tsx`, `BudgetsView.tsx`, `AnalyticsView.tsx`)**:
  - **Top Left**: **Subcategory** with its intuitive subcategory color indicator (`resolveIntuitiveSubcategoryColor`). Category and subcategory are never doubled on the card face.
  - **Bottom Left**: **Account** name (or `Source → Destination` for transfers).
  - **Top Right**: **Amount**, color-coded by record type: **Emerald/Green** (`text-emerald-600`) for Income, **Red** (`text-rose-600`) for Expense, and **Blue** (`text-blue-600`) for Transfer.
  - **Bottom Right**: **Date only** (`dd/mm/yyyy`). Time (`hh:mm`) is shown inside the pop-up modal.

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
│   ├── App.tsx                         # Root state orchestrator with synchronous frame-0 cloud cache hydration
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase Auth + Firestore persistentLocalCache (IndexedDB) + persisted auth session
│   │   ├── firestoreService.ts         # Real-time Firestore subscriptions, UID-scoped cloud cache & backend snapshot sync
│   │   ├── colorThemes.ts              # Functional color themes + Accounting Figure Color presets & CSS variable engine
│   │   ├── calculations.ts             # Allocation engine, 2dp currency reconciliation & savings vault logic
│   │   └── budgetCalculations.ts       # Multi-purpose Budgets & Goals evaluation and recurring period auto-recreation
│   ├── hooks/
│   │   └── usePWAInstall.ts            # BeforeInstallPrompt & standalone detection hook + online/offline status hook
│   ├── components/
│   │   ├── PWAInstallButton.tsx        # In-app Install App button, guided Android/iOS install modal & OfflineIndicator
│   │   ├── RecordCard.tsx              # Unified 2x2 Record Card component & mobile-scrollable Income/Expense/Transfer Pop-Up Modals
│   │   ├── Header.tsx                  # Compact mobile-first static top bar with Install App button, date filters & Menu button
│   │   ├── Sidebar.tsx                 # Top-right menu drawer bundling Account/Login, PWA install card, Views, Date Filter & Theme
│   │   └── SettingsView.tsx            # Settings with Accounting Figure Colors, Subcategory Move tool, Vaults & Deductions
├── vite.config.ts                      # Vite + VitePWA manifest, service worker & Workbox runtime caching configuration
├── index.html                          # DM Sans + Outfit text fonts, JetBrains Mono figure font & PWA meta tags
├── server.ts                           # Express server (port 3000) + /api/session/cloud-snapshot/:uid + FX & AI routes
└── README.md                           # Enterprise documentation & GitHub commit change log
```

---

## 3. GitHub File Change Summary (`v4.1.0`)

Brief summary of changes per file for GitHub commit and release notes:

| File Path | Summary of Changes for GitHub |
| :--- | :--- |
| `index.html` | Loaded `DM Sans` and `Outfit` from Google Fonts for body and display text while retaining `JetBrains Mono` strictly for figures. |
| `src/index.css` | Updated `--font-sans` to `'DM Sans'` and `--font-display` to `'Outfit'` while keeping `--font-mono` (`'JetBrains Mono'`) for `.font-mono` and `.tabular-nums`; removed theme-accent override on `.text-emerald-*` and `.text-rose-*` so positive figures use `--figure-positive-color` (emerald/green) and negative figures use `--figure-negative-color` (red). |
| `src/types/finance.ts` | Added `accountingFigureColorsEnabled`, `positiveFigureColor`, and `negativeFigureColor` fields to `UserSettings`. |
| `src/lib/colorThemes.ts` | Added `ACCOUNTING_POSITIVE_COLORS` and `ACCOUNTING_NEGATIVE_COLORS` presets, local persistence helpers, and `applyAccountingFigureColorsToDocument`. |
| `src/lib/calculations.ts` | Added default accounting figure color settings to `DEFAULT_USER_SETTINGS`. |
| `src/lib/firebase.ts` | Enabled Firestore `persistentLocalCache` with `persistentMultipleTabManager` for offline signed-in cloud data continuity and added `getPersistedAuthUser` / `setPersistedAuthUser` / `clearPersistedAuthUser` so signed-in sessions remain active offline without dropping into the local guest ledger. |
| `src/lib/firestoreService.ts` | Persisted accounting figure color settings in `fetchUserSettings` and `saveUserSettings` and added `syncAuthenticatedCloudSnapshotToBackend` and `hydrateAuthenticatedCloudSnapshotFromBackend`. |
| `server.ts` | Added `GET /api/session/cloud-snapshot/:uid` and `POST /api/session/cloud-snapshot/:uid` endpoints to store and serve authenticated cloud snapshots for instant refresh and offline continuity. |
| `src/App.tsx` | Synchronously initialized `currentUser`, `settings`, `accounts`, `incomes`, `expenses`, `transfers`, and `budgets` on frame 0 from the persisted authenticated user's cloud cache for zero-wait refresh and applied accounting figure color overrides. |
| `src/components/Sidebar.tsx` | Initialized `user` synchronously from `getPersistedAuthUser()` so the account drawer always reflects the signed-in user immediately on refresh and when offline. |
| `src/components/PWAInstallButton.tsx` | Updated `<OfflineIndicator />` to indicate active signed-in cloud cache when offline. |
| `src/components/SettingsView.tsx` | Added **Accounting Figure Colors** section under Appearance & Currency allowing users to toggle the accounting color override and select positive (Emerald/Green) and negative (Red) figure colors. |
| `firebase-blueprint.json` | Added `accountingFigureColorsEnabled`, `positiveFigureColor`, and `negativeFigureColor` to `UserSettings` schema. |
| `README.md` | Documented offline signed-in cloud cache continuity, zero-wait refresh architecture, accounting figure color overrides, typography separation, and per-file GitHub commit summary. |
