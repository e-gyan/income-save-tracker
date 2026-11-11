/**
 * Real-Time Currency Conversion & Market Rate Synchronization Service
 * Ensures all exchange rate conversions and monetary figures adhere to 2-point floating precision.
 */

export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'GHS',
  'NGN',
  'KES',
  'ZAR',
  'CAD',
  'AUD',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Baseline USD rates used immediately before async market sync completes.
 */
const DEFAULT_USD_MARKET_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  GHS: 15.85,
  NGN: 1620.0,
  KES: 129.5,
  ZAR: 18.15,
  CAD: 1.39,
  AUD: 1.53,
};

export interface MarketFxSnapshot {
  base: string;
  rates: Record<string, number>;
  rates2dp: Record<string, number>;
  updatedAt: string;
  source: 'live_market' | 'fallback_market';
}

const LOCAL_FX_CACHE_KEY = 'iaft_market_fx_snapshot_v1';
let inMemoryFxSnapshot: MarketFxSnapshot | null = null;

/**
 * Strictly rounds any numeric value to 2 decimal places (2-point floating).
 */
export function roundTo2Decimals(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Formats a numeric value as a 2-decimal floating string (e.g., "15.85").
 */
export function format2PointFloat(value: number): string {
  return roundTo2Decimals(value).toFixed(2);
}

/**
 * Builds an immediate rate table relative to `baseCurrency` from baseline rates.
 */
export function getBaselineMarketRates(baseCurrency = 'USD'): MarketFxSnapshot {
  const upperBase = (baseCurrency || 'USD').trim().toUpperCase();
  const basePerUsd = DEFAULT_USD_MARKET_RATES[upperBase] || 1.0;
  const rates: Record<string, number> = {};
  const rates2dp: Record<string, number> = {};

  for (const [code, usdRate] of Object.entries(DEFAULT_USD_MARKET_RATES)) {
    const raw = code === upperBase ? 1.0 : usdRate / basePerUsd;
    rates[code] = Number(raw.toFixed(6));
    rates2dp[code] = roundTo2Decimals(raw);
  }

  return {
    base: upperBase,
    rates,
    rates2dp,
    updatedAt: new Date().toISOString(),
    source: 'fallback_market',
  };
}

/**
 * Loads the most recent cached FX snapshot or returns baseline rates.
 */
export function getInitialFxSnapshot(baseCurrency = 'USD'): MarketFxSnapshot {
  const upperBase = (baseCurrency || 'USD').trim().toUpperCase();
  if (inMemoryFxSnapshot && inMemoryFxSnapshot.base === upperBase) {
    return inMemoryFxSnapshot;
  }
  try {
    const raw = localStorage.getItem(`${LOCAL_FX_CACHE_KEY}_${upperBase}`);
    if (raw) {
      const parsed = JSON.parse(raw) as MarketFxSnapshot;
      if (parsed && parsed.base === upperBase && parsed.rates) {
        inMemoryFxSnapshot = parsed;
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return getBaselineMarketRates(upperBase);
}

/**
 * Fetches live market exchange rates from the backend proxy (`/api/fx/rates?base=...`).
 */
export async function fetchMarketExchangeRates(
  baseCurrency = 'USD'
): Promise<MarketFxSnapshot> {
  const upperBase = (baseCurrency || 'USD').trim().toUpperCase();
  try {
    const response = await fetch(
      `/api/fx/rates?base=${encodeURIComponent(upperBase)}`,
      {
        headers: { Accept: 'application/json' },
      }
    );
    if (response.ok) {
      const data = await response.json();
      if (data && data.success && data.rates) {
        const snapshot: MarketFxSnapshot = {
          base: upperBase,
          rates: data.rates,
          rates2dp: data.rates2dp || {},
          updatedAt: data.updatedAt || new Date().toISOString(),
          source: data.source === 'live_market' ? 'live_market' : 'fallback_market',
        };
        inMemoryFxSnapshot = snapshot;
        try {
          localStorage.setItem(
            `${LOCAL_FX_CACHE_KEY}_${upperBase}`,
            JSON.stringify(snapshot)
          );
        } catch {
          // ignore storage errors
        }
        return snapshot;
      }
    }
  } catch {
    // Fallback to cached or baseline rates when offline
  }

  return getInitialFxSnapshot(upperBase);
}

/**
 * Computes the market exchange rate to convert 1 unit of `fromCurrency` into `toCurrency`.
 * Returns the exchange rate rounded to 2 decimal places (`2-point floating`),
 * while preserving a safe non-zero precision fallback when converting micro-unit currencies.
 */
export function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  snapshot?: MarketFxSnapshot | null
): { rate2dp: number; rawRate: number } {
  const from = (fromCurrency || 'USD').trim().toUpperCase();
  const to = (toCurrency || 'USD').trim().toUpperCase();

  if (from === to) {
    return { rate2dp: 1.0, rawRate: 1.0 };
  }

  const activeSnap = snapshot || getInitialFxSnapshot(to);
  const rates = activeSnap.rates || {};
  const snapBase = (activeSnap.base || 'USD').toUpperCase();

  let rawRate = 1.0;

  if (snapBase === from && rates[to]) {
    rawRate = rates[to];
  } else if (snapBase === to && rates[from]) {
    rawRate = 1 / rates[from];
  } else if (rates[from] && rates[to]) {
    rawRate = rates[to] / rates[from];
  } else {
    const fallbackSnap = getBaselineMarketRates(from);
    rawRate = fallbackSnap.rates[to] || 1.0;
  }

  const rounded2dp = roundTo2Decimals(rawRate);
  return {
    rate2dp: rounded2dp > 0 ? rounded2dp : Number(rawRate.toFixed(4)),
    rawRate,
  };
}

/**
 * Converts an `amount` from `fromCurrency` to `toCurrency` using the provided market rate
 * (or live market snapshot), returning a strictly 2-point floating number (`0.00`).
 */
export function convertCurrency2dp(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  snapshot?: MarketFxSnapshot | null,
  customExchangeRate?: number
): {
  convertedAmount: number;
  exchangeRate2dp: number;
} {
  const cleanAmount = roundTo2Decimals(amount);
  const from = (fromCurrency || 'USD').trim().toUpperCase();
  const to = (toCurrency || 'USD').trim().toUpperCase();

  if (from === to) {
    return {
      convertedAmount: cleanAmount,
      exchangeRate2dp: 1.0,
    };
  }

  if (
    typeof customExchangeRate === 'number' &&
    Number.isFinite(customExchangeRate) &&
    customExchangeRate > 0
  ) {
    const rate2dp = roundTo2Decimals(customExchangeRate);
    const effectiveRate = rate2dp > 0 ? rate2dp : customExchangeRate;
    return {
      convertedAmount: roundTo2Decimals(cleanAmount * effectiveRate),
      exchangeRate2dp: rate2dp > 0 ? rate2dp : Number(customExchangeRate.toFixed(4)),
    };
  }

  const { rate2dp, rawRate } = getExchangeRate(from, to, snapshot);
  // Use 2-point floating exchange rate when >= 0.01 so `amount * rate2dp` is 100% transparent
  const multiplier = rate2dp >= 0.01 ? rate2dp : rawRate;

  return {
    convertedAmount: roundTo2Decimals(cleanAmount * multiplier),
    exchangeRate2dp: rate2dp,
  };
}

/**
 * Returns the indicated currency for a given account, falling back to the app base currency.
 */
export function getAccountCurrency(
  account?: { currency?: string } | null,
  baseCurrency = 'USD'
): string {
  const raw = (account?.currency || baseCurrency || 'USD').trim().toUpperCase();
  return raw || 'USD';
}

/**
 * Converts a base-currency ledger amount into the account's native currency (2-point floating).
 */
export function convertBaseToAccountCurrency(
  baseAmount: number,
  account: { currency?: string; exchangeRate?: number } | null | undefined,
  baseCurrency: string,
  snapshot?: MarketFxSnapshot | null
): number {
  const accCurr = getAccountCurrency(account, baseCurrency);
  const baseCurr = (baseCurrency || 'USD').trim().toUpperCase();
  if (accCurr === baseCurr) {
    return roundTo2Decimals(baseAmount);
  }
  const { convertedAmount } = convertCurrency2dp(
    baseAmount,
    baseCurr,
    accCurr,
    snapshot
  );
  return convertedAmount;
}

/**
 * Computes an account's current balance in its own indicated currency (`account.currency || baseCurrency`).
 * Honors exact `nativeCurrentCashBalance` when present on the account/summary, or converts via 2-point floating market rates.
 */
export function getAccountNativeBalance(
  baseCashBalance: number,
  account:
    | {
        currency?: string;
        initialBalance?: number;
        originalInitialBalance?: number;
        nativeCurrentCashBalance?: number;
      }
    | null
    | undefined,
  baseCurrency: string,
  snapshot?: MarketFxSnapshot | null
): { amount: number; currency: string } {
  const accCurr = getAccountCurrency(account, baseCurrency);
  const baseCurr = (baseCurrency || 'USD').trim().toUpperCase();

  if (
    account &&
    typeof account.nativeCurrentCashBalance === 'number' &&
    Number.isFinite(account.nativeCurrentCashBalance)
  ) {
    return {
      amount: roundTo2Decimals(account.nativeCurrentCashBalance),
      currency: accCurr,
    };
  }

  if (accCurr === baseCurr) {
    return {
      amount: roundTo2Decimals(baseCashBalance),
      currency: accCurr,
    };
  }

  const { convertedAmount } = convertCurrency2dp(
    baseCashBalance,
    baseCurr,
    accCurr,
    snapshot
  );
  return {
    amount: convertedAmount,
    currency: accCurr,
  };
}

