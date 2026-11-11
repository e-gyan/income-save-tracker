/**
 * Date filtering engine with accurate local calendar date comparison:
 * ALL, 1D (Today), 7D, 14D, 1M (30d), 3M (90d), 1Y (365d).
 */

export type TimeRangePreset = 'all' | '1d' | '7d' | '14d' | '1m' | '3m' | '1y';

export interface TimeRangeOption {
  id: TimeRangePreset;
  label: string;
  shortLabel: string;
  days?: number;
}

export const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { id: 'all', label: 'All Time', shortLabel: 'ALL' },
  { id: '1d', label: 'Today', shortLabel: '1D', days: 1 },
  { id: '7d', label: '7 Days', shortLabel: '7D', days: 7 },
  { id: '14d', label: '14 Days', shortLabel: '14D', days: 14 },
  { id: '1m', label: '1 Month', shortLabel: '1M', days: 30 },
  { id: '3m', label: '3 Months', shortLabel: '3M', days: 90 },
  { id: '1y', label: '1 Year', shortLabel: '1Y', days: 365 },
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
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
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

  // Allow today (diffDays === 0) or future-dated entries made today (diffDays <= 0 for current day)
  if (diffDays < 0) {
    return false;
  }

  switch (preset) {
    case '1d':
      return diffDays === 0;
    case '7d':
      return diffDays <= 6;
    case '14d':
      return diffDays <= 13;
    case '1m':
      return diffDays <= 29;
    case '3m':
      return diffDays <= 89;
    case '1y':
      return diffDays <= 364;
    default:
      return true;
  }
}

export function getPresetLabel(preset: TimeRangePreset): string {
  const match = TIME_RANGE_OPTIONS.find((o) => o.id === preset);
  return match ? match.label : 'All Time';
}

export function getPresetRangeDescription(
  preset: TimeRangePreset,
  referenceDate: Date = new Date()
): string {
  if (preset === 'all') return 'All records';

  const formatShortDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const endStr = formatShortDate(referenceDate);
  const start = new Date(referenceDate);

  switch (preset) {
    case '1d':
      return `Today (${endStr})`;
    case '7d':
      start.setDate(start.getDate() - 6);
      return `${formatShortDate(start)} – ${endStr}`;
    case '14d':
      start.setDate(start.getDate() - 13);
      return `${formatShortDate(start)} – ${endStr}`;
    case '1m':
      start.setDate(start.getDate() - 29);
      return `${formatShortDate(start)} – ${endStr}`;
    case '3m':
      start.setDate(start.getDate() - 89);
      return `${formatShortDate(start)} – ${endStr}`;
    case '1y':
      start.setDate(start.getDate() - 364);
      return `${formatShortDate(start)} – ${endStr}`;
    default:
      return 'All Time';
  }
}
