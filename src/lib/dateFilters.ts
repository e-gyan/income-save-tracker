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

/**
 * Formats any Date object, YYYY-MM-DD string, DD/MM/YYYY string, or ISO timestamp
 * into strict `dd/mm/yyyy` format across the app.
 */
export function formatDateDDMMYYYY(
  dateInput: string | Date | undefined | null
): string {
  if (!dateInput) return '—';
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '—';
    const dd = String(dateInput.getDate()).padStart(2, '0');
    const mm = String(dateInput.getMonth() + 1).padStart(2, '0');
    const yyyy = dateInput.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  const trimmed = String(dateInput).trim();
  if (!trimmed) return '—';

  // Already dd/mm/yyyy
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    return trimmed;
  }

  // Standard YYYY-MM-DD (or ISO starting with YYYY-MM-DD)
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (ymdMatch) {
    return `${ymdMatch[3]}/${ymdMatch[2]}/${ymdMatch[1]}`;
  }

  const parsed = parseLocalCalendarDate(trimmed);
  if (!parsed) return trimmed;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = parsed.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Extracts HH:mm (24-hour) arrival time from an ISO timestamp string if available.
 */
export function formatArrivalTimeHHMM(
  createdAtInput: string | undefined | null
): string {
  if (!createdAtInput) return '';
  const d = new Date(createdAtInput);
  if (isNaN(d.getTime())) return '';
  // Ignore synthetic midnight placeholder timestamps like 2025-01-01T00:00:00.000Z
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (hh === '00' && min === '00' && String(createdAtInput).endsWith('00:00:00.000Z')) {
    return '';
  }
  return `${hh}:${min}`;
}

/**
 * Formats a record's date as `dd/mm/yyyy` and optionally appends its arrival time `HH:mm`.
 */
export function formatDateTimeDDMMYYYY(
  dateInput: string | Date | undefined | null,
  createdAtInput?: string | null,
  includeTime = true
): string {
  const datePart = formatDateDDMMYYYY(dateInput);
  if (!includeTime || !createdAtInput) return datePart;
  const timePart = formatArrivalTimeHHMM(createdAtInput);
  return timePart ? `${datePart} · ${timePart}` : datePart;
}

/**
 * Computes a numeric timestamp for sorting records strictly as they come in by time.
 * Combines the calendar date and the exact `createdAt` arrival timestamp.
 */
export function getRecordArrivalTimestamp(record: {
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  timestamp?: string;
}): number {
  const createdRaw = record.createdAt || record.timestamp || record.updatedAt;
  const createdMs = createdRaw ? new Date(createdRaw).getTime() : NaN;
  const dateObj = record.date ? parseLocalCalendarDate(record.date) : null;
  const dateMs = dateObj ? dateObj.getTime() : NaN;

  if (!isNaN(dateMs) && !isNaN(createdMs)) {
    // Use the calendar date as the primary day and preserve time-of-day + millisecond ordering from createdAt
    const createdDate = new Date(createdMs);
    const timeOfDayMs =
      createdDate.getHours() * 3600000 +
      createdDate.getMinutes() * 60000 +
      createdDate.getSeconds() * 1000 +
      createdDate.getMilliseconds();
    return dateMs + timeOfDayMs;
  }
  if (!isNaN(createdMs)) return createdMs;
  if (!isNaN(dateMs)) return dateMs;
  return 0;
}

/**
 * Sorts records as they come in by time (newest arrival first, with deterministic tie-breaker).
 */
export function sortRecordsByArrivalTime<
  T extends {
    id?: string;
    date?: string;
    createdAt?: string;
    updatedAt?: string;
    timestamp?: string;
  }
>(records: T[], direction: 'desc' | 'asc' = 'desc'): T[] {
  return [...records].sort((a, b) => {
    const timeA = getRecordArrivalTimestamp(a);
    const timeB = getRecordArrivalTimestamp(b);
    if (timeA !== timeB) {
      return direction === 'desc' ? timeB - timeA : timeA - timeB;
    }
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (createdA !== createdB) {
      return direction === 'desc' ? createdB - createdA : createdA - createdB;
    }
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

export type RecordGroupPeriod = 'none' | 'week' | 'month' | 'year';

export interface RecordPeriodGroup<T> {
  key: string;
  label: string;
  subLabel: string;
  startDateStr: string;
  endDateStr: string;
  items: T[];
}

/**
 * Groups records by Week (Monday–Sunday), Month, or Year while preserving arrival-time order inside each group.
 * All group labels use `dd/mm/yyyy`.
 */
export function groupRecordsByPeriod<
  T extends {
    id?: string;
    date?: string;
    createdAt?: string;
    updatedAt?: string;
    timestamp?: string;
  }
>(records: T[], groupBy: RecordGroupPeriod): RecordPeriodGroup<T>[] {
  const sorted = sortRecordsByArrivalTime(records, 'desc');

  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: 'All Records',
        subLabel: `${sorted.length} ${sorted.length === 1 ? 'record' : 'records'}`,
        startDateStr: '',
        endDateStr: '',
        items: sorted,
      },
    ];
  }

  const groupsMap = new Map<string, RecordPeriodGroup<T>>();

  for (const item of sorted) {
    const rawDate = item.date || item.createdAt || '';
    const d = parseLocalCalendarDate(rawDate) || new Date();
    const year = d.getFullYear();
    const month = d.getMonth();

    let key = '';
    let label = '';
    let startDateStr = '';
    let endDateStr = '';

    if (groupBy === 'week') {
      // Monday-start week
      const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon, ...
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(year, month, d.getDate() + diffToMonday);
      const weekEnd = new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + 6
      );
      const wsY = weekStart.getFullYear();
      const wsM = String(weekStart.getMonth() + 1).padStart(2, '0');
      const wsD = String(weekStart.getDate()).padStart(2, '0');
      key = `week_${wsY}-${wsM}-${wsD}`;
      startDateStr = formatDateDDMMYYYY(weekStart);
      endDateStr = formatDateDDMMYYYY(weekEnd);
      label = `Week: ${startDateStr} – ${endDateStr}`;
    } else if (groupBy === 'month') {
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);
      const monthName = monthStart.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      });
      key = `month_${year}-${String(month + 1).padStart(2, '0')}`;
      startDateStr = formatDateDDMMYYYY(monthStart);
      endDateStr = formatDateDDMMYYYY(monthEnd);
      label = `${monthName} (${startDateStr} – ${endDateStr})`;
    } else {
      // year
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31);
      key = `year_${year}`;
      startDateStr = formatDateDDMMYYYY(yearStart);
      endDateStr = formatDateDDMMYYYY(yearEnd);
      label = `Year ${year} (${startDateStr} – ${endDateStr})`;
    }

    const existing = groupsMap.get(key);
    if (existing) {
      existing.items.push(item);
      existing.subLabel = `${existing.items.length} ${
        existing.items.length === 1 ? 'record' : 'records'
      }`;
    } else {
      groupsMap.set(key, {
        key,
        label,
        subLabel: '1 record',
        startDateStr,
        endDateStr,
        items: [item],
      });
    }
  }

  return Array.from(groupsMap.values());
}

export function getPresetRangeDescription(
  preset: TimeRangePreset,
  referenceDate: Date = new Date()
): string {
  if (preset === 'all') return 'All records';

  const endStr = formatDateDDMMYYYY(referenceDate);
  const start = new Date(referenceDate);

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      return `${formatDateDDMMYYYY(start)} – ${endStr}`;
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
      return `${formatDateDDMMYYYY(monthStart)} – ${formatDateDDMMYYYY(monthEnd)}`;
    }
    case '31d':
    case '1m':
      start.setDate(start.getDate() - 30);
      return `${formatDateDDMMYYYY(start)} – ${endStr}`;
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
      return `${formatDateDDMMYYYY(lastMonthStart)} – ${formatDateDDMMYYYY(lastMonthEnd)}`;
    }
    case 'this_year': {
      const yearStart = new Date(referenceDate.getFullYear(), 0, 1);
      const yearEnd = new Date(referenceDate.getFullYear(), 11, 31);
      return `${formatDateDDMMYYYY(yearStart)} – ${formatDateDDMMYYYY(yearEnd)}`;
    }
    case '365d':
    case '1y':
      start.setDate(start.getDate() - 364);
      return `${formatDateDDMMYYYY(start)} – ${endStr}`;
    case 'last_year': {
      const prevYear = referenceDate.getFullYear() - 1;
      const prevYearStart = new Date(prevYear, 0, 1);
      const prevYearEnd = new Date(prevYear, 11, 31);
      return `${formatDateDDMMYYYY(prevYearStart)} – ${formatDateDDMMYYYY(prevYearEnd)}`;
    }
    default:
      return 'All Time';
  }
}

