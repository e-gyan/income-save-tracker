/**
 * Financial Allocation & Account Ledger Calculation Engine
 * Intelligently breaks down Savings deductions into 30, 15, 5, 20, 10, 15, and 5
 * and routes each share to its dedicated account.
 */

import {
  UserSettings,
  IncomeReceipt,
  IncomeDeductionItem,
  SavingsSplitShare,
  FlexibleExpense,
  AllocationResult,
  ItemizedDeduction,
  SavingsBucket,
  Quarter,
  QuarterlyRates,
  FinancialAccount,
  AccountTransfer,
  ExpenseCategoryPreference,
  CustomDeduction,
} from '../types/finance.ts';
import {
  getPersistedColorTheme,
  getPersistedThemeMode,
  getPersistedAccountingFiguresEnabled,
  getPersistedPositiveFigureColor,
  getPersistedNegativeFigureColor,
} from './colorThemes.ts';
import {
  convertCurrency2dp,
  getAccountCurrency,
  roundTo2Decimals,
  MarketFxSnapshot,
} from './currencyService.ts';

export const SAVINGS_SPLIT_PILLARS: {
  bucketId: string;
  accountId: string;
  name: string;
  percentage: number;
  institution: string;
  color: string;
  description: string;
}[] = [
  {
    bucketId: 'bucket-30-emg',
    accountId: 'acc-30-emg',
    name: 'Emergency Fund (30%)',
    percentage: 30,
    institution: 'Savings Vault · 30%',
    color: '#059669',
    description: '30% savings share',
  },
  {
    bucketId: 'bucket-15-emg',
    accountId: 'acc-15-emg',
    name: 'Emergency Reserve (15%)',
    percentage: 15,
    institution: 'Savings Vault · 15%',
    color: '#10b981',
    description: '15% savings share',
  },
  {
    bucketId: 'bucket-5-ins',
    accountId: 'acc-5-ins',
    name: 'Insurance Fund (5%)',
    percentage: 5,
    institution: 'Savings Vault · 5%',
    color: '#0284c7',
    description: '5% savings share',
  },
  {
    bucketId: 'bucket-20-inv',
    accountId: 'acc-20-inv',
    name: 'Investment Fund (20%)',
    percentage: 20,
    institution: 'Savings Vault · 20%',
    color: '#4f46e5',
    description: '20% savings share',
  },
  {
    bucketId: 'bucket-10-pers',
    accountId: 'acc-10-pers',
    name: 'Personal Fund (10%)',
    percentage: 10,
    institution: 'Savings Vault · 10%',
    color: '#7c3aed',
    description: '10% savings share',
  },
  {
    bucketId: 'bucket-15-seeds',
    accountId: 'acc-15-seeds',
    name: 'Seed Capital (15%)',
    percentage: 15,
    institution: 'Savings Vault · 15%',
    color: '#d97706',
    description: '15% savings share',
  },
  {
    bucketId: 'bucket-5-give',
    accountId: 'acc-5-give',
    name: 'Giving Fund (5%)',
    percentage: 5,
    institution: 'Savings Vault · 5%',
    color: '#e11d48',
    description: '5% savings share',
  },
];

export const SAVINGS_ACCOUNT_IDS = new Set(
  SAVINGS_SPLIT_PILLARS.map((p) => p.accountId)
);

export const LEGACY_AUTO_ACCOUNT_IDS = new Set([
  'acc-2-5-support',
  'acc-proj-bldg',
  'acc-subs',
  'acc-data',
]);

export const LEGACY_SEEDED_CUT_IDS = new Set([
  'cut_support_2_5',
  'cut_savings_default',
]);

export const DEFAULT_FINANCIAL_ACCOUNTS: FinancialAccount[] = [
  {
    id: 'acc-main-op',
    name: 'Primary Operating Account',
    type: 'Operating Checking',
    institution: 'Primary Bank',
    isDefaultDeposit: true,
    isVirtual: false,
    initialBalance: 0,
    color: '#0f172a',
    description: 'Default receiving account for income records and operating cash flow.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  ...SAVINGS_SPLIT_PILLARS.map((pillar) => ({
    id: pillar.accountId,
    name: pillar.name,
    type: 'Savings Pillar',
    institution: pillar.institution,
    isDefaultDeposit: false,
    isVirtual: true,
    custodianAccountId: 'acc-main-op',
    initialBalance: 0,
    color: pillar.color,
    linkedSavingsBucketId: pillar.bucketId,
    description: pillar.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
];

export const DEFAULT_SAVINGS_BUCKETS: SavingsBucket[] = SAVINGS_SPLIT_PILLARS.map(
  (pillar) => ({
    id: pillar.bucketId,
    name: pillar.name,
    percentage: pillar.percentage,
    accountId: pillar.accountId,
    isVirtual: true,
    custodianAccountId: 'acc-main-op',
    description: pillar.description,
  })
);

export const DEFAULT_QUARTERLY_RATES: QuarterlyRates = {
  q1TargetRate: 0,
  q2TargetRate: 0,
  q3TargetRate: 0,
  q4TargetRate: 0,
};

export const LEGACY_PREDEFINED_INCOME_CATEGORIES = new Set<string>([
  'Consulting',
  'Salary',
  'Retainer',
  'Project Fee',
  'Sales',
  'Contract',
  'Dividends',
  'Other',
  'Consulting & Advisory',
  'Speaking & Honorarium',
  'Business & Dividends',
  'Project Milestone',
  'Royalties & Licensing',
  'Gift & Support',
  'Other Income',
]);

export const LEGACY_PREDEFINED_ACCOUNT_TYPES = new Set<string>([
  'Operating Account',
  'Checking Account',
  'Savings Account',
  'Mobile Money Wallet',
  'Investment Account',
  'Treasury / Reserve',
  'Emergency Fund',
  'Project Escrow',
  'Cash Vault',
  'Investment / Custody',
  'Mobile Wallet',
  'Cash / Vault',
]);

export const LEGACY_PREDEFINED_INCOME_SOURCES = new Set<string>([
  'Monthly Salary',
  'Client Retainer',
  'Consulting Fee',
  'Project Milestone',
  'Contract Payout',
  'Business Revenue',
  'Dividend / Return',
  'Quarterly Bonus',
  'Consulting Retainer',
  'Speaking Honorarium',
  'Dividend / Yield',
  'Advisory Fee',
]);

export const LEGACY_PREDEFINED_INCOME_ORIGINS = new Set<string>([
  'Primary Employer',
  'Corporate Client',
  'Freelance / Agency',
  'Business Operations',
  'Treasury & Dividends',
  'Partner Organization',
  'Client Organization',
  'Board / Institution',
  'Business Venture',
  'Investment Portfolio',
  'Partner / Sponsor',
]);

export const DEFAULT_INCOME_CATEGORIES: string[] = [];

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [];

export const DEFAULT_ACCOUNT_TYPES: string[] = [];

export const DEFAULT_INCOME_SOURCES: string[] = [];

export const DEFAULT_INCOME_ORIGINS: string[] = [];

export const DEFAULT_USER_SETTINGS: UserSettings = {
  userId: 'default_user',
  currency: 'GHS',
  totalsCurrencyMode: 'base',
  themeMode: getPersistedThemeMode(),
  colorTheme: getPersistedColorTheme(),
  accountingFigureColorsEnabled: getPersistedAccountingFiguresEnabled(),
  positiveFigureColor: getPersistedPositiveFigureColor(),
  negativeFigureColor: getPersistedNegativeFigureColor(),
  subscriptionFee: 0,
  dataBundleFee: 0,
  projectBuildingsRate: 0,
  customCuts: [],
  savingsBuckets: DEFAULT_SAVINGS_BUCKETS,
  quarterlyRates: DEFAULT_QUARTERLY_RATES,
  incomeCategories: DEFAULT_INCOME_CATEGORIES,
  incomeSources: DEFAULT_INCOME_SOURCES,
  incomeOrigins: DEFAULT_INCOME_ORIGINS,
  expenseCategories: [],
  expenseCategoryPreferences: [],
  vaultCustodianAccounts: {},
  accountTypes: DEFAULT_ACCOUNT_TYPES,
  defaultAccountId: '',
  askNetIncomeTransfer: true,
  defaultNetIncomeAccountId: '',
  updatedAt: new Date().toISOString(),
};

/**
 * Computes continuous standard Semantic Versioning (MAJOR.MINOR.PATCH)
 */
export function getNextSemanticVersion(
  currentSemver?: string,
  bumpType: 'major' | 'minor' | 'patch' = 'patch',
  fallbackVersionNumber = 1
): string {
  let major = 1;
  let minor = 0;
  let patch = Math.max(0, fallbackVersionNumber - 1);

  if (currentSemver && /^\d+\.\d+\.\d+$/.test(currentSemver.trim())) {
    const parts = currentSemver.trim().split('.').map(Number);
    major = parts[0] || 1;
    minor = parts[1] || 0;
    patch = parts[2] || 0;
  }

  if (bumpType === 'major') {
    return `${major + 1}.0.0`;
  }
  if (bumpType === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function formatSemanticVersion(rev?: {
  semanticVersion?: string;
  versionNumber?: number;
}): string {
  if (!rev) return '1.0.0';
  if (rev.semanticVersion && /^\d+\.\d+\.\d+$/.test(rev.semanticVersion.trim())) {
    return rev.semanticVersion.trim();
  }
  const n = Math.max(1, Number(rev.versionNumber || 1));
  return `1.0.${n - 1}`;
}

/**
 * Intelligently determines if a deduction item is a Savings deduction that should be
 * broken down into 30, 15, 5, 20, 10, 15, and 5 and routed to the 7 savings accounts.
 */
export function isSavingsDeduction(ded: {
  name?: string;
  isSavingsSplit?: boolean;
  destinationAccountId?: string;
}): boolean {
  if (ded.isSavingsSplit === true) return true;
  if (ded.isSavingsSplit === false) return false;
  if (ded.destinationAccountId) return false;
  const lower = (ded.name || '').toLowerCase().trim();
  return lower.includes('saving') || lower.includes('save');
}

/**
 * Strips any trailing `(XX%)` percentage inscription from a vault name
 * so Savings Vault cards show only the clean vault name.
 */
export function getVaultCleanName(name?: string): string {
  return (name || '')
    .replace(/\s*\(\d+(?:\.\d+)?%\)\s*$/, '')
    .trim();
}

/**
 * Returns the effective Savings Vault pillars driven by `settings.savingsBuckets`.
 * Supports adding new vaults, renaming vaults, editing rates (%), virtual attachment, and deleting vaults in Settings.
 */
export function getEffectiveSavingsPillars(settings?: UserSettings): {
  bucketId: string;
  accountId: string;
  name: string;
  baseName: string;
  percentage: number;
  institution: string;
  color: string;
  description: string;
  isVirtual: boolean;
  custodianAccountId?: string;
}[] {
  const palette = [
    '#059669',
    '#10b981',
    '#0284c7',
    '#4f46e5',
    '#7c3aed',
    '#d97706',
    '#e11d48',
    '#0d9488',
    '#2563eb',
  ];

  const sourceBuckets: SavingsBucket[] =
    settings && Array.isArray(settings.savingsBuckets)
      ? settings.savingsBuckets
      : DEFAULT_SAVINGS_BUCKETS;

  return sourceBuckets.map((bucket, idx) => {
    const defaultPillar = SAVINGS_SPLIT_PILLARS.find(
      (p) => p.bucketId === bucket.id || p.accountId === bucket.accountId
    );
    const bucketId =
      bucket.id || defaultPillar?.bucketId || `bucket_sav_${idx + 1}`;
    const accountId =
      bucket.accountId || defaultPillar?.accountId || `acc_sav_${bucketId}`;
    const pct =
      typeof bucket.percentage === 'number' &&
      Number.isFinite(bucket.percentage) &&
      bucket.percentage >= 0
        ? Math.round(bucket.percentage * 100) / 100
        : defaultPillar?.percentage ?? 0;

    const rawName = (
      bucket.name ||
      defaultPillar?.name ||
      'Savings Vault'
    ).trim();
    const baseName =
      getVaultCleanName(rawName) ||
      getVaultCleanName(defaultPillar?.name) ||
      'Savings Vault';
    const formattedName = `${baseName} (${pct}%)`;

    return {
      bucketId,
      accountId,
      name: formattedName,
      baseName,
      percentage: pct,
      institution: `Savings Vault · ${pct}%`,
      color: defaultPillar?.color || palette[idx % palette.length],
      description: `${pct}% savings share`,
      isVirtual: bucket.isVirtual !== false,
      custodianAccountId:
        settings?.vaultCustodianAccounts?.[accountId] ||
        bucket.custodianAccountId,
    };
  });
}

/**
 * Returns the set of active Savings Vault account IDs from Settings.
 */
export function getSavingsVaultAccountIds(settings?: UserSettings): Set<string> {
  const pillars = getEffectiveSavingsPillars(settings);
  return new Set(pillars.map((p) => p.accountId));
}

/**
 * Determines whether a FinancialAccount is a Savings Vault account.
 */
export function isSavingsVaultAccount(
  account?:
    | Pick<FinancialAccount, 'id' | 'type' | 'linkedSavingsBucketId'>
    | null,
  settings?: UserSettings
): boolean {
  if (!account) return false;
  if (SAVINGS_ACCOUNT_IDS.has(account.id)) return true;
  if (account.id.startsWith('acc_sav_') || account.id.startsWith('acc-')) {
    const activeIds = getSavingsVaultAccountIds(settings);
    if (activeIds.has(account.id)) return true;
  }
  if (
    account.type === 'Savings Pillar' ||
    Boolean(account.linkedSavingsBucketId)
  ) {
    return true;
  }
  return getSavingsVaultAccountIds(settings).has(account.id);
}

/**
 * Determines whether an account (Operating Account or Savings Vault) is a Virtual account
 * attached to a non-virtual Main Account.
 */
export function isAccountVirtual(
  account?:
    | Pick<
        FinancialAccount,
        'id' | 'type' | 'linkedSavingsBucketId' | 'isVirtual'
      >
    | null,
  settings?: UserSettings
): boolean {
  if (!account) return false;
  if (isSavingsVaultAccount(account, settings)) {
    const pillar = getEffectiveSavingsPillars(settings).find(
      (p) =>
        p.accountId === account.id ||
        (account.linkedSavingsBucketId &&
          p.bucketId === account.linkedSavingsBucketId)
    );
    if (pillar !== undefined) {
      return account.isVirtual !== undefined
        ? Boolean(account.isVirtual)
        : pillar.isVirtual;
    }
    return account.isVirtual !== false;
  }
  return Boolean(account.isVirtual);
}

/**
 * Returns the list of non-virtual Operating Accounts (Main Accounts) that virtual accounts
 * and savings vaults can be attached to.
 */
export function getNonVirtualOperatingAccounts(
  accounts: FinancialAccount[],
  settings?: UserSettings
): FinancialAccount[] {
  const operating = accounts.filter(
    (a) => !isSavingsVaultAccount(a, settings)
  );
  const nonVirtual = operating.filter((a) => !a.isVirtual);
  if (nonVirtual.length > 0) return nonVirtual;
  if (operating.length > 0) return [operating[0]];
  return [DEFAULT_FINANCIAL_ACCOUNTS[0]];
}

/**
 * Resolves the non-virtual Main Account ID that a virtual account or savings vault is attached to.
 * Returns `''` if the account is not virtual.
 */
export function resolveAttachedMainAccountId(
  account: FinancialAccount | undefined | null,
  accounts: FinancialAccount[],
  settings?: UserSettings
): string {
  if (!account || !isAccountVirtual(account, settings)) {
    return '';
  }
  const mainAccounts = getNonVirtualOperatingAccounts(accounts, settings).filter(
    (m) => m.id !== account.id
  );
  if (mainAccounts.length === 0) return '';

  const isVault = isSavingsVaultAccount(account, settings);
  const candidateId = (
    (isVault ? settings?.vaultCustodianAccounts?.[account.id] : undefined) ||
    account.custodianAccountId ||
    ''
  ).trim();

  if (candidateId && mainAccounts.some((m) => m.id === candidateId)) {
    return candidateId;
  }
  if (
    candidateId === 'acc_main' &&
    mainAccounts.some((m) => m.id === 'acc-main-op')
  ) {
    return 'acc-main-op';
  }
  if (
    candidateId === 'acc-main-op' &&
    mainAccounts.some((m) => m.id === 'acc_main')
  ) {
    return 'acc_main';
  }

  const defaultMain =
    (settings?.defaultAccountId
      ? mainAccounts.find((m) => m.id === settings.defaultAccountId)
      : undefined) ||
    mainAccounts.find((m) => m.isDefaultDeposit) ||
    mainAccounts[0];
  return defaultMain?.id || '';
}

/**
 * Formats the current savings vault rate sequence (e.g. "30 · 15 · 5 · 20 · 10 · 15 · 5" or "30/15/5/20/10/15/5")
 * reflecting any edits made in Settings.
 */
export function formatSavingsSplitSequence(
  settings?: UserSettings,
  separator = ' · '
): string {
  const pillars = getEffectiveSavingsPillars(settings);
  if (pillars.length === 0) return '0';
  return pillars.map((p) => p.percentage).join(separator);
}

/**
 * Breaks a deducted Savings amount down according to the user's configured Savings Vault rates
 * and maps each share to its dedicated account.
 */
export function computeSavingsBreakdown(
  deductedAmount: number,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS,
  settings?: UserSettings
): SavingsSplitShare[] {
  const pillars = getEffectiveSavingsPillars(settings);
  const total = Math.max(0, Math.round((Number(deductedAmount) || 0) * 100) / 100);
  if (total <= 0) {
    return pillars.map((p) => {
      const acc =
        accounts.find((a) => a.id === p.accountId) ||
        accounts.find((a) => a.linkedSavingsBucketId === p.bucketId);
      return {
        bucketId: p.bucketId,
        bucketName: p.name,
        percentage: p.percentage,
        amount: 0,
        accountId: acc?.id || p.accountId,
        accountName: p.name,
      };
    });
  }

  const totalRateSum = pillars.reduce((sum, p) => sum + p.percentage, 0);
  const lastActiveIdx = pillars.reduce(
    (lastIdx, p, idx) => (p.percentage > 0 ? idx : lastIdx),
    pillars.length - 1
  );

  let runningSum = 0;
  return pillars.map((p, index) => {
    const acc =
      accounts.find((a) => a.id === p.accountId) ||
      accounts.find((a) => a.linkedSavingsBucketId === p.bucketId) ||
      accounts.find(
        (a) =>
          getVaultCleanName(a.name).toLowerCase() ===
          p.baseName.toLowerCase()
      );

    let shareAmount: number;
    if (p.percentage <= 0) {
      shareAmount = 0;
    } else if (
      Math.abs(totalRateSum - 100) < 0.01 &&
      index === lastActiveIdx
    ) {
      // Ensure exact penny reconciliation across active vaults when rates total 100%
      shareAmount = Math.max(0, Math.round((total - runningSum) * 100) / 100);
    } else {
      shareAmount = Math.round(((total * p.percentage) / 100) * 100) / 100;
      runningSum += shareAmount;
    }

    return {
      bucketId: p.bucketId,
      bucketName: p.name,
      percentage: p.percentage,
      amount: shareAmount,
      accountId: acc?.id || p.accountId,
      accountName: p.name,
    };
  });
}

/**
 * Computes the monetary deduction amount for a single deduction rule against a gross income amount.
 */
export function computeDeductionAmount(
  grossAmount: number,
  type: 'percentage' | 'fixed',
  value: number
): number {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const cleanVal = Math.max(0, Number(value) || 0);
  if (type === 'fixed') {
    return Math.round(cleanVal * 100) / 100;
  }
  return Math.round(((gross * cleanVal) / 100) * 100) / 100;
}

export const APP_VERSION = '4.2.0';

export const VERSION_RELEASE_LOG: {
  version: string;
  date: string;
  summary: string;
}[] = [
  {
    version: '4.2.0',
    date: '2026-11-14',
    summary:
      'Updated terminology from Records to Transactions (including Recent Transactions By), added live foreign currency conversion rate display and backend multi-currency intelligence on Budgets & Goals, enabled automatic recreation for Weekly/Monthly/Yearly periods while requiring recreation definition only on Custom periods, added action confirmation notifications on all delete buttons, and enabled seamless textbox modification in Settings.',
  },
  {
    version: '3.3.0',
    date: '2026-11-11',
    summary:
      'Added a global Settings toggle to switch between viewing all totals in the system base currency or in each account original currency, applying real-time 2-point floating market rate conversions where necessary.',
  },
  {
    version: '3.2.0',
    date: '2026-11-11',
    summary:
      'Account-driven currency architecture: saves new incomes in the receiving account currency without conversion, converts consolidated app totals using real-time 2-point floating market rates, and performs real-time currency conversion when spending or transferring from non-base currency accounts.',
  },
  {
    version: '3.1.0',
    date: '2026-11-11',
    summary:
      'Seamless backend file import in Settings (.csv, .tsv, .json, .txt, .md, .pdf, .bak) with database persistence, automatic real-time 2-point floating currency conversion without manual rate entry, account native currency display across the app, and real-time conversion on spending and transfers.',
  },
  {
    version: '3.0.0',
    date: '2026-11-11',
    summary:
      'Real-time market exchange rate synchronization (2-point floating conversion), flexible currency selection when creating/editing accounts and income records, and updated terminology across the app (Total Income and Savings Accumulated).',
  },
  {
    version: '2.9.0',
    date: '2026-11-11',
    summary:
      'Intuitive backend expense subcategory color engine with semantic domain matching, deterministic fallback hashing, Firestore persistence, and interactive subcategory color customization in Settings.',
  },
  {
    version: '2.8.0',
    date: '2026-11-10',
    summary:
      'Virtual account & savings vault attachment to non-virtual Main Accounts (reflecting figures in both while taking total from Main Accounts), Savings Vault Debit & Credit for causes, negative initial balance support on account creation/edit, and red/emerald balance & expense indicators.',
  },
  {
    version: '2.7.3',
    date: '2026-11-08',
    summary:
      'Fixed Net Income after deductions persistence, Firestore security rules, account ID resolution, default destination account routing, interactive Net Income transfer controls on income records, and Ledger History reconciliation.',
  },
  {
    version: '2.7.2',
    date: '2026-11-08',
    summary:
      'Non-retroactive quarterly savings rate changes (apply only to subsequent records), custom per-income savings rate overrides, real-time account figure synchronization across all views, and Net Income after-deduction account transfer routing in Settings and Income recording.',
  },
  {
    version: '2.7.1',
    date: '2026-11-08',
    summary:
      'Intelligent quarterly savings deduction rates (Q1–Q4) based on income record date, gentle wrapping dropdown options, and streamlined Income Source & Source selection with on-demand Add New inputs and Edit mode.',
  },
  {
    version: '2.7.0',
    date: '2026-11-08',
    summary:
      'Centralized Savings Vault creation, renaming, rate editing, and deletion in Settings; minimal collapsible Account and Savings Vault cards with full details in Ledger History.',
  },
  {
    version: '2.6.4',
    date: '2026-11-08',
    summary:
      'Production Google Authentication support for Render and editable Savings Vault rates in Settings.',
  },
  {
    version: '2.6.3',
    date: '2026-11-07',
    summary: 'Updated application branding to Save N Know.',
  },
  {
    version: '2.6.2',
    date: '2026-11-07',
    summary:
      'Pattern-learned deduction-to-expense category & subcategory matching, collapsible expense cards, and Accounts-only menu badge.',
  },
  {
    version: '2.6.1',
    date: '2026-11-07',
    summary:
      'Aligned income deduction expenses with Expense Categories & Subcategories and Giving and Speaking → Givings.',
  },
  {
    version: '2.6.0',
    date: '2026-11-07',
    summary:
      'Designated non-savings deductions as Expenses and savings deductions as Transfers to 30/15/5/20/10/15/5 splits; default-collapsed forms.',
  },
  {
    version: '2.5.0',
    date: '2026-11-07',
    summary:
      'Static top header & sub-header, stronger Plus Jakarta Sans & JetBrains Mono typography, and development CHANGELOG.',
  },
];

/**
 * Normalizes a text label for comparison.
 */
function normalizeText(str?: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reduces English plural/inflected financial words to a common singular stem
 * so "Tithes" <-> "Tithe", "Givings" <-> "Giving", "Subscriptions" <-> "Subscription", etc.
 */
function stemWord(word: string): string {
  const w = word.toLowerCase().trim();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ves') && w.length > 4) return `${w.slice(0, -3)}f`;
  if (w.endsWith('ses') || w.endsWith('xes') || w.endsWith('zes')) {
    return w.slice(0, -2);
  }
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    return w.slice(0, -1);
  }
  return w;
}

const STOP_WORDS = new Set([
  'to',
  'for',
  'the',
  'and',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'a',
  'an',
  'my',
  'our',
  'per',
  'fee',
  'fees',
  'cut',
  'cuts',
  'deduction',
  'deductions',
  'expense',
  'expenses',
  'payment',
  'payments',
]);

function stemPhrase(str?: string): string {
  const norm = normalizeText(str);
  if (!norm) return '';
  return norm
    .split(' ')
    .filter(Boolean)
    .map(stemWord)
    .join(' ');
}

function getMeaningfulStems(str?: string): string[] {
  const norm = normalizeText(str);
  if (!norm) return [];
  return norm
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stemWord);
}

/**
 * Curated accessible color palette for Expense Subcategories.
 */
export const EXPENSE_SUBCATEGORY_COLOR_PALETTE: {
  id: string;
  label: string;
  hex: string;
}[] = [
  { id: 'emerald', label: 'Emerald', hex: '#059669' },
  { id: 'sapphire', label: 'Sapphire', hex: '#2563eb' },
  { id: 'indigo', label: 'Indigo', hex: '#4f46e5' },
  { id: 'violet', label: 'Violet', hex: '#7c3aed' },
  { id: 'rose', label: 'Rose', hex: '#e11d48' },
  { id: 'amber', label: 'Amber', hex: '#d97706' },
  { id: 'teal', label: 'Teal', hex: '#0d9488' },
  { id: 'cyan', label: 'Cyan', hex: '#0284c7' },
  { id: 'orange', label: 'Orange', hex: '#ea580c' },
  { id: 'pink', label: 'Pink', hex: '#db2777' },
  { id: 'lime', label: 'Lime', hex: '#65a30d' },
  { id: 'slate', label: 'Slate', hex: '#475569' },
];

/**
 * Semantic keyword rules that intuitively map expense subcategory names to meaningful colors.
 */
const SUBCATEGORY_SEMANTIC_COLOR_RULES: {
  keywords: string[];
  hex: string;
}[] = [
  {
    keywords: [
      'giving',
      'givings',
      'tithe',
      'tithes',
      'offering',
      'charity',
      'support',
      'welfare',
      'donation',
      'seed',
      'speaking',
      'ministry',
    ],
    hex: '#059669', // Emerald
  },
  {
    keywords: [
      'data',
      'bundle',
      'internet',
      'wifi',
      'airtime',
      'telecom',
      'phone',
      'utility',
      'utilities',
      'water',
      'electricity',
      'power',
    ],
    hex: '#0284c7', // Cyan
  },
  {
    keywords: [
      'subscription',
      'subscriptions',
      'software',
      'saas',
      'cloud',
      'hosting',
      'streaming',
      'license',
      'app',
    ],
    hex: '#7c3aed', // Violet
  },
  {
    keywords: [
      'food',
      'groceries',
      'grocery',
      'dining',
      'restaurant',
      'meal',
      'feeding',
      'catering',
      'refreshment',
    ],
    hex: '#d97706', // Amber
  },
  {
    keywords: [
      'rent',
      'housing',
      'mortgage',
      'building',
      'buildings',
      'land',
      'lands',
      'property',
      'real estate',
      'maintenance',
      'repairs',
      'facility',
    ],
    hex: '#4f46e5', // Indigo
  },
  {
    keywords: [
      'transport',
      'transportation',
      'fuel',
      'petrol',
      'diesel',
      'uber',
      'bolt',
      'taxi',
      'flight',
      'travel',
      'logistics',
      'vehicle',
      'car',
    ],
    hex: '#ea580c', // Orange
  },
  {
    keywords: [
      'health',
      'medical',
      'hospital',
      'pharmacy',
      'medicine',
      'insurance',
      'dental',
      'clinic',
      'wellness',
    ],
    hex: '#e11d48', // Rose
  },
  {
    keywords: [
      'education',
      'tuition',
      'school',
      'training',
      'course',
      'courses',
      'book',
      'books',
      'research',
      'certification',
    ],
    hex: '#2563eb', // Sapphire
  },
  {
    keywords: [
      'treasury',
      'bond',
      'bonds',
      'mutual',
      'fund',
      'funds',
      'fixed deposit',
      'equity',
      'etf',
      'investment',
      'capital',
      'stock',
    ],
    hex: '#0d9488', // Teal
  },
  {
    keywords: [
      'personal',
      'shopping',
      'clothing',
      'wardrobe',
      'grooming',
      'lifestyle',
      'gift',
      'family',
      'entertainment',
    ],
    hex: '#db2777', // Pink
  },
  {
    keywords: [
      'tax',
      'statutory',
      'levy',
      'audit',
      'legal',
      'accounting',
      'bank charge',
      'fee',
    ],
    hex: '#475569', // Slate
  },
];

/**
 * Deterministically hashes a normalized string to an index in EXPENSE_SUBCATEGORY_COLOR_PALETTE.
 */
function getDeterministicPaletteHex(label: string): string {
  const clean = normalizeText(label) || 'general';
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const idx = Math.abs(hash) % EXPENSE_SUBCATEGORY_COLOR_PALETTE.length;
  return EXPENSE_SUBCATEGORY_COLOR_PALETTE[idx].hex;
}

/**
 * Intuitively resolves the hex color for an expense subcategory:
 * 1. Checks explicit user preference in `settings.expenseCategoryPreferences[].subcategoryColors`.
 * 2. Checks recorded expenses for an already-persisted `subcategoryColor`.
 * 3. Applies semantic financial domain matching on the subcategory (and category) name.
 * 4. Falls back to a deterministic hash color from `EXPENSE_SUBCATEGORY_COLOR_PALETTE`.
 */
export function resolveIntuitiveSubcategoryColor(
  subcategory?: string,
  category?: string,
  settings?: Pick<UserSettings, 'expenseCategoryPreferences'>,
  existingExpenses: FlexibleExpense[] = []
): string {
  const cleanSub = (subcategory || '').trim();
  const cleanCat = (category || '').trim();
  const normSub = normalizeText(cleanSub);
  const normCat = normalizeText(cleanCat);

  // 1. User-configured color in Settings
  if (settings?.expenseCategoryPreferences && cleanSub) {
    // First look in the matching category
    const matchedCatPref = settings.expenseCategoryPreferences.find(
      (p) => normalizeText(p.name) === normCat
    );
    if (matchedCatPref?.subcategoryColors) {
      for (const [k, hex] of Object.entries(matchedCatPref.subcategoryColors)) {
        if (normalizeText(k) === normSub && hex && hex.startsWith('#')) {
          return hex;
        }
      }
    }
    // Or across any category preference
    for (const pref of settings.expenseCategoryPreferences) {
      if (!pref.subcategoryColors) continue;
      for (const [k, hex] of Object.entries(pref.subcategoryColors)) {
        if (normalizeText(k) === normSub && hex && hex.startsWith('#')) {
          return hex;
        }
      }
    }
  }

  // 2. Previously saved subcategoryColor on an existing expense
  if (cleanSub && existingExpenses.length > 0) {
    const matchedExp = existingExpenses.find(
      (e) =>
        e &&
        e.subcategoryColor &&
        e.subcategoryColor.startsWith('#') &&
        normalizeText(e.subcategory) === normSub &&
        (!normCat || normalizeText(e.category) === normCat)
    );
    if (matchedExp?.subcategoryColor) {
      return matchedExp.subcategoryColor;
    }
  }

  // 3. Semantic keyword matching on subcategory first, then category
  const targetSearch = `${normSub} ${normCat}`.trim();
  if (targetSearch) {
    for (const rule of SUBCATEGORY_SEMANTIC_COLOR_RULES) {
      if (
        rule.keywords.some(
          (kw) =>
            normSub === kw ||
            normSub.includes(kw) ||
            (normSub.length === 0 && normCat.includes(kw))
        )
      ) {
        return rule.hex;
      }
    }
    for (const rule of SUBCATEGORY_SEMANTIC_COLOR_RULES) {
      if (rule.keywords.some((kw) => targetSearch.includes(kw))) {
        return rule.hex;
      }
    }
  }

  // 4. Deterministic palette hash fallback
  return getDeterministicPaletteHex(cleanSub || cleanCat || 'general');
}

/**
 * Generates consistent inline badge styles (text, background tint, border tint) for a subcategory hex color.
 */
export function getSubcategoryBadgeStyle(hexColor?: string): {
  color: string;
  backgroundColor: string;
  borderColor: string;
} {
  const safeHex =
    hexColor && /^#[0-9a-fA-F]{6}$/.test(hexColor.trim())
      ? hexColor.trim()
      : '#475569';
  return {
    color: safeHex,
    backgroundColor: `${safeHex}14`,
    borderColor: `${safeHex}40`,
  };
}

/**
 * Returns the effective Expense Category & Subcategory preferences,
 * combining user preferences in Settings with categories/subcategories learned
 * from existing recorded expenses, ensuring "Giving and Speaking" -> "Givings" exists,
 * and populating `subcategoryColors` for every subcategory.
 */
export function getEffectiveExpenseCategoryPreferences(
  settings: UserSettings,
  existingExpenses: FlexibleExpense[] = []
): ExpenseCategoryPreference[] {
  const prefs: ExpenseCategoryPreference[] = (
    settings.expenseCategoryPreferences || []
  ).map((p) => ({
    ...p,
    subcategories: [...(p.subcategories || [])],
    subcategoryColors: { ...(p.subcategoryColors || {}) },
  }));

  // Merge any legacy string categories from settings.expenseCategories
  for (const legacyCat of settings.expenseCategories || []) {
    const cleanCat = (legacyCat || '').trim();
    if (!cleanCat) continue;
    const exists = prefs.some(
      (p) => normalizeText(p.name) === normalizeText(cleanCat)
    );
    if (!exists) {
      prefs.push({
        id: `exp_cat_legacy_${normalizeText(cleanCat).replace(/\s+/g, '_')}`,
        name: cleanCat,
        subcategories: [],
        subcategoryColors: {},
      });
    }
  }

  // Learn categories & subcategories from existing recorded expenses
  for (const exp of existingExpenses) {
    if (!exp || exp.id?.startsWith('exp_ded_') || exp.id?.startsWith('exp_cut_')) {
      continue;
    }
    const catName = (exp.category || '').trim();
    const subName = (exp.subcategory || '').trim();
    if (!catName || normalizeText(catName) === 'uncategorized') continue;

    let catEntry = prefs.find(
      (p) => normalizeText(p.name) === normalizeText(catName)
    );
    if (!catEntry) {
      catEntry = {
        id: `exp_cat_learned_${normalizeText(catName).replace(/\s+/g, '_')}`,
        name: catName,
        subcategories: [],
        subcategoryColors: {},
      };
      prefs.push(catEntry);
    }

    if (
      subName &&
      !catEntry.subcategories.some(
        (s) => normalizeText(s) === normalizeText(subName)
      )
    ) {
      catEntry.subcategories.push(subName);
    }
    if (
      subName &&
      exp.subcategoryColor &&
      exp.subcategoryColor.startsWith('#') &&
      catEntry.subcategoryColors &&
      !catEntry.subcategoryColors[subName]
    ) {
      catEntry.subcategoryColors[subName] = exp.subcategoryColor;
    }
  }

  // Ensure "Giving and Speaking" -> "Givings" is always present
  const givingSpeakingIdx = prefs.findIndex(
    (p) =>
      normalizeText(p.name) === 'giving and speaking' ||
      (normalizeText(p.name).includes('giving') &&
        normalizeText(p.name).includes('speaking'))
  );

  if (givingSpeakingIdx === -1) {
    prefs.push({
      id: 'exp_cat_giving_speaking',
      name: 'Giving and Speaking',
      subcategories: ['Givings'],
      subcategoryColors: { Givings: '#059669' },
    });
  } else {
    const existing = prefs[givingSpeakingIdx];
    const hasGivings = existing.subcategories.some(
      (s) => stemPhrase(s) === 'giving'
    );
    if (!hasGivings) {
      existing.subcategories.unshift('Givings');
    }
  }

  // Populate intuitive subcategoryColors for all subcategories
  for (const pref of prefs) {
    const colorMap: Record<string, string> = { ...(pref.subcategoryColors || {}) };
    for (const sub of pref.subcategories) {
      const existingCustom = Object.entries(colorMap).find(
        ([k, v]) => normalizeText(k) === normalizeText(sub) && v && v.startsWith('#')
      );
      colorMap[sub] =
        existingCustom?.[1] ||
        resolveIntuitiveSubcategoryColor(sub, pref.name, settings, existingExpenses);
    }
    pref.subcategoryColors = colorMap;
  }

  return prefs;
}

/**
 * Inspects the deduction's name AND existing recorded expense patterns to match
 * each non-savings deduction to its accurate Expense Category and Subcategory.
 * - "Others to support" matches Subcategory "Givings" within "Giving and Speaking".
 * - Every other deduction name is matched against Subcategories, Categories, and
 *   recorded Expense patterns (recipient/subcategory/description/notes).
 */
export function resolveDeductionExpenseMapping(
  deduction: {
    id?: string;
    name?: string;
    expenseCategory?: string;
    expenseSubcategory?: string;
  },
  settings: UserSettings,
  existingExpenses: FlexibleExpense[] = []
): { category: string; subcategory: string } {
  const prefs = getEffectiveExpenseCategoryPreferences(settings, existingExpenses);
  const definedCuts = (settings.customCuts || []).filter(
    (cut) => !LEGACY_SEEDED_CUT_IDS.has(cut.id)
  );
  const rawName = (deduction.name || '').trim();
  const normName = normalizeText(rawName);
  const stemmedName = stemPhrase(rawName);
  const nameStems = getMeaningfulStems(rawName);

  const matchedRule = definedCuts.find(
    (c) =>
      (deduction.id && deduction.id.includes(c.id)) ||
      normalizeText(c.name) === normName
  );

  const givingSpeakingPref =
    prefs.find(
      (p) =>
        normalizeText(p.name) === 'giving and speaking' ||
        (normalizeText(p.name).includes('giving') &&
          normalizeText(p.name).includes('speaking'))
    ) || {
      id: 'exp_cat_giving_speaking',
      name: 'Giving and Speaking',
      subcategories: ['Givings'],
    };

  const givingsSub =
    givingSpeakingPref.subcategories.find((s) => stemPhrase(s) === 'giving') ||
    'Givings';

  // 1. Explicit rule: "Others to support" -> Category: "Giving and Speaking", Subcategory: "Givings"
  const isOthersToSupport =
    normName === 'others to support' ||
    normName === 'other to support' ||
    normName === 'others support' ||
    normName === 'support others' ||
    normName.includes('others to support') ||
    normName.includes('other to support') ||
    normName.includes('to support') ||
    normName === 'support';

  if (isOthersToSupport) {
    return {
      category: givingSpeakingPref.name,
      subcategory: givingsSub,
    };
  }

  // Filter real user-recorded expenses for pattern learning
  const recordedExpenses = existingExpenses.filter(
    (e) =>
      e &&
      !e.id?.startsWith('exp_ded_') &&
      !e.id?.startsWith('exp_cut_') &&
      e.category &&
      normalizeText(e.category) !== 'uncategorized'
  );

  // 2. Direct Subcategory Match in Preferences (Exact or Stemmed Phrase)
  if (normName) {
    for (const pref of prefs) {
      for (const sub of pref.subcategories) {
        if (
          normalizeText(sub) === normName ||
          (stemmedName && stemPhrase(sub) === stemmedName)
        ) {
          return {
            category: pref.name,
            subcategory: sub,
          };
        }
      }
    }
  }

  // 3. Pattern Match from Existing Expense Records (subcategory, recipient, notes, description)
  if (normName && recordedExpenses.length > 0) {
    const pairCounts = new Map<
      string,
      { category: string; subcategory: string; score: number }
    >();

    for (const exp of recordedExpenses) {
      const expCat = (exp.category || '').trim();
      const expSub = (exp.subcategory || '').trim();
      const expRecip = (exp.recipient || '').trim();
      const expDesc = (exp.description || '').trim();
      const expNotes = (exp.notes || '').trim();

      let matchWeight = 0;

      // Exact or stemmed match on recorded expense subcategory
      if (
        expSub &&
        (normalizeText(expSub) === normName ||
          (stemmedName && stemPhrase(expSub) === stemmedName))
      ) {
        matchWeight += 100;
      }

      // Exact or stemmed match on recorded expense recipient ("To")
      if (
        expRecip &&
        (normalizeText(expRecip) === normName ||
          (stemmedName && stemPhrase(expRecip) === stemmedName))
      ) {
        matchWeight += 90;
      }

      // Substring match on subcategory or recipient
      if (matchWeight === 0 && normName.length >= 3) {
        const normSub = normalizeText(expSub);
        const normRecip = normalizeText(expRecip);
        if (
          normSub &&
          normSub.length >= 3 &&
          (normName.includes(normSub) || normSub.includes(normName))
        ) {
          matchWeight += 65;
        } else if (
          normRecip &&
          normRecip.length >= 3 &&
          (normName.includes(normRecip) || normRecip.includes(normName))
        ) {
          matchWeight += 55;
        }
      }

      // Shared meaningful stem tokens across subcategory, recipient, category, or notes
      if (nameStems.length > 0) {
        const subStems = getMeaningfulStems(expSub);
        const recipStems = getMeaningfulStems(expRecip);
        const catStems = getMeaningfulStems(expCat);
        const noteStems = getMeaningfulStems(`${expDesc} ${expNotes}`);

        for (const stem of nameStems) {
          if (subStems.includes(stem)) matchWeight += 45;
          if (recipStems.includes(stem)) matchWeight += 35;
          if (catStems.includes(stem)) matchWeight += 20;
          if (noteStems.includes(stem)) matchWeight += 15;
        }
      }

      if (matchWeight > 0) {
        const matchedPref = prefs.find(
          (p) => normalizeText(p.name) === normalizeText(expCat)
        );
        const canonicalCat = matchedPref ? matchedPref.name : expCat;
        const canonicalSub =
          matchedPref?.subcategories.find(
            (s) =>
              normalizeText(s) === normalizeText(expSub) ||
              (expSub && stemPhrase(s) === stemPhrase(expSub))
          ) || expSub;

        const key = `${normalizeText(canonicalCat)}::${normalizeText(canonicalSub)}`;
        const prev = pairCounts.get(key);
        if (prev) {
          prev.score += matchWeight;
        } else {
          pairCounts.set(key, {
            category: canonicalCat,
            subcategory: canonicalSub,
            score: matchWeight,
          });
        }
      }
    }

    if (pairCounts.size > 0) {
      const bestRecorded = Array.from(pairCounts.values()).sort(
        (a, b) => b.score - a.score
      )[0];
      if (bestRecorded && bestRecorded.score >= 35) {
        return {
          category: bestRecorded.category,
          subcategory: bestRecorded.subcategory,
        };
      }
    }
  }

  // 4. Substring & Stem Token Scoring across all Category & Subcategory Preferences
  if (normName) {
    let bestCandidate: {
      category: string;
      subcategory: string;
      score: number;
    } | null = null;

    for (const pref of prefs) {
      const normCat = normalizeText(pref.name);
      const catStems = getMeaningfulStems(pref.name);

      let catBaseScore = 0;
      if (normCat === normName || (stemmedName && stemPhrase(pref.name) === stemmedName)) {
        catBaseScore += 70;
      } else if (
        normCat.length >= 3 &&
        normName.length >= 3 &&
        (normName.includes(normCat) || normCat.includes(normName))
      ) {
        catBaseScore += 35;
      }
      for (const stem of nameStems) {
        if (catStems.includes(stem)) {
          catBaseScore += 25;
        }
      }

      if (pref.subcategories.length > 0) {
        for (const sub of pref.subcategories) {
          const normSub = normalizeText(sub);
          const subStems = getMeaningfulStems(sub);
          let score = catBaseScore;

          if (normSub === normName || (stemmedName && stemPhrase(sub) === stemmedName)) {
            score += 120;
          } else if (
            normSub.length >= 3 &&
            normName.length >= 3 &&
            (normName.includes(normSub) || normSub.includes(normName))
          ) {
            score += 80;
          }

          for (const stem of nameStems) {
            if (subStems.includes(stem)) {
              score += 55;
            } else if (
              stem.length >= 4 &&
              subStems.some((ss) => ss.startsWith(stem) || stem.startsWith(ss))
            ) {
              score += 35;
            }
          }

          if (score > 0 && (!bestCandidate || score > bestCandidate.score)) {
            bestCandidate = {
              category: pref.name,
              subcategory: sub,
              score,
            };
          }
        }
      } else if (catBaseScore > 0) {
        if (!bestCandidate || catBaseScore > bestCandidate.score) {
          bestCandidate = {
            category: pref.name,
            subcategory: '',
            score: catBaseScore,
          };
        }
      }
    }

    if (bestCandidate && bestCandidate.score >= 25) {
      return {
        category: bestCandidate.category,
        subcategory: bestCandidate.subcategory,
      };
    }
  }

  // 5. Explicit user-configured category/subcategory on the deduction item or rule
  const explicitCat = (
    deduction.expenseCategory ||
    matchedRule?.expenseCategory ||
    ''
  ).trim();
  const explicitSub = (
    deduction.expenseSubcategory ||
    matchedRule?.expenseSubcategory ||
    ''
  ).trim();

  if (explicitCat && normalizeText(explicitCat) !== 'uncategorized') {
    const matchedPref = prefs.find(
      (p) => normalizeText(p.name) === normalizeText(explicitCat)
    );
    if (matchedPref) {
      const matchedSub =
        matchedPref.subcategories.find(
          (s) =>
            normalizeText(s) === normalizeText(explicitSub) ||
            (explicitSub && stemPhrase(s) === stemPhrase(explicitSub))
        ) || explicitSub;
      return {
        category: matchedPref.name,
        subcategory: matchedSub,
      };
    }
    return {
      category: explicitCat,
      subcategory: explicitSub,
    };
  }

  // 6. Semantic domain fallback for giving/charity/ministry terms
  if (
    normName.includes('giving') ||
    normName.includes('tithe') ||
    normName.includes('offering') ||
    normName.includes('speaking') ||
    normName.includes('seed') ||
    normName.includes('charity') ||
    normName.includes('welfare') ||
    normName.includes('ministry') ||
    normName.includes('church')
  ) {
    const matchedGivingSub =
      givingSpeakingPref.subcategories.find((s) => {
        const ns = normalizeText(s);
        return (
          normName.includes(ns) ||
          ns.includes(normName) ||
          getMeaningfulStems(s).some((st) => nameStems.includes(st))
        );
      }) || givingsSub;

    return {
      category: givingSpeakingPref.name,
      subcategory: matchedGivingSub,
    };
  }

  // 7. Fallback if no match found
  if (prefs.length > 0) {
    return {
      category: prefs[0].name,
      subcategory: prefs[0].subcategories[0] || '',
    };
  }

  return {
    category: deduction.name || 'General',
    subcategory: '',
  };
}

/**
 * Resolves the effective rate/amount for a defined Savings deduction rule
 * based on the quarter (Q1, Q2, Q3, Q4) of the given income date.
 */
export function getSavingsCutRateForDate(
  cut: Pick<CustomDeduction, 'amount' | 'quarterlyRates'>,
  dateStr?: string
): { rate: number; quarter: Quarter } {
  const effectiveDate = dateStr || new Date().toISOString().slice(0, 10);
  const quarter = getQuarterFromDate(effectiveDate);
  const qVal = cut.quarterlyRates?.[quarter];
  if (typeof qVal === 'number' && Number.isFinite(qVal) && qVal > 0) {
    return { rate: qVal, quarter };
  }
  return { rate: Number(cut.amount) || 0, quarter };
}

/**
 * Formats a concise summary of a Savings deduction rule's quarterly rates (Q1–Q4).
 */
export function formatSavingsCutRatesSummary(
  cut: Pick<CustomDeduction, 'type' | 'amount' | 'quarterlyRates'>,
  currency = 'USD'
): string {
  const unit = cut.type === 'percentage' ? '%' : '';
  const prefix = cut.type === 'fixed' ? `${currency} ` : '';
  if (cut.quarterlyRates) {
    const q1 = cut.quarterlyRates.Q1 ?? cut.amount;
    const q2 = cut.quarterlyRates.Q2 ?? cut.amount;
    const q3 = cut.quarterlyRates.Q3 ?? cut.amount;
    const q4 = cut.quarterlyRates.Q4 ?? cut.amount;
    return `Q1: ${prefix}${q1}${unit} · Q2: ${prefix}${q2}${unit} · Q3: ${prefix}${q3}${unit} · Q4: ${prefix}${q4}${unit}`;
  }
  return `${prefix}${cut.amount}${unit}`;
}

/**
 * Builds initial allocated deductions for a new income record strictly from user-defined deduction rules,
 * automatically selecting the quarterly savings rate (Q1–Q4) matching the income record's date.
 */
export function buildDefaultDeductionsForIncome(
  grossAmount: number,
  settings: UserSettings,
  existingExpenses: FlexibleExpense[] = [],
  dateStr?: string,
  targetCurrency?: string,
  fxSnapshot?: MarketFxSnapshot | null
): IncomeDeductionItem[] {
  const items: IncomeDeductionItem[] = [];
  const baseCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const activeCurr = (targetCurrency || baseCurr).trim().toUpperCase();
  const definedCuts = (settings.customCuts || []).filter(
    (cut) => !LEGACY_SEEDED_CUT_IDS.has(cut.id)
  );
  for (const cut of definedCuts) {
    if (!cut.enabled) continue;
    const isSav = isSavingsDeduction(cut);
    const rawVal = isSav
      ? getSavingsCutRateForDate(cut, dateStr).rate
      : cut.amount;
    const effectiveVal =
      cut.type === 'fixed' && activeCurr !== baseCurr
        ? convertCurrency2dp(rawVal, baseCurr, activeCurr, fxSnapshot)
            .convertedAmount
        : rawVal;
    const mapped = !isSav
      ? resolveDeductionExpenseMapping(cut, settings, existingExpenses)
      : undefined;
    items.push({
      id: `ded_${cut.id}`,
      name: cut.name,
      description: cut.description || '',
      type: cut.type,
      value: effectiveVal,
      amount: computeDeductionAmount(grossAmount, cut.type, effectiveVal),
      destinationAccountId: undefined,
      isSavingsSplit: isSav,
      expenseCategory: mapped?.category,
      expenseSubcategory: mapped?.subcategory,
    });
  }
  return items;
}

/**
 * Resolves the native currency and native gross amount for an income receipt
 * based on its own currency or its receiving account's currency (without conversion).
 */
export function getIncomeNativeGross(
  receipt: IncomeReceipt,
  settings?: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS
): { nativeGross: number; currency: string } {
  const sysCurr = (settings?.currency || 'GHS').trim().toUpperCase();
  const targetAcc = accounts.find((a) => a.id === receipt.accountId);
  const accCurr = getAccountCurrency(targetAcc, sysCurr);
  const currency = (receipt.currency || accCurr || sysCurr).trim().toUpperCase();
  const nativeGross =
    receipt.originalGrossAmount !== undefined &&
    Number(receipt.originalGrossAmount) > 0
      ? roundTo2Decimals(Number(receipt.originalGrossAmount))
      : roundTo2Decimals(Math.max(0, Number(receipt.grossAmount) || 0));
  return { nativeGross, currency };
}

/**
 * Converts an income receipt's native gross amount into the system base currency (`settings.currency`)
 * using real-time 2-point floating market exchange rates for consolidated app totals.
 */
export function getIncomeBaseGross(
  receipt: IncomeReceipt,
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS,
  snapshot?: MarketFxSnapshot | null
): {
  baseGross: number;
  nativeGross: number;
  currency: string;
  exchangeRate: number;
} {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const { nativeGross, currency } = getIncomeNativeGross(
    receipt,
    settings,
    accounts
  );
  if (currency === sysCurr) {
    return {
      baseGross: nativeGross,
      nativeGross,
      currency,
      exchangeRate: 1,
    };
  }
  const { convertedAmount, exchangeRate2dp: exchangeRate } = convertCurrency2dp(
    nativeGross,
    currency,
    sysCurr,
    snapshot
  );
  return {
    baseGross: convertedAmount,
    nativeGross,
    currency,
    exchangeRate,
  };
}

/**
 * Resolves an expense's native currency amount, its account's original currency amount,
 * and its real-time converted base amount in `settings.currency`.
 */
export function getExpenseNativeAndBaseAmount(
  exp: FlexibleExpense,
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS,
  snapshot?: MarketFxSnapshot | null
): {
  nativeAmount: number;
  accountAmount: number;
  accountCurrency: string;
  baseAmount: number;
  currency: string;
  exchangeRate: number;
} {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const targetAcc = accounts.find((a) => a.id === exp.accountId);
  const accCurr = getAccountCurrency(targetAcc, sysCurr);
  const hasOriginal =
    exp.originalAmount !== undefined && Number(exp.originalAmount) > 0;
  const currency = (exp.currency || accCurr || sysCurr).trim().toUpperCase();
  const nativeAmount = hasOriginal
    ? roundTo2Decimals(Number(exp.originalAmount))
    : roundTo2Decimals(Math.max(0, Number(exp.amount) || 0));

  const accountAmount =
    currency === accCurr
      ? nativeAmount
      : convertCurrency2dp(nativeAmount, currency, accCurr, snapshot)
          .convertedAmount;

  if (currency === sysCurr) {
    return {
      nativeAmount,
      accountAmount,
      accountCurrency: accCurr,
      baseAmount: roundTo2Decimals(Math.max(0, Number(exp.amount) || nativeAmount)),
      currency,
      exchangeRate: 1,
    };
  }

  if (hasOriginal) {
    const { convertedAmount, exchangeRate2dp: exchangeRate } = convertCurrency2dp(
      nativeAmount,
      currency,
      sysCurr,
      snapshot
    );
    return {
      nativeAmount,
      accountAmount,
      accountCurrency: accCurr,
      baseAmount: convertedAmount,
      currency,
      exchangeRate,
    };
  }

  // Legacy expense where `amount` was already stored in base currency without `originalAmount`
  const baseAmt = roundTo2Decimals(Math.max(0, Number(exp.amount) || 0));
  const { convertedAmount: derivedNative, exchangeRate2dp: exchangeRate } = convertCurrency2dp(
    baseAmt,
    sysCurr,
    currency,
    snapshot
  );
  const derivedAccountAmt =
    accCurr === sysCurr
      ? baseAmt
      : convertCurrency2dp(baseAmt, sysCurr, accCurr, snapshot).convertedAmount;
  return {
    nativeAmount: derivedNative,
    accountAmount: derivedAccountAmt,
    accountCurrency: accCurr,
    baseAmount: baseAmt,
    currency,
    exchangeRate,
  };
}

/**
 * Returns the effective allocated deductions for an income receipt, presenting only
 * deductions defined by the user in Settings and recalculating amounts against the income's
 * native grossAmount (with quarterly rate intelligence for Savings deductions based on receipt.date).
 */
export function getEffectiveIncomeDeductions(
  receipt: IncomeReceipt,
  settings: UserSettings,
  existingExpenses: FlexibleExpense[] = []
): IncomeDeductionItem[] {
  const { nativeGross: gross } = getIncomeNativeGross(receipt, settings);
  const definedCuts = (settings.customCuts || []).filter(
    (cut) => !LEGACY_SEEDED_CUT_IDS.has(cut.id)
  );
  const definedNames = new Set(
    definedCuts.map((c) => c.name.trim().toLowerCase())
  );

  if (Array.isArray(receipt.allocatedDeductions) && receipt.allocatedDeductions.length > 0) {
    const filtered = receipt.allocatedDeductions.filter((d) => {
      if (
        d.id.includes('cut_support_2_5') ||
        d.id.includes('cut_savings_default') ||
        d.name.trim().toLowerCase() === 'partnership & giving'
      ) {
        return definedNames.has(d.name.trim().toLowerCase());
      }
      return true;
    });

    return filtered.map((d) => {
      const isSav = isSavingsDeduction(d);
      // Preserve the exact rate/value recorded on this income receipt so:
      // 1) Subsequent changes to quarterly savings rates in Settings never alter past records.
      // 2) Custom per-income savings rate modifications chosen by the user are honored without fail.
      // 3) If legacy data stored amount > 0 with value === 0, or value === 0 on a matched rule, recover the effective rate.
      let resolvedVal = Number(d.value ?? 0);
      if (resolvedVal <= 0) {
        const storedAmt = Number(d.amount ?? 0);
        if (storedAmt > 0 && gross > 0) {
          resolvedVal =
            d.type === 'fixed'
              ? storedAmt
              : Math.round(((storedAmt / gross) * 100) * 100) / 100;
        } else {
          const matchedCut = definedCuts.find(
            (c) =>
              d.id.includes(c.id) ||
              c.name.trim().toLowerCase() === d.name.trim().toLowerCase()
          );
          if (matchedCut) {
            resolvedVal = isSav
              ? getSavingsCutRateForDate(matchedCut, receipt.date).rate
              : Number(matchedCut.amount) || 0;
          }
        }
      }

      const mapped = !isSav
        ? resolveDeductionExpenseMapping(d, settings, existingExpenses)
        : undefined;
      return {
        ...d,
        value: resolvedVal,
        amount: computeDeductionAmount(gross, d.type, resolvedVal),
        isSavingsSplit: isSav,
        destinationAccountId: undefined,
        expenseCategory: mapped?.category,
        expenseSubcategory: mapped?.subcategory,
      };
    });
  }

  // Present user-defined enabled deductions from Settings
  const fallback: IncomeDeductionItem[] = [];
  for (const cut of definedCuts) {
    if (!cut.enabled) continue;
    const isSav = isSavingsDeduction(cut);
    const effectiveVal = isSav
      ? getSavingsCutRateForDate(cut, receipt.date).rate
      : cut.amount;
    const mapped = !isSav
      ? resolveDeductionExpenseMapping(cut, settings, existingExpenses)
      : undefined;
    fallback.push({
      id: `${receipt.id}_cut_${cut.id}`,
      name: cut.name,
      description: cut.description,
      type: cut.type,
      value: effectiveVal,
      amount: computeDeductionAmount(gross, cut.type, effectiveVal),
      destinationAccountId: undefined,
      isSavingsSplit: isSav,
      expenseCategory: mapped?.category,
      expenseSubcategory: mapped?.subcategory,
    });
  }
  return fallback;
}

/**
 * Resolves the primary/default operating account from a list of accounts.
 */
export function resolveDefaultOperatingAccount(
  accounts: FinancialAccount[],
  settings?: UserSettings
): FinancialAccount {
  const operating = accounts.filter(
    (a) => !settings || !isSavingsVaultAccount(a, settings)
  );
  return (
    (settings?.defaultAccountId
      ? accounts.find((a) => a.id === settings.defaultAccountId)
      : undefined) ||
    operating.find((a) => a.isDefaultDeposit) ||
    operating[0] ||
    accounts.find((a) => a.isDefaultDeposit) ||
    accounts[0] ||
    DEFAULT_FINANCIAL_ACCOUNTS[0]
  );
}

/**
 * Resolves an account ID against the active accounts list, falling back to the default operating account
 * if the stored account ID is empty, legacy ('acc_main' <-> 'acc-main-op'), or no longer exists.
 */
export function resolveValidAccountId(
  candidateId: string | undefined,
  accounts: FinancialAccount[],
  settings?: UserSettings
): string {
  const defAcc = resolveDefaultOperatingAccount(accounts, settings);
  const raw = (candidateId || '').trim();
  if (!raw) return defAcc.id;
  if (accounts.some((a) => a.id === raw)) return raw;
  if (raw === 'acc_main' && accounts.some((a) => a.id === 'acc-main-op')) {
    return 'acc-main-op';
  }
  if (raw === 'acc-main-op' && accounts.some((a) => a.id === 'acc_main')) {
    return 'acc_main';
  }
  return defAcc.id;
}

/**
 * Resolves the effective destination account ID for an income receipt's Net Income after deductions.
 * - If the receipt explicitly specifies `'__KEEP__'`, it stays in the receiving account (`''`).
 * - If the receipt specifies a valid destination account ID different from the receiving account, it transfers there.
 * - Otherwise, if `settings.defaultNetIncomeAccountId` is configured to a valid account different from the receiving account, it routes there.
 */
export function getEffectiveNetTransferAccountId(
  receipt: IncomeReceipt,
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS
): string {
  const sourceAccId = resolveValidAccountId(receipt.accountId, accounts, settings);
  const rawNetId = (receipt.netTransferredToAccountId || '').trim();
  if (rawNetId === '__KEEP__') {
    return '';
  }
  const candidateId = rawNetId || (settings.defaultNetIncomeAccountId || '').trim();
  if (!candidateId || candidateId === '__KEEP__') {
    return '';
  }
  const resolvedDestId = resolveValidAccountId(candidateId, accounts, settings);
  if (!resolvedDestId || resolvedDestId === sourceAccId) {
    return '';
  }
  return resolvedDestId;
}

/**
 * Designates all non-savings income deductions as Expense items matched to the user's
 * existing Expense Categories, Subcategories, and recorded Expense patterns.
 * Preserves the account's native currency in `currency` & `originalAmount` while converting `amount`
 * into `settings.currency` at real-time 2-point floating market rates for consolidated totals.
 */
export function getIncomeDeductionExpenses(
  incomes: IncomeReceipt[],
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS,
  existingExpenses: FlexibleExpense[] = []
): FlexibleExpense[] {
  const items: FlexibleExpense[] = [];
  for (const inc of incomes) {
    const { currency: incCurr } = getIncomeNativeGross(inc, settings, accounts);
    const deds = getEffectiveIncomeDeductions(inc, settings, existingExpenses);
    const sourceAccId = resolveValidAccountId(inc.accountId, accounts, settings);
    for (const d of deds) {
      if (isSavingsDeduction(d)) continue;
      if (d.amount <= 0) continue;
      const { category, subcategory } = resolveDeductionExpenseMapping(
        d,
        settings,
        existingExpenses
      );
      const subcategoryColor = resolveIntuitiveSubcategoryColor(
        subcategory,
        category,
        settings,
        existingExpenses
      );
      const { convertedAmount: baseAmount, exchangeRate2dp: exchangeRate } = convertCurrency2dp(
        d.amount,
        incCurr,
        settings.currency
      );
      items.push({
        id: `exp_ded_${inc.id}_${d.id}`,
        userId: inc.userId,
        date: inc.date,
        incomeReceiptId: inc.id,
        accountId: sourceAccId,
        recipient: d.name,
        category,
        subcategory,
        subcategoryColor,
        description: `${d.name} (${d.type === 'percentage' ? `${d.value}%` : formatAmount(d.value, incCurr)}) from ${inc.clientOrSource}`,
        notes: `From ${inc.clientOrSource}`,
        amount: baseAmount,
        currency: incCurr,
        originalAmount: d.amount,
        exchangeRate,
        createdAt: inc.createdAt || new Date().toISOString(),
      });
    }
  }
  return items;
}

/**
 * Designates all savings deductions on incomes as Transfers to their respective
 * Savings Vault splits and generates Net Income transfers when Net Income after deductions
 * is routed to another account, with real-time 2-point floating currency conversion.
 */
export function getSavingsSplitTransfers(
  incomes: IncomeReceipt[],
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS
): AccountTransfer[] {
  const items: AccountTransfer[] = [];
  for (const inc of incomes) {
    const { nativeGross, currency: incCurr } = getIncomeNativeGross(
      inc,
      settings,
      accounts
    );
    const deds = getEffectiveIncomeDeductions(inc, settings);
    const sourceAccId = resolveValidAccountId(inc.accountId, accounts, settings);
    for (const d of deds) {
      if (!isSavingsDeduction(d)) continue;
      if (d.amount <= 0) continue;
      const nativeShares = computeSavingsBreakdown(d.amount, accounts, settings);
      const { convertedAmount: baseSavTotal, exchangeRate2dp: exchangeRate } = convertCurrency2dp(
        d.amount,
        incCurr,
        settings.currency
      );
      const baseShares = computeSavingsBreakdown(baseSavTotal, accounts, settings);

      for (let i = 0; i < nativeShares.length; i++) {
        const nativeShare = nativeShares[i];
        const baseShare = baseShares[i] || nativeShare;
        if (nativeShare.amount <= 0) continue;
        const destAcc = accounts.find((a) => a.id === nativeShare.accountId);
        const destCurr = getAccountCurrency(destAcc, settings.currency);
        const { convertedAmount: destShareAmount } = convertCurrency2dp(
          nativeShare.amount,
          incCurr,
          destCurr
        );
        items.push({
          id: `trans_sav_${inc.id}_${d.id}_${nativeShare.bucketId}`,
          userId: inc.userId,
          date: inc.date,
          sourceAccountId: sourceAccId,
          destinationAccountId: nativeShare.accountId,
          amount: baseShare.amount,
          sourceCurrency: incCurr,
          sourceAmount: nativeShare.amount,
          destinationCurrency: destCurr,
          destinationAmount: destShareAmount,
          exchangeRate,
          description: `${d.name} (${nativeShare.percentage}% Split → ${nativeShare.accountName}) · ${inc.clientOrSource}`,
          transferType: 'savings_deduction',
          linkedIncomeId: inc.id,
          linkedDeductionId: d.id,
          createdAt: inc.createdAt || new Date().toISOString(),
        });
      }
    }

    // If the user chose to transfer the Net Income after deductions to another account (or via Default Net Income Destination in Settings)
    const netDestAccId = getEffectiveNetTransferAccountId(inc, settings, accounts);
    if (netDestAccId && netDestAccId !== sourceAccId) {
      const totalNativeDeds = deds.reduce(
        (sum, d) => sum + (Number(d.amount) || 0),
        0
      );
      const nativeNetAmount = Math.max(
        0,
        Math.round((nativeGross - totalNativeDeds) * 100) / 100
      );
      if (nativeNetAmount > 0) {
        const destAcc = accounts.find((a) => a.id === netDestAccId);
        const destCurr = getAccountCurrency(destAcc, settings.currency);
        const { convertedAmount: baseNetAmount, exchangeRate2dp: exchangeRate } =
          convertCurrency2dp(nativeNetAmount, incCurr, settings.currency);
        const { convertedAmount: destNetAmount } = convertCurrency2dp(
          nativeNetAmount,
          incCurr,
          destCurr
        );
        items.push({
          id: `trans_net_${inc.id}`,
          userId: inc.userId,
          date: inc.date,
          sourceAccountId: sourceAccId,
          destinationAccountId: netDestAccId,
          amount: baseNetAmount,
          sourceCurrency: incCurr,
          sourceAmount: nativeNetAmount,
          destinationCurrency: destCurr,
          destinationAmount: destNetAmount,
          exchangeRate,
          description: `Net Income After Deductions (${inc.clientOrSource}) → ${destAcc?.name || 'Account'}`,
          transferType: 'rebalance',
          linkedIncomeId: inc.id,
          createdAt: inc.createdAt || new Date().toISOString(),
        });
      }
    }
  }
  return items;
}

export function generateCustomDeductionExpensesForIncome(
  receipt: IncomeReceipt,
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS
): FlexibleExpense[] {
  return getIncomeDeductionExpenses([receipt], settings, accounts);
}

export function generateAutomatedTransfersForIncome(
  receipt: IncomeReceipt,
  settings: UserSettings,
  accounts: FinancialAccount[] = DEFAULT_FINANCIAL_ACCOUNTS
): AccountTransfer[] {
  return getSavingsSplitTransfers([receipt], settings, accounts);
}

export function getQuarterFromDate(dateStr: string): Quarter {
  if (!dateStr) return 'Q1';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Q1';
    const month = d.getMonth() + 1;
    if (month >= 1 && month <= 3) return 'Q1';
    if (month >= 4 && month <= 6) return 'Q2';
    if (month >= 7 && month <= 9) return 'Q3';
    return 'Q4';
  } catch {
    return 'Q1';
  }
}

export function getQuarterRate(quarter: Quarter, rates?: QuarterlyRates): number {
  const qRates = rates || DEFAULT_QUARTERLY_RATES;
  switch (quarter) {
    case 'Q1':
      return qRates.q1TargetRate ?? 0;
    case 'Q2':
      return qRates.q2TargetRate ?? 0;
    case 'Q3':
      return qRates.q3TargetRate ?? 0;
    case 'Q4':
      return qRates.q4TargetRate ?? 0;
    default:
      return 0;
  }
}

/**
 * Calculates per-income allocation breakdown in the system base currency (`settings.currency`)
 * for consolidated totals across Dashboard, Analytics, Monthly Summary, and Savings Vaults,
 * converting non-base currency incomes, deductions, and expenses using real-time 2-point floating market rates.
 */
export function calculateAllocation(
  receipt: IncomeReceipt,
  settings: UserSettings,
  allExpenses: FlexibleExpense[] = []
): AllocationResult {
  const { baseGross: gross, currency: incCurr } = getIncomeBaseGross(
    receipt,
    settings
  );
  const quarter: Quarter = receipt.quarter || getQuarterFromDate(receipt.date);
  const effectiveDeductions = getEffectiveIncomeDeductions(receipt, settings);

  const itemizedDeductions: ItemizedDeduction[] = [];
  const customDeductionsList: {
    id?: string;
    name: string;
    description?: string;
    amount: number;
    type: 'fixed' | 'percentage';
    rateOrAmount: number;
    destinationAccountId?: string;
    isSavingsSplit?: boolean;
    savingsShares?: SavingsSplitShare[];
  }[] = [];

  let totalAllocatedDeductions = 0;
  let totalSavingsDeductions = 0;

  for (const ded of effectiveDeductions) {
    const dedAmount =
      ded.type === 'percentage'
        ? computeDeductionAmount(gross, ded.type, ded.value)
        : convertCurrency2dp(ded.amount, incCurr, settings.currency)
            .convertedAmount;
    const isSav = isSavingsDeduction(ded);
    totalAllocatedDeductions += dedAmount;
    if (isSav) {
      totalSavingsDeductions += dedAmount;
    }

    const savingsShares = isSav
      ? computeSavingsBreakdown(dedAmount, DEFAULT_FINANCIAL_ACCOUNTS, settings)
      : undefined;

    customDeductionsList.push({
      id: ded.id,
      name: ded.name,
      description: ded.description,
      amount: dedAmount,
      type: ded.type,
      rateOrAmount: ded.value,
      destinationAccountId: undefined,
      isSavingsSplit: isSav,
      savingsShares,
    });

    itemizedDeductions.push({
      id: ded.id,
      incomeReceiptId: receipt.id,
      clientOrSource: receipt.clientOrSource,
      date: receipt.date,
      name: ded.name,
      description: ded.description,
      type: ded.type,
      rateOrAmount: ded.value,
      amount: dedAmount,
      category: ded.name,
      destinationAccountId: undefined,
      isSavingsSplit: isSav,
      isMandatory: !isSav,
      isSavings: isSav,
    });
  }

  totalAllocatedDeductions = Math.round(totalAllocatedDeductions * 100) / 100;
  totalSavingsDeductions = Math.round(totalSavingsDeductions * 100) / 100;

  // Non-savings deductions are designated as Expenses
  const totalMandatoryDeductions =
    Math.round((totalAllocatedDeductions - totalSavingsDeductions) * 100) / 100;
  // Savings deductions are designated as Transfers to their respective savings splits
  const quarterSavingsAllocated = totalSavingsDeductions;
  const totalDeductionsFromIncome = totalAllocatedDeductions;
  const availableAfterCuts =
    Math.round((gross - totalMandatoryDeductions) * 100) / 100;
  const availableAfterCutsAndSavings =
    Math.round((gross - totalAllocatedDeductions) * 100) / 100;

  const receiptExpenses = allExpenses.filter(
    (exp) =>
      exp.incomeReceiptId === receipt.id &&
      !exp.id.startsWith('exp_cut_') &&
      !exp.id.startsWith('exp_ded_') &&
      exp.vaultAction !== 'credit'
  );
  const flexibleExpensesTotal = receiptExpenses.reduce(
    (sum, exp) => sum + getExpenseNativeAndBaseAmount(exp, settings).baseAmount,
    0
  );

  const netForSavings =
    Math.round((availableAfterCutsAndSavings - flexibleExpensesTotal) * 100) /
    100;
  const remainingDisposable = netForSavings;

  const effectiveRatePct =
    gross > 0
      ? Math.round(((totalAllocatedDeductions / gross) * 100) * 10) / 10
      : 0;

  const overallSavingsBreakdown = computeSavingsBreakdown(
    totalSavingsDeductions,
    DEFAULT_FINANCIAL_ACCOUNTS,
    settings
  );
  const savingsDistribution = overallSavingsBreakdown.map((share) => ({
    bucketId: share.bucketId,
    bucketName: share.bucketName,
    percentage: share.percentage,
    amount: share.amount,
    subBucketBreakdown: [],
  }));

  const warningReasons: string[] = [];
  let isOverAllocated = false;

  if (totalAllocatedDeductions > gross) {
    isOverAllocated = true;
    warningReasons.push(
      `Allocated deductions exceed gross income by ${formatAmount(totalAllocatedDeductions - gross, settings.currency)}.`
    );
  }

  return {
    receiptId: receipt.id,
    clientOrSource: receipt.clientOrSource,
    date: receipt.date,
    grossAmount: gross,
    quarter,
    quarterlySavingsRate: effectiveRatePct,
    allowances: {
      subscription: false,
      data: false,
      projects: false,
      partnership: true,
    },
    subscriptionDeduction: 0,
    dataBundleDeduction: 0,
    projectBuildingsDeduction: 0,
    partnershipDeduction: 0,
    customDeductionsTotal: totalAllocatedDeductions,
    customDeductionsList,
    itemizedDeductions,
    totalMandatoryDeductions,
    quarterSavingsAllocated,
    totalDeductionsFromIncome,
    availableAfterCutsAndSavings,
    availableAfterCuts,
    netForSavings,
    savingsDistribution,
    flexibleExpensesTotal,
    flexibleExpensesList: receiptExpenses,
    remainingDisposable,
    isOverAllocated,
    warningReasons,
  };
}

/**
 * Aggregates monthly and cumulative performance metrics in the system base currency (`settings.currency`),
 * converting all non-base currency incomes, deductions, and expenses using real-time 2-point floating market rates.
 */
export function calculateMonthlySummary(
  incomes: IncomeReceipt[],
  settings: UserSettings,
  expenses: FlexibleExpense[]
) {
  const sortedIncomes = [...incomes].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const allocations = sortedIncomes.map((inc) =>
    calculateAllocation(inc, settings, expenses)
  );

  let cumulativeGross = 0;
  let cumulativeMandatoryDeductions = 0;
  let cumulativeAvailableAfterCuts = 0;
  let cumulativeFlexibleExpenses = 0;
  let cumulativeQuarterSavingsAllocated = 0;
  let cumulativeRemainingDisposable = 0;

  const allItemizedDeductions: ItemizedDeduction[] = [];

  const monthlyGroups: Record<
    string,
    {
      monthKey: string;
      quarter: Quarter;
      receiptCount: number;
      grossTotal: number;
      deductionsTotal: number;
      availableAfterCutsTotal: number;
      flexibleExpensesTotal: number;
      savingsAllocatedTotal: number;
      remainingDisposableTotal: number;
      buckets: Record<string, number>;
      allocations: AllocationResult[];
    }
  > = {};

  for (const alloc of allocations) {
    cumulativeGross += alloc.grossAmount;
    cumulativeMandatoryDeductions += alloc.totalMandatoryDeductions;
    cumulativeAvailableAfterCuts += alloc.availableAfterCuts;
    // Non-savings deductions (totalMandatoryDeductions) are designated as expenses
    cumulativeFlexibleExpenses +=
      alloc.flexibleExpensesTotal + alloc.totalMandatoryDeductions;
    cumulativeQuarterSavingsAllocated += alloc.quarterSavingsAllocated;
    cumulativeRemainingDisposable += alloc.remainingDisposable;

    allItemizedDeductions.push(...alloc.itemizedDeductions);

    const monthKey = alloc.date ? alloc.date.substring(0, 7) : 'Unassigned';
    if (!monthlyGroups[monthKey]) {
      monthlyGroups[monthKey] = {
        monthKey,
        quarter: alloc.quarter,
        receiptCount: 0,
        grossTotal: 0,
        deductionsTotal: 0,
        availableAfterCutsTotal: 0,
        flexibleExpensesTotal: 0,
        savingsAllocatedTotal: 0,
        remainingDisposableTotal: 0,
        buckets: {},
        allocations: [],
      };
    }

    const group = monthlyGroups[monthKey];
    group.receiptCount += 1;
    group.grossTotal += alloc.grossAmount;
    group.deductionsTotal += alloc.totalDeductionsFromIncome;
    group.availableAfterCutsTotal += alloc.availableAfterCuts;
    group.flexibleExpensesTotal +=
      alloc.flexibleExpensesTotal + alloc.totalMandatoryDeductions;
    group.savingsAllocatedTotal += alloc.quarterSavingsAllocated;
    group.remainingDisposableTotal += alloc.remainingDisposable;
    group.allocations.push(alloc);
  }

  const generalExpenses = expenses.filter(
    (e) =>
      !e.incomeReceiptId &&
      !e.id.startsWith('exp_cut_') &&
      !e.id.startsWith('exp_ded_') &&
      e.vaultAction !== 'credit'
  );
  const generalExpensesTotal = generalExpenses.reduce(
    (sum, e) => sum + getExpenseNativeAndBaseAmount(e, settings).baseAmount,
    0
  );
  cumulativeFlexibleExpenses = roundTo2Decimals(
    cumulativeFlexibleExpenses + generalExpensesTotal
  );
  cumulativeRemainingDisposable = roundTo2Decimals(
    cumulativeRemainingDisposable - generalExpensesTotal
  );
  cumulativeGross = roundTo2Decimals(cumulativeGross);
  cumulativeMandatoryDeductions = roundTo2Decimals(cumulativeMandatoryDeductions);
  cumulativeAvailableAfterCuts = roundTo2Decimals(cumulativeAvailableAfterCuts);
  cumulativeQuarterSavingsAllocated = roundTo2Decimals(
    cumulativeQuarterSavingsAllocated
  );

  const cumulativeTotalDeductions = roundTo2Decimals(
    cumulativeMandatoryDeductions + cumulativeQuarterSavingsAllocated
  );
  const cumulativeAvailableAfterCutsAndSavings = roundTo2Decimals(
    cumulativeGross - cumulativeTotalDeductions
  );
  const totalSavingsRate =
    cumulativeGross > 0
      ? (cumulativeQuarterSavingsAllocated / cumulativeGross) * 100
      : 0;

  return {
    allocations,
    allItemizedDeductions,
    cumulativeGross,
    cumulativeMandatoryDeductions,
    cumulativeAvailableAfterCuts,
    cumulativeTotalDeductions,
    cumulativeAvailableAfterCutsAndSavings,
    cumulativeFlexibleExpenses,
    cumulativeQuarterSavingsAllocated,
    cumulativeRemainingDisposable,
    cumulativeBuckets: [] as { name: string; amount: number }[],
    quarterlyAggregates: [] as {
      quarter: Quarter;
      targetRate: number;
      gross: number;
      mandatoryCuts: number;
      availableAfterCuts: number;
      flexibleExpenses: number;
      savingsAllocated: number;
      remainingDisposable: number;
      effectiveSavingsRate: number;
    }[],
    totalSavingsRate,
    monthlyBreakdown: Object.values(monthlyGroups).sort((a, b) =>
      b.monthKey.localeCompare(a.monthKey)
    ),
  };
}

/**
 * Clean currency and number formatting with tabular numerals
 */
export function formatAmount(amount: number, currency = 'GHS'): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number): string {
  const num = Number.isFinite(value) ? value : 0;
  return `${num.toFixed(1)}%`;
}

export interface CurrencyBucketTotal {
  currency: string;
  amount: number;
}

/**
 * Adds a 2-point floating amount to a currency bucket map.
 */
export function addCurrencyBucketAmount(
  map: Map<string, number>,
  currency: string,
  amount: number
): void {
  const code = (currency || 'GHS').trim().toUpperCase();
  const cleanAmt = roundTo2Decimals(amount);
  map.set(code, roundTo2Decimals((map.get(code) || 0) + cleanAmt));
}

/**
 * Converts a currency bucket map into a sorted array of CurrencyBucketTotal items.
 */
export function mapToCurrencyBucketTotals(
  map: Map<string, number>,
  defaultCurrency = 'GHS'
): CurrencyBucketTotal[] {
  const entries = Array.from(map.entries())
    .map(([currency, amount]) => ({
      currency,
      amount: roundTo2Decimals(amount),
    }))
    .filter((item) => Math.abs(item.amount) >= 0.005);

  if (entries.length === 0) {
    return [{ currency: (defaultCurrency || 'GHS').trim().toUpperCase(), amount: 0 }];
  }
  return entries;
}

/**
 * Formats an aggregate total according to `settings.totalsCurrencyMode`:
 * - `'base'`: Displays the consolidated total in `settings.currency` (converted at real-time market rates).
 * - `'original'`: Displays the totals grouped in each account's original currency (e.g., `GHS 10,000.00 · USD 1,200.00`).
 */
export function formatTotalByCurrencyMode(
  baseAmount: number,
  currencyTotals: CurrencyBucketTotal[],
  settings: UserSettings,
  options?: { prefix?: string }
): string {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const prefix = options?.prefix || '';

  if (settings.totalsCurrencyMode !== 'original') {
    if (prefix === '-') {
      return `-${formatAmount(Math.abs(baseAmount), sysCurr)}`;
    }
    return `${prefix}${formatAmount(baseAmount, sysCurr)}`;
  }

  const nonZero = (currencyTotals || []).filter(
    (item) => Math.abs(item.amount) >= 0.005
  );
  const buckets =
    nonZero.length > 0
      ? nonZero
      : currencyTotals && currencyTotals.length > 0
      ? [currencyTotals[0]]
      : [{ currency: sysCurr, amount: baseAmount }];

  return buckets
    .map((item) => {
      if (prefix === '-') {
        return `-${formatAmount(Math.abs(item.amount), item.currency)}`;
      }
      return `${prefix}${formatAmount(item.amount, item.currency)}`;
    })
    .join(' · ');
}

/**
 * Returns a secondary caption showing the real-time market converted equivalent (when in `'original'` mode)
 * or the per-account original currency breakdown (when in `'base'` mode), whenever non-base currencies are present.
 */
export function getSecondaryCurrencyModeCaption(
  baseAmount: number,
  currencyTotals: CurrencyBucketTotal[],
  settings: UserSettings,
  options?: { prefix?: string }
): string | null {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const prefix = options?.prefix || '';
  const nonZero = (currencyTotals || []).filter(
    (item) => Math.abs(item.amount) >= 0.005
  );
  const hasForeignCurrency = nonZero.some((item) => item.currency !== sysCurr);

  if (!hasForeignCurrency) {
    return null;
  }

  if (settings.totalsCurrencyMode === 'original') {
    const formattedBase =
      prefix === '-'
        ? `-${formatAmount(Math.abs(baseAmount), sysCurr)}`
        : `${prefix}${formatAmount(baseAmount, sysCurr)}`;
    return `≈ ${formattedBase} in ${sysCurr}`;
  }

  const formattedOriginals = nonZero
    .map((item) =>
      prefix === '-'
        ? `-${formatAmount(Math.abs(item.amount), item.currency)}`
        : `${prefix}${formatAmount(item.amount, item.currency)}`
    )
    .join(' · ');

  return `Accounts: ${formattedOriginals}`;
}

/**
 * Formats an individual account summary card's balance according to `settings.totalsCurrencyMode`,
 * applying real-time market rate conversion where necessary.
 */
export function formatAccountCardBalanceByMode(
  summary: AccountBalanceSummary,
  settings: UserSettings,
  snapshot?: MarketFxSnapshot | null
): {
  primaryText: string;
  secondaryText: string | null;
  isNegative: boolean;
} {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const accCurr = (
    summary.accountCurrency || getAccountCurrency(summary.account, sysCurr)
  )
    .trim()
    .toUpperCase();
  const nativeAmt = roundTo2Decimals(
    summary.nativeCurrentCashBalance ?? summary.currentCashBalance
  );
  const baseAmt =
    accCurr === sysCurr
      ? nativeAmt
      : convertCurrency2dp(nativeAmt, accCurr, sysCurr, snapshot).convertedAmount;

  if (settings.totalsCurrencyMode === 'original') {
    return {
      primaryText: formatAmount(nativeAmt, accCurr),
      secondaryText:
        accCurr !== sysCurr ? `≈ ${formatAmount(baseAmt, sysCurr)}` : null,
      isNegative: nativeAmt < 0,
    };
  }

  return {
    primaryText: formatAmount(baseAmt, sysCurr),
    secondaryText:
      accCurr !== sysCurr ? formatAmount(nativeAmt, accCurr) : null,
    isNegative: baseAmt < 0,
  };
}

export interface AccountBalanceSummary {
  account: FinancialAccount;
  accountCurrency?: string;
  nativeInitialBalance?: number;
  nativeGrossDeposited?: number;
  nativeExpensesPaid?: number;
  nativeTransfersIn?: number;
  nativeTransfersOut?: number;
  nativeStandaloneCashBalance?: number;
  nativeAttachedVirtualBalance?: number;
  nativeCurrentCashBalance?: number;
  initialBalance: number;
  grossDeposited: number;
  mandatoryCutsIncurred: number;
  savingsAllocatedIncurred: number;
  totalDeductionsIncurred: number;
  netRetainedFromIncomes: number;
  incomingDeductionAllocations: number;
  netIncomeTransferredIn: number;
  netIncomeTransferredOut: number;
  expensesPaid: number;
  vaultCreditsIn: number;
  vaultDebitsOut: number;
  transfersIn: number;
  transfersOut: number;
  standaloneCashBalance: number;
  attachedVirtualBalance: number;
  attachedAccountsCount: number;
  currentCashBalance: number;
  pendingSavingsTransfers: number;
  pendingProjectTransfers: number;
  pendingMandatoryTransfers: number;
  availableLiquidToSpend: number;
  incomeCount: number;
}

export function calculateAccountSummaries(
  accounts: FinancialAccount[],
  incomes: IncomeReceipt[],
  expenses: FlexibleExpense[],
  settings: UserSettings,
  transfers: AccountTransfer[],
  snapshot?: MarketFxSnapshot | null
) {
  const sysCurr = (settings.currency || 'GHS').trim().toUpperCase();
  const manualTransfers = transfers.filter(
    (t) =>
      !t.id.startsWith('trans_auto_') &&
      !t.id.startsWith('trans_sav_') &&
      !t.id.startsWith('trans_net_')
  );
  const standaloneExpenses = expenses.filter(
    (e) => !e.id.startsWith('exp_cut_') && !e.id.startsWith('exp_ded_')
  );

  const effectivePillars = getEffectiveSavingsPillars(settings);
  const operatingAccountsList = accounts.filter(
    (a) => !isSavingsVaultAccount(a, settings)
  );
  // Guarantee at least one operating account exists so deposits and net transfers always have a valid operating account
  const ensuredOperatingAccountsList =
    operatingAccountsList.length > 0
      ? operatingAccountsList
      : [
          {
            ...DEFAULT_FINANCIAL_ACCOUNTS[0],
            userId: settings.userId || DEFAULT_FINANCIAL_ACCOUNTS[0].userId,
          },
        ];

  const vaultAccountsList: FinancialAccount[] = effectivePillars.map((pillar) => {
    const existing = accounts.find(
      (a) =>
        a.id === pillar.accountId ||
        (a.linkedSavingsBucketId && a.linkedSavingsBucketId === pillar.bucketId)
    );
    return {
      id: pillar.accountId,
      userId: existing?.userId || settings.userId,
      name: pillar.name,
      type: 'Savings Pillar',
      institution: pillar.institution,
      currency: existing?.currency || sysCurr,
      isDefaultDeposit: false,
      isVirtual:
        existing?.isVirtual !== undefined
          ? Boolean(existing.isVirtual)
          : pillar.isVirtual,
      initialBalance: existing?.initialBalance || 0,
      originalInitialBalance: existing?.originalInitialBalance,
      color: existing?.color || pillar.color,
      linkedSavingsBucketId: pillar.bucketId,
      custodianAccountId:
        settings.vaultCustodianAccounts?.[pillar.accountId] ||
        pillar.custodianAccountId ||
        existing?.custodianAccountId,
      description: pillar.description,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: existing?.updatedAt || new Date().toISOString(),
    };
  });

  const effectiveAccountsList = [
    ...ensuredOperatingAccountsList,
    ...vaultAccountsList,
  ];

  // Pass 1: Compute each account's own standalone ledger in its native currency (`accCurr`) AND in `settings.currency` (`sysCurr`)
  const baseSummaries: AccountBalanceSummary[] = effectiveAccountsList.map((account) => {
    const accCurr = getAccountCurrency(account, sysCurr);

    // 1. Incomes deposited into this account (resolving legacy/orphaned accountIds to the default operating account)
    const accountIncomes = incomes.filter((inc) => {
      const targetAccId = resolveValidAccountId(
        inc.accountId,
        effectiveAccountsList,
        settings
      );
      return targetAccId === account.id;
    });

    let nativeGrossDeposited = 0;
    let nativeTotalDeductionsIncurred = 0;
    let nativeSavingsAllocatedIncurred = 0;
    let nativeNetIncomeTransferredOut = 0;

    for (const inc of accountIncomes) {
      const { nativeGross, currency: incCurr } = getIncomeNativeGross(
        inc,
        settings,
        effectiveAccountsList
      );
      const incGrossInAcc = convertCurrency2dp(
        nativeGross,
        incCurr,
        accCurr
      ).convertedAmount;
      nativeGrossDeposited += incGrossInAcc;

      const deds = getEffectiveIncomeDeductions(
        inc,
        settings,
        standaloneExpenses
      );
      let incTotalDedsNative = 0;
      let incSavDedsNative = 0;
      for (const d of deds) {
        incTotalDedsNative += Number(d.amount) || 0;
        if (isSavingsDeduction(d)) {
          incSavDedsNative += Number(d.amount) || 0;
        }
      }
      nativeTotalDeductionsIncurred += convertCurrency2dp(
        incTotalDedsNative,
        incCurr,
        accCurr
      ).convertedAmount;
      nativeSavingsAllocatedIncurred += convertCurrency2dp(
        incSavDedsNative,
        incCurr,
        accCurr
      ).convertedAmount;

      const sourceAccId = resolveValidAccountId(
        inc.accountId,
        effectiveAccountsList,
        settings
      );
      const netDestId = getEffectiveNetTransferAccountId(
        inc,
        settings,
        effectiveAccountsList
      );
      const incNetNative = Math.max(
        0,
        roundTo2Decimals(nativeGross - incTotalDedsNative)
      );
      if (netDestId && netDestId !== sourceAccId && incNetNative > 0) {
        nativeNetIncomeTransferredOut += convertCurrency2dp(
          incNetNative,
          incCurr,
          accCurr
        ).convertedAmount;
      }
    }

    nativeGrossDeposited = roundTo2Decimals(nativeGrossDeposited);
    nativeTotalDeductionsIncurred = roundTo2Decimals(
      nativeTotalDeductionsIncurred
    );
    nativeSavingsAllocatedIncurred = roundTo2Decimals(
      nativeSavingsAllocatedIncurred
    );
    nativeNetIncomeTransferredOut = roundTo2Decimals(
      nativeNetIncomeTransferredOut
    );
    const nativeMandatoryCutsIncurred = roundTo2Decimals(
      nativeTotalDeductionsIncurred - nativeSavingsAllocatedIncurred
    );

    // 3. Incoming Savings Split Transfers & Net Income Transfers routed INTO this account
    let nativeIncomingDeductionAllocations = 0;
    let nativeNetIncomeTransferredIn = 0;
    for (const inc of incomes) {
      const sourceAccId = resolveValidAccountId(
        inc.accountId,
        effectiveAccountsList,
        settings
      );
      const { nativeGross, currency: incCurr } = getIncomeNativeGross(
        inc,
        settings,
        effectiveAccountsList
      );
      const deds = getEffectiveIncomeDeductions(inc, settings);
      let incTotalDedsNative = 0;
      for (const d of deds) {
        incTotalDedsNative += Number(d.amount) || 0;
        if (isSavingsDeduction(d)) {
          const shares = computeSavingsBreakdown(
            d.amount,
            effectiveAccountsList,
            settings
          );
          for (const share of shares) {
            if (share.accountId === account.id) {
              nativeIncomingDeductionAllocations += convertCurrency2dp(
                share.amount,
                incCurr,
                accCurr
              ).convertedAmount;
            }
          }
        }
      }

      const netDestId = getEffectiveNetTransferAccountId(
        inc,
        settings,
        effectiveAccountsList
      );
      if (netDestId && netDestId === account.id && sourceAccId !== account.id) {
        const incNetNative = Math.max(
          0,
          roundTo2Decimals(nativeGross - incTotalDedsNative)
        );
        if (incNetNative > 0) {
          nativeNetIncomeTransferredIn += convertCurrency2dp(
            incNetNative,
            incCurr,
            accCurr
          ).convertedAmount;
        }
      }
    }
    nativeIncomingDeductionAllocations = roundTo2Decimals(
      nativeIncomingDeductionAllocations
    );
    nativeNetIncomeTransferredIn = roundTo2Decimals(
      nativeNetIncomeTransferredIn
    );

    const nativeNetRetainedFromIncomes = roundTo2Decimals(
      nativeGrossDeposited -
        nativeTotalDeductionsIncurred -
        nativeNetIncomeTransferredOut
    );

    // 4. Standalone expenses/debits drawn from this account + Vault credits returned to this account
    const accountExpenses = standaloneExpenses.filter((exp) => {
      const targetAccId = resolveValidAccountId(
        exp.accountId,
        effectiveAccountsList,
        settings
      );
      return targetAccId === account.id;
    });

    const resolveExpenseInAccountCurrency = (exp: FlexibleExpense): number => {
      const hasOrig =
        exp.originalAmount !== undefined && Number(exp.originalAmount) > 0;
      const expCurr = (exp.currency || accCurr).trim().toUpperCase();
      if (hasOrig) {
        return convertCurrency2dp(
          Number(exp.originalAmount),
          expCurr,
          accCurr
        ).convertedAmount;
      }
      // Legacy expense stored in system currency without originalAmount
      return convertCurrency2dp(
        Number(exp.amount) || 0,
        sysCurr,
        accCurr
      ).convertedAmount;
    };

    const nativeStandaloneDebitsPaid = roundTo2Decimals(
      accountExpenses
        .filter((exp) => exp.vaultAction !== 'credit')
        .reduce((sum, exp) => sum + resolveExpenseInAccountCurrency(exp), 0)
    );
    const nativeVaultCreditsIn = roundTo2Decimals(
      accountExpenses
        .filter((exp) => exp.vaultAction === 'credit')
        .reduce((sum, exp) => sum + resolveExpenseInAccountCurrency(exp), 0)
    );
    const nativeVaultDebitsOut = nativeStandaloneDebitsPaid;
    const nativeExpensesPaid = roundTo2Decimals(
      nativeStandaloneDebitsPaid + nativeMandatoryCutsIncurred
    );

    // 5. Transfers In & Out in account's native currency (`accCurr`)
    const accountTransfersIn = manualTransfers.filter(
      (t) =>
        resolveValidAccountId(
          t.destinationAccountId,
          effectiveAccountsList,
          settings
        ) === account.id
    );
    const accountTransfersOut = manualTransfers.filter(
      (t) =>
        resolveValidAccountId(
          t.sourceAccountId,
          effectiveAccountsList,
          settings
        ) === account.id
    );

    const nativeManualTransfersInSum = roundTo2Decimals(
      accountTransfersIn.reduce((sum, t) => {
        if (
          t.destinationCurrency &&
          t.destinationAmount !== undefined &&
          Number(t.destinationAmount) > 0
        ) {
          return (
            sum +
            convertCurrency2dp(
              Number(t.destinationAmount),
              t.destinationCurrency,
              accCurr
            ).convertedAmount
          );
        }
        if (
          t.sourceCurrency &&
          t.sourceAmount !== undefined &&
          Number(t.sourceAmount) > 0
        ) {
          return (
            sum +
            convertCurrency2dp(
              Number(t.sourceAmount),
              t.sourceCurrency,
              accCurr
            ).convertedAmount
          );
        }
        return (
          sum +
          convertCurrency2dp(Number(t.amount) || 0, sysCurr, accCurr)
            .convertedAmount
        );
      }, 0)
    );

    const nativeManualTransfersOutSum = roundTo2Decimals(
      accountTransfersOut.reduce((sum, t) => {
        if (
          t.sourceCurrency &&
          t.sourceAmount !== undefined &&
          Number(t.sourceAmount) > 0
        ) {
          return (
            sum +
            convertCurrency2dp(
              Number(t.sourceAmount),
              t.sourceCurrency,
              accCurr
            ).convertedAmount
          );
        }
        return (
          sum +
          convertCurrency2dp(Number(t.amount) || 0, sysCurr, accCurr)
            .convertedAmount
        );
      }, 0)
    );

    const nativeTransfersIn = roundTo2Decimals(
      nativeManualTransfersInSum +
        nativeIncomingDeductionAllocations +
        nativeNetIncomeTransferredIn
    );
    const nativeTransfersOut = roundTo2Decimals(
      nativeManualTransfersOutSum +
        nativeSavingsAllocatedIncurred +
        nativeNetIncomeTransferredOut
    );

    const nativeInitialBalance = roundTo2Decimals(
      account.originalInitialBalance !== undefined
        ? Number(account.originalInitialBalance) || 0
        : Number(account.initialBalance) || 0
    );

    // 6. Intrinsic Standalone Account Balance in native account currency (`accCurr`)
    const nativeStandaloneCashBalance = roundTo2Decimals(
      nativeInitialBalance +
        nativeGrossDeposited +
        nativeTransfersIn +
        nativeVaultCreditsIn -
        nativeTransfersOut -
        nativeExpensesPaid
    );

    // Convert native account ledger figures to system base currency (`sysCurr`) at real-time 2-point floating market rates
    const toSys = (val: number) =>
      accCurr === sysCurr
        ? roundTo2Decimals(val)
        : convertCurrency2dp(val, accCurr, sysCurr, snapshot).convertedAmount;

    const initialBalance = toSys(nativeInitialBalance);
    const grossDeposited = toSys(nativeGrossDeposited);
    const mandatoryCutsIncurred = toSys(nativeMandatoryCutsIncurred);
    const savingsAllocatedIncurred = toSys(nativeSavingsAllocatedIncurred);
    const totalDeductionsIncurred = toSys(nativeTotalDeductionsIncurred);
    const netRetainedFromIncomes = toSys(nativeNetRetainedFromIncomes);
    const incomingDeductionAllocations = toSys(
      nativeIncomingDeductionAllocations
    );
    const netIncomeTransferredIn = toSys(nativeNetIncomeTransferredIn);
    const netIncomeTransferredOut = toSys(nativeNetIncomeTransferredOut);
    const expensesPaid = toSys(nativeExpensesPaid);
    const vaultCreditsIn = toSys(nativeVaultCreditsIn);
    const vaultDebitsOut = toSys(nativeVaultDebitsOut);
    const transfersIn = toSys(nativeTransfersIn);
    const transfersOut = toSys(nativeTransfersOut);
    const standaloneCashBalance = toSys(nativeStandaloneCashBalance);

    const enrichedAccount: FinancialAccount & {
      nativeCurrentCashBalance?: number;
      nativeStandaloneCashBalance?: number;
    } = {
      ...account,
      nativeCurrentCashBalance: nativeStandaloneCashBalance,
      nativeStandaloneCashBalance,
    };

    return {
      account: enrichedAccount,
      accountCurrency: accCurr,
      nativeInitialBalance,
      nativeGrossDeposited,
      nativeExpensesPaid,
      nativeTransfersIn,
      nativeTransfersOut,
      nativeStandaloneCashBalance,
      nativeAttachedVirtualBalance: 0,
      nativeCurrentCashBalance: nativeStandaloneCashBalance,
      initialBalance,
      grossDeposited,
      mandatoryCutsIncurred,
      savingsAllocatedIncurred,
      totalDeductionsIncurred,
      netRetainedFromIncomes,
      incomingDeductionAllocations,
      netIncomeTransferredIn,
      netIncomeTransferredOut,
      expensesPaid,
      vaultCreditsIn,
      vaultDebitsOut,
      transfersIn,
      transfersOut,
      standaloneCashBalance,
      attachedVirtualBalance: 0,
      attachedAccountsCount: 0,
      currentCashBalance: standaloneCashBalance,
      pendingSavingsTransfers: 0,
      pendingProjectTransfers: 0,
      pendingMandatoryTransfers: 0,
      availableLiquidToSpend: standaloneCashBalance,
      incomeCount: accountIncomes.length,
    };
  });

  // Pass 2: Roll up attached Virtual Accounts & Virtual Savings Vaults into their Main (non-virtual) Account
  // so both the Virtual/Vault account AND the Main Account display their figures (all spending/transfers/debits/credits
  // on a virtual account or vault are reflected in the Main Account), while Total Balance is taken from the Main Accounts.
  const summaries: AccountBalanceSummary[] = baseSummaries.map((s) => {
    if (isAccountVirtual(s.account, settings)) {
      return s;
    }

    const mainAccCurr = s.accountCurrency || getAccountCurrency(s.account, sysCurr);
    const attachedList = baseSummaries.filter(
      (candidate) =>
        candidate.account.id !== s.account.id &&
        isAccountVirtual(candidate.account, settings) &&
        resolveAttachedMainAccountId(
          candidate.account,
          effectiveAccountsList,
          settings
        ) === s.account.id
    );

    const attachedVirtualBalance = roundTo2Decimals(
      attachedList.reduce((sum, att) => sum + att.standaloneCashBalance, 0)
    );

    const nativeAttachedVirtualBalance = roundTo2Decimals(
      attachedList.reduce((sum, att) => {
        const attCurr =
          att.accountCurrency || getAccountCurrency(att.account, sysCurr);
        const attNative =
          att.nativeStandaloneCashBalance ?? att.standaloneCashBalance;
        return (
          sum +
          convertCurrency2dp(attNative, attCurr, mainAccCurr, snapshot).convertedAmount
        );
      }, 0)
    );

    const combinedMainBalance = roundTo2Decimals(
      s.standaloneCashBalance + attachedVirtualBalance
    );
    const nativeCombinedMainBalance = roundTo2Decimals(
      (s.nativeStandaloneCashBalance ?? s.standaloneCashBalance) +
        nativeAttachedVirtualBalance
    );

    const enrichedMainAccount: FinancialAccount & {
      nativeCurrentCashBalance?: number;
      nativeStandaloneCashBalance?: number;
    } = {
      ...s.account,
      nativeCurrentCashBalance: nativeCombinedMainBalance,
      nativeStandaloneCashBalance: s.nativeStandaloneCashBalance,
    };

    return {
      ...s,
      account: enrichedMainAccount,
      attachedVirtualBalance,
      nativeAttachedVirtualBalance,
      attachedAccountsCount: attachedList.length,
      currentCashBalance: combinedMainBalance,
      nativeCurrentCashBalance: nativeCombinedMainBalance,
      availableLiquidToSpend: combinedMainBalance,
    };
  });

  // Total balance across accounts is taken strictly from Main (non-virtual) accounts in `settings.currency`
  // (plus any unattached virtual account as a safety fallback) so virtual & vault balances are never double-counted.
  const mainAccountSummariesForTotals = summaries.filter(
    (s) =>
      !isAccountVirtual(s.account, settings) ||
      !resolveAttachedMainAccountId(
        s.account,
        effectiveAccountsList,
        settings
      )
  );

  const totalCashAcrossAllAccounts =
    Math.round(
      mainAccountSummariesForTotals.reduce(
        (sum, s) => sum + s.currentCashBalance,
        0
      ) * 100
    ) / 100;

  const totalGrossDeposited = roundTo2Decimals(
    summaries.reduce((sum, s) => sum + s.grossDeposited, 0)
  );
  const totalDeductionsAcrossIncomes = roundTo2Decimals(
    summaries.reduce((sum, s) => sum + s.totalDeductionsIncurred, 0)
  );
  const totalSavingsRouted = roundTo2Decimals(
    summaries.reduce((sum, s) => sum + s.savingsAllocatedIncurred, 0)
  );

  // Per-account original currency totals for `totalsCurrencyMode === 'original'`
  const cashByCurrMap = new Map<string, number>();
  for (const s of mainAccountSummariesForTotals) {
    const curr = s.accountCurrency || getAccountCurrency(s.account, sysCurr);
    const natBal = s.nativeCurrentCashBalance ?? s.currentCashBalance;
    addCurrencyBucketAmount(cashByCurrMap, curr, natBal);
  }

  const opCashByCurrMap = new Map<string, number>();
  const vaultCashByCurrMap = new Map<string, number>();
  const grossByCurrMap = new Map<string, number>();
  const netByCurrMap = new Map<string, number>();
  const savByCurrMap = new Map<string, number>();

  for (const s of summaries) {
    const curr = s.accountCurrency || getAccountCurrency(s.account, sysCurr);
    const natBal = s.nativeCurrentCashBalance ?? s.currentCashBalance;
    if (isSavingsVaultAccount(s.account, settings)) {
      addCurrencyBucketAmount(vaultCashByCurrMap, curr, natBal);
    } else {
      addCurrencyBucketAmount(opCashByCurrMap, curr, natBal);
    }

    const natGross = s.nativeGrossDeposited ?? s.grossDeposited;
    if (Math.abs(natGross) >= 0.005) {
      addCurrencyBucketAmount(grossByCurrMap, curr, natGross);
    }
  }

  for (const inc of incomes) {
    const { nativeGross, currency: incCurr } = getIncomeNativeGross(
      inc,
      settings,
      effectiveAccountsList
    );
    const deds = getEffectiveIncomeDeductions(inc, settings, standaloneExpenses);
    let incTotalDed = 0;
    let incSavDed = 0;
    for (const d of deds) {
      incTotalDed += Number(d.amount) || 0;
      if (isSavingsDeduction(d)) {
        incSavDed += Number(d.amount) || 0;
      }
    }
    const incNet = Math.max(0, roundTo2Decimals(nativeGross - incTotalDed));
    addCurrencyBucketAmount(netByCurrMap, incCurr, incNet);
    addCurrencyBucketAmount(savByCurrMap, incCurr, incSavDed);
  }

  return {
    summaries,
    totalCashAcrossAllAccounts,
    totalGrossDeposited,
    totalTransferredSavings: totalSavingsRouted,
    totalAllocatedSavings: totalDeductionsAcrossIncomes,
    totalPendingSavingsTransfers: 0,
    cashByCurrency: mapToCurrencyBucketTotals(cashByCurrMap, sysCurr),
    operatingCashByCurrency: mapToCurrencyBucketTotals(opCashByCurrMap, sysCurr),
    savingsVaultCashByCurrency: mapToCurrencyBucketTotals(
      vaultCashByCurrMap,
      sysCurr
    ),
    grossDepositedByCurrency: mapToCurrencyBucketTotals(grossByCurrMap, sysCurr),
    netAfterDeductionsByCurrency: mapToCurrencyBucketTotals(
      netByCurrMap,
      sysCurr
    ),
    transferredSavingsByCurrency: mapToCurrencyBucketTotals(
      savByCurrMap,
      sysCurr
    ),
  };
}
