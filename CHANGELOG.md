# Changelog

All notable development changes to **Save N Know** are documented in this file following [Semantic Versioning (`MAJOR.MINOR.PATCH`)](https://semver.org/).

---

## [2.6.3] - 2026-11-07
### Changed
- **App Name Updated to Save N Know**: Updated application branding to **Save N Know** across Header, Sidebar, Settings, HTML metadata, and documentation.

## [2.6.2] - 2026-11-07
### Changed & Improved
- **Pattern-Learned Deduction-to-Expense Category & Subcategory Matching**: Enhanced `resolveDeductionExpenseMapping` and `getEffectiveExpenseCategoryPreferences` to inspect each deduction's name (with singular/plural stemming and token scoring) AND learn from existing recorded expenses (`recipient`, `subcategory`, `category`, `notes`). `"Others to support"` maps to **Subcategory: `Givings`** within **Category: `Giving and Speaking`**, while all other deductions match their corresponding Category and Subcategory.
- **Collapsible Expense Cards & Category Groups (Non-Table Presentation)**: Replaced the expenses table in `FlexibleExpensesView.tsx` with a collapsible **Timeline Cards** feed and **By Category** grouped view with `Expand All / Collapse All`.
- **Accounts-Only Menu Count & Visible Version Control**: Removed record counts from menu options except **Accounts**, and displayed the version control number in the Header, Sidebar, and Settings.

## [2.6.1] - 2026-11-07
### Changed & Improved
- **Income Deduction Expenses Matched to Existing Expense Categories & Subcategories**: Added `resolveDeductionExpenseMapping` and `getEffectiveExpenseCategoryPreferences` so all expenses recorded via income deductions match existing Expense Categories and Subcategories, with `"Others to support"` (and support/giving deductions) automatically matching **Subcategory: `Givings`** within **Category: `Giving and Speaking`**.
- **Inline Category & Subcategory Selectors on Income Deductions & Settings**: Added Category and Subcategory selectors to non-savings deductions in **Income & Deductions** and **Settings** so every deduction expense aligns with the expense hierarchy.

## [2.6.0] - 2026-11-07
### Changed & Added
- **App Rebranded to SaveNKnow**: Updated application name to **SaveNKnow** across `Header.tsx`, `Sidebar.tsx`, `App.tsx`, `index.html`, `package.json`, `render.yaml`, and documentation.
- **Strictly User-Defined Deductions**: Removed pre-seeded default deduction rules (`cut_support_2_5`, `cut_savings_default`) so **Income & Deductions** only presents deductions explicitly defined by the user in **Settings**.
- **Deductions Designated as Expenses & Savings Split Transfers**: Designated all non-savings income deductions as **Expenses** (`getIncomeDeductionExpenses`) and all savings deductions as **Transfers** to the 7 Savings Splits (`30 · 15 · 5 · 20 · 10 · 15 · 5`) (`getSavingsSplitTransfers`) across the calculation engine, Expenses view, Accounts view, and Analytics.
- **Collapsed-by-Default Expandable Forms**: Set all expandable forms and collapsible panels across Overview, Income & Deductions, Expenses, Accounts, and Settings to start collapsed by default.
- **Persistent App Color & Clean Text Wrapping**: Persisted the selected app color theme across sessions and unified all badges, buttons, and charts under the active color palette, while enforcing clean text wrapping (`overflow-wrap: anywhere`, `word-break: break-word`) to prevent overlapping or clipping.
- **Redesigned Analytics & Insights**: Added visual breakdowns per Expense Category & Subcategory, Causes & Recipients ("To"), Deducted Account Outflows, Income Deduction Expenses vs. Recorded Expenses, and 7-Vault Savings Split Transfers & Holding Accounts.

## [2.5.1] - 2026-11-07
### Fixed & Improved
- Locked the top Header and Sub-Header (`Navigation`) in a dedicated viewport frame (`h-screen overflow-hidden flex flex-col`) so they remain 100% static when scrolling through any workspace view.
- Scoped version control strictly to software development releases (`package.json`, `CHANGELOG.md`, and `README.md`) rather than in-app user transaction activity.

## [2.5.0] - 2026-11-07
### Changed
- Upgraded application typography to **Plus Jakarta Sans** (`500–800`), **Space Grotesk** (`600–700`), and **JetBrains Mono** (`500–800`) with OpenType tabular numerals (`tnum`) and stronger contrast for numbers and text.

## [2.4.0] - 2026-11-07
### Added
- **Savings Vault Holding Accounts & Cause Crediting**: Added `Saved in` holding account mapping for each of the 7 Savings Vaults (`30 · 15 · 5 · 20 · 10 · 15 · 5`) and a **Credit Cause** workflow to deploy vault funds toward causes (*Treasury Bond*, *Mutual Funds*, *Buying of Lands*, *Fixed Deposit*, *Equity / ETF*).
- **Multi-Item Expense Recording**: Added the **Expenses** workspace supporting multiple expense rows per recording instance with Date, Deduct From Account, To / Cause, Category, Subcategory, Amount, and Notes.
- **Custom Expense Category & Subcategory Preferences**: Added an unpopulated Category & Subcategory preference manager in **Settings**.
- **Collapsible Color Options & Render Blueprint**: Made Functional App Colors collapsible in **Settings** and added `render.yaml` + dynamic `process.env.PORT` binding in `server.ts`.

## [2.3.0] - 2026-11-07
### Added
- **Research-Backed Functional Color System**: Implemented 8 functional color themes (*Emerald Growth*, *Sapphire Trust*, *Indigo Strategy*, *Teal Liquidity*, *Violet Stewardship*, *Amber Capital*, *Crimson Vigilance*, *Obsidian Ledger*) propagating across all UI surfaces and Analytics charts.

## [2.2.0] - 2026-11-07
### Added
- **Authenticated Account Data Isolation**: Scoped all Firestore subscriptions and local caches strictly to the signed-in user account.
- **Theme Mode & Date Filtering**: Added Light, Dark, and System theme modes and synchronized global date range filters across all views.

## [2.1.0] - 2026-11-07
### Added
- **Analytics Insights & Collapsible Left Drawer**: Added the Analytics view, auto-closing left navigation drawer, editable income sources, and confirmation modals (`ConfirmDeleteModal`) for all delete actions.

## [2.0.0] - 2026-11-07
### Added
- **7-Vault Savings Routing (`30 · 15 · 5 · 20 · 10 · 15 · 5`)**: Automated splitting of savings deductions across the 7 savings vaults, account transfer exclusions (`To` excludes `From`), custom account types, and account history pop-up modals.

## [1.0.0] - 2026-11-07
### Added
- Initial release of SavenKnow with income recording, deduction allocation, multi-account ledger, and Firebase Firestore integration.
