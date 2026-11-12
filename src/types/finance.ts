/**
 * Core type definitions for the Income Allocation and Finance Tracker
 */

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface SavingsSplitShare {
  bucketId: string;
  bucketName: string;
  percentage: number; // 30, 15, 5, 20, 10, 15, 5
  amount: number;
  accountId: string;
  accountName: string;
}

export interface IncomeDeductionItem {
  id: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed';
  value: number; // e.g. 10 for 10% or 250 for fixed 250
  amount: number; // Calculated monetary amount deducted from this income record
  destinationAccountId?: string; // Optional single target account
  isSavingsSplit?: boolean; // When true (or when name is Savings), breaks down deducted amount into 30/15/5/20/10/15/5 and routes each to its account
  isCustomRateOverride?: boolean; // True when user explicitly customized the rate on this income record
  expenseCategory?: string; // Matched Expense Category from user preferences
  expenseSubcategory?: string; // Matched Expense Subcategory from user preferences
}

export interface CustomDeduction {
  id: string;
  name: string;
  type: 'fixed' | 'percentage';
  amount: number;
  quarterlyRates?: {
    Q1: number;
    Q2: number;
    Q3: number;
    Q4: number;
  };
  enabled: boolean;
  description?: string;
  destinationAccountId?: string;
  isSavingsSplit?: boolean;
  expenseCategory?: string; // Matched Expense Category from user preferences
  expenseSubcategory?: string; // Matched Expense Subcategory from user preferences
}

export interface SubBucket {
  id: string;
  name: string;
  percentageOfParent: number;
  targetAmount?: number;
  currentBalance?: number;
}

export interface SavingsBucket {
  id: string;
  name: string;
  percentage: number; // 30, 15, 5, 20, 10, 15, 5
  description?: string;
  accountId?: string;
  isVirtual?: boolean; // Whether the savings vault is a virtual sub-account attached to a main account (default true)
  custodianAccountId?: string; // Which non-virtual main account holds this savings share
  subBuckets?: SubBucket[];
}

export interface QuarterlyRates {
  q1TargetRate: number;
  q2TargetRate: number;
  q3TargetRate: number;
  q4TargetRate: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type TotalsCurrencyMode = 'base' | 'original';

export type AppColorTheme =
  | 'emerald'
  | 'sapphire'
  | 'indigo'
  | 'teal'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'slate';

export interface ExpenseCategoryPreference {
  id: string;
  name: string;
  color?: string;
  subcategories: string[];
  subcategoryColors?: Record<string, string>; // Maps subcategory name -> hex color (#RRGGBB)
}

export interface UserSettings {
  userId: string;
  currency: string;
  totalsCurrencyMode?: TotalsCurrencyMode; // 'base' = system base currency, 'original' = each account's original currency
  themeMode?: ThemeMode;
  colorTheme?: AppColorTheme;
  subscriptionFee?: number;
  dataBundleFee?: number;
  projectBuildingsRate?: number;
  customCuts: CustomDeduction[];
  savingsBuckets: SavingsBucket[];
  quarterlyRates: QuarterlyRates;
  incomeCategories?: string[];
  incomeSources?: string[];
  incomeOrigins?: string[];
  expenseCategories?: string[];
  expenseCategoryPreferences?: ExpenseCategoryPreference[];
  vaultCustodianAccounts?: Record<string, string>; // Maps vault accountId -> holding/custodian accountId
  accountTypes?: string[];
  defaultAccountId?: string;
  askNetIncomeTransfer?: boolean; // Ask user after deduction of an income where net should be transferred
  defaultNetIncomeAccountId?: string; // Optional default destination account for net income after deductions
  updatedAt: string;
}

export type AccountType = string;

export interface FinancialAccount {
  id: string;
  userId?: string;
  name: string;
  type: string;
  institution?: string;
  accountNumber?: string;
  currency?: string; // Account currency (e.g. USD, GHS, EUR); defaults to app currency in Settings
  originalInitialBalance?: number; // Initial balance in the account's native currency (2-point floating)
  exchangeRate?: number; // 2-point floating exchange rate applied at creation/edit
  isDefaultDeposit?: boolean;
  isVirtual?: boolean; // Indicates a virtual sub-account attached to a non-virtual main account
  initialBalance: number; // Reconciled initial balance in app base currency (2-point floating)
  color?: string;
  description?: string;
  linkedSavingsBucketId?: string;
  custodianAccountId?: string; // Non-virtual main account this virtual account or savings vault is attached to
  createdAt: string;
  updatedAt: string;
}

export interface AccountTransfer {
  id: string;
  userId?: string;
  date: string; // YYYY-MM-DD
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number; // Reconciled amount in app base currency (2-point floating)
  sourceCurrency?: string; // Native currency of source account
  sourceAmount?: number; // Amount debited in source account currency (2-point floating)
  destinationCurrency?: string; // Native currency of destination account
  destinationAmount?: number; // Amount credited in destination account currency (2-point floating)
  exchangeRate?: number; // 2-point floating exchange rate applied
  description: string;
  transferType: 'savings_deduction' | 'project_deduction' | 'tax_statutory' | 'general' | 'rebalance';
  linkedIncomeId?: string;
  linkedDeductionId?: string;
  createdAt: string;
}

export interface IncomeReceipt {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  quarter: Quarter;
  clientOrSource: string; // Income Title / Source
  category: string;
  accountId: string; // Deposit account that this income record falls into
  netTransferredToAccountId?: string; // Optional target account where Net Income after deductions is transferred
  currency?: string; // Selected currency when recording income (defaults to app currency in Settings)
  originalGrossAmount?: number; // 2-point floating amount in the selected income currency
  exchangeRate?: number; // 2-point floating market exchange rate synced at recording
  grossAmount: number; // Total Income Amount in app base currency (2-point floating)
  savingsRate: number;
  receiptId: string; // Automated reference ID
  notes?: string; // Income Description
  allocatedDeductions?: IncomeDeductionItem[]; // Per-income allocated deductions
  allowSubscription?: boolean;
  allowData?: boolean;
  allowProjects?: boolean;
  allowPartnership?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlexibleExpense {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  batchId?: string; // Groups multiple expenses recorded in a single instance
  incomeReceiptId?: string;
  accountId?: string; // Account to deduct from or credit (Operating or Savings Vault)
  recipient?: string; // "To" field (payee, vendor, or cause e.g. Treasury Bond, Mutual Funds, Buying of Lands)
  category: string;
  subcategory?: string;
  subcategoryColor?: string; // Intuitive or user-assigned hex color for the expense subcategory
  description?: string;
  notes?: string;
  currency?: string; // Currency in which expense was spent/recorded
  originalAmount?: number; // 2-point floating amount in spend currency
  exchangeRate?: number; // 2-point floating exchange rate to app base currency
  amount: number; // Reconciled amount in app base currency (2-point floating)
  vaultAction?: 'debit' | 'credit'; // For Savings Vault cause transactions: 'debit' deducts from vault & main account; 'credit' credits vault & main account
  linkedExpenseId?: string; // Links a vault 'credit' back to the original 'debit' cause instance
  createdAt: string;
}

export interface ItemizedDeduction {
  id: string;
  incomeReceiptId: string;
  clientOrSource: string;
  date: string;
  name: string;
  description?: string;
  type: 'fixed' | 'percentage';
  rateOrAmount: number;
  amount: number;
  category: string;
  destinationAccountId?: string;
  isSavingsSplit?: boolean;
  isMandatory: boolean;
  isSavings?: boolean;
}

export interface AllocationResult {
  receiptId: string;
  clientOrSource: string;
  date: string;
  grossAmount: number;
  quarter: Quarter;
  quarterlySavingsRate: number;
  allowances: {
    subscription: boolean;
    data: boolean;
    projects: boolean;
    partnership: boolean;
  };
  subscriptionDeduction: number;
  dataBundleDeduction: number;
  projectBuildingsDeduction: number;
  partnershipDeduction: number;
  customDeductionsTotal: number;
  customDeductionsList: {
    id?: string;
    name: string;
    description?: string;
    amount: number;
    type: 'fixed' | 'percentage';
    rateOrAmount: number;
    destinationAccountId?: string;
    isSavingsSplit?: boolean;
    savingsShares?: SavingsSplitShare[];
  }[];
  itemizedDeductions: ItemizedDeduction[];
  totalMandatoryDeductions: number;
  quarterSavingsAllocated: number;
  totalDeductionsFromIncome: number;
  availableAfterCutsAndSavings: number;
  availableAfterCuts: number;
  netForSavings: number;
  savingsDistribution: {
    bucketId: string;
    bucketName: string;
    percentage: number;
    amount: number;
    subBucketBreakdown: { subBucketName: string; amount: number }[];
  }[];
  flexibleExpensesTotal: number;
  flexibleExpensesList: FlexibleExpense[];
  remainingDisposable: number;
  isOverAllocated: boolean;
  warningReasons: string[];
}

export interface RevisionEntry {
  id: string;
  userId: string;
  versionNumber: number;
  semanticVersion?: string; // Standard Semantic Versioning e.g. "1.0.0", "1.1.0", "1.1.1"
  timestamp: string;
  actionType: string;
  summary: string;
  snapshotData?: string;
}

export type BudgetPeriodType = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type BudgetScopeType = 'single' | 'multiple';

export interface FinancialBudget {
  id: string;
  userId: string;
  name: string;
  periodType: BudgetPeriodType; // 'weekly' | 'monthly' | 'yearly' | 'custom'
  customStartDate?: string; // YYYY-MM-DD (required when periodType === 'custom')
  customEndDate?: string; // YYYY-MM-DD (required when periodType === 'custom')
  activePeriodStart?: string; // YYYY-MM-DD start of the active recurring cycle
  activePeriodEnd?: string; // YYYY-MM-DD end of the active recurring cycle
  parentRecurringBudgetId?: string; // Root/previous budget ID when auto-recreated for a new period
  isArchivedPeriod?: boolean; // True when a past recurring cycle has elapsed and been recreated
  scopeType: BudgetScopeType; // 'single' | 'multiple' subcategories
  subcategories: string[]; // Selected expense subcategories tracked by this budget
  categories?: string[]; // Optional parent expense categories for context
  accountId?: string; // Optional specific account to check against, or '' for all accounts
  currency: string; // Budget currency (e.g. GHS, USD, EUR)
  amount: number; // Budget limit amount in budget.currency (2-point floating)
  alertThresholdPercent?: number; // Warning threshold percentage (default 80%)
  color?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}


