/**
 * Redesigned Date Filtering Engine with Accurate Local Calendar Date Comparison:
 * - Last 7 days ('7d')
 * - This month ('this_month')
 * - Last 31 days ('31d')
 * - Last month ('last_month')
 * - This year ('this_year')
 * - Last 365 days ('365d')
 * - Last year ('last_year')
 * Plus 'all' (All Time) to reset/show all records.
 */

export type TimeRangePreset =
  | 'all'
  | '7d'
  | 'this_month'
  | '31d'
  | 'last_month'
  | 'this_year'
  | '365d'
  | 'last_year'
  // Legacy compatibility aliases
  | '1d'
  | '14d'
  | '1m'
  | '3m'
  | '1y';

export interface TimeRangeOption {
  id: TimeRangePreset;
  label: string;
  shortLabel: string;
  days?: number;
}

/**
 * The 7 primary redesigned date filters requested by the user.
 */
export const REDESIGNED_DATE_FILTER_OPTIONS: TimeRangeOption[] = [
  { id: '7d', label: 'Last 7 days', shortLabel: '7D', days: 7 },
  { id: 'this_month', label: 'This month', shortLabel: 'This Mo' },
  { id: '31d', label: 'Last 31 days', shortLabel: '31D', days: 31 },
  { id: 'last_month', label: 'Last month', shortLabel: 'Last Mo' },
  { id: 'this_year', label: 'This year', shortLabel: 'This Yr' },
  { id: '365d', label: 'Last 365 days', shortLabel: '365D', days: 365 },
  { id: 'last_year', label: 'Last year', shortLabel: 'Last Yr' },
];

export const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { id: 'all', label: 'All Time', shortLabel: 'All' },
  ...REDESIGNED_DATE_FILTER_OPTIONS,
];

/**
 * Parses a YYYY-MM-DD string or ISO timestamp into a local calendar Date at midnight (00:00:00).
 */
export function parseLocalCalendarDate(dateString: string): Date | null {
  const trimmed = dateString.trim();
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    const d = new Date(year, month, day, 0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    0,
    0,
    0,
    0
  );
}

/**
 * Checks if a given date string falls within the selected preset window using local calendar days.
 */
export function isDateInPreset(
  dateString: string | undefined | null,
  preset: TimeRangePreset,
  referenceDate: Date = new Date()
): boolean {
  if (preset === 'all') return true;
  if (!dateString) return false;

  const itemDay = parseLocalCalendarDate(dateString);
  if (!itemDay) return false;

  const refDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0
  );

  // Difference in calendar days (refDay - itemDay)
  const diffMs = refDay.getTime() - itemDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  switch (preset) {
    case '7d':
      return diffDays >= 0 && diffDays <= 6;
    case 'this_month':
      return (
        itemDay.getFullYear() === refDay.getFullYear() &&
        itemDay.getMonth() === refDay.getMonth()
      );
    case '31d':
    case '1m':
      return diffDays >= 0 && diffDays <= 30;
    case 'last_month': {
      const prevMonth = new Date(refDay.getFullYear(), refDay.getMonth() - 1, 1);
      return (
        itemDay.getFullYear() === prevMonth.getFullYear() &&
        itemDay.getMonth() === prevMonth.getMonth()
      );
    }
    case 'this_year':
      return itemDay.getFullYear() === refDay.getFullYear();
    case '365d':
    case '1y':
      return diffDays >= 0 && diffDays <= 364;
    case 'last_year':
      return itemDay.getFullYear() === refDay.getFullYear() - 1;
    // Legacy compatibility fallbacks
    case '1d':
      return diffDays === 0;
    case '14d':
      return diffDays >= 0 && diffDays <= 13;
    case '3m':
      return diffDays >= 0 && diffDays <= 89;
    default:
      return true;
  }
}

export function getPresetLabel(preset: TimeRangePreset): string {
  const match = TIME_RANGE_OPTIONS.find((o) => o.id === preset);
  return match ? match.label : 'All Time';
}

export function getPresetShortLabel(preset: TimeRangePreset): string {
  const match = TIME_RANGE_OPTIONS.find((o) => o.id === preset);
  return match ? match.shortLabel : 'All';
}

export function getPresetRangeDescription(
  preset: TimeRangePreset,
  referenceDate: Date = new Date()
): string {
  if (preset === 'all') return 'All records';

  const formatShortDate = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const endStr = formatShortDate(referenceDate);
  const start = new Date(referenceDate);

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      return `${formatShortDate(start)} – ${endStr}`;
    case 'this_month': {
      const monthStart = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth() + 1,
        0
      );
      return `${formatShortDate(monthStart)} – ${formatShortDate(monthEnd)}`;
    }
    case '31d':
    case '1m':
      start.setDate(start.getDate() - 30);
      return `${formatShortDate(start)} – ${endStr}`;
    case 'last_month': {
      const lastMonthStart = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth() - 1,
        1
      );
      const lastMonthEnd = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        0
      );
      return `${formatShortDate(lastMonthStart)} – ${formatShortDate(lastMonthEnd)}`;
    }
    case 'this_year': {
      const yearStart = new Date(referenceDate.getFullYear(), 0, 1);
      const yearEnd = new Date(referenceDate.getFullYear(), 11, 31);
      return `${formatShortDate(yearStart)} – ${formatShortDate(yearEnd)}`;
    }
    case '365d':
    case '1y':
      start.setDate(start.getDate() - 364);
      return `${formatShortDate(start)} – ${endStr}`;
    case 'last_year': {
      const prevYear = referenceDate.getFullYear() - 1;
      const prevYearStart = new Date(prevYear, 0, 1);
      const prevYearEnd = new Date(prevYear, 11, 31);
      return `${formatShortDate(prevYearStart)} – ${formatShortDate(prevYearEnd)}`;
    }
    default:
      return 'All Time';
  }
}
