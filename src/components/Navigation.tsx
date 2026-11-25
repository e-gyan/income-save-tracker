import React, { useRef } from 'react';
import {
  TimeRangePreset,
  CustomDateRange,
  TIME_RANGE_OPTIONS,
  formatDateDDMMYYYY,
} from '../lib/dateFilters.ts';

export type ActiveTab =
  | 'dashboard'
  | 'income_log'
  | 'flexible_expenses'
  | 'budgets'
  | 'accounts'
  | 'analytics'
  | 'settings';

export interface NavItem {
  id: ActiveTab;
  label: string;
  shortLabel: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    shortLabel: 'Overview',
  },
  {
    id: 'income_log',
    label: 'Income',
    shortLabel: 'Income',
  },
  {
    id: 'flexible_expenses',
    label: 'Expenses',
    shortLabel: 'Expenses',
  },
  {
    id: 'budgets',
    label: 'Budgets',
    shortLabel: 'Budgets',
  },
  {
    id: 'accounts',
    label: 'Accounts',
    shortLabel: 'Accounts',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    shortLabel: 'Analytics',
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
  },
];

export function renderNavIcon(id: ActiveTab, className = 'h-4 w-4'): React.ReactNode {
  switch (id) {
    case 'dashboard':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-3a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"
          />
        </svg>
      );
    case 'income_log':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          />
        </svg>
      );
    case 'flexible_expenses':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
          />
        </svg>
      );
    case 'budgets':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      );
    case 'accounts':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      );
    case 'analytics':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
          />
        </svg>
      );
    case 'settings':
      return (
        <svg
          className={className}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );
  }
}

interface NavigationProps {
  timeRange: TimeRangePreset;
  customDateRange?: CustomDateRange;
  onSelectTimeRange: (range: TimeRangePreset) => void;
  onCustomDateRangeChange?: (range: CustomDateRange) => void;
  recordCounts?: {
    incomes: number;
    expenses: number;
    transfers: number;
  };
  isOpenOnMobile?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  timeRange,
  customDateRange,
  onSelectTimeRange,
  onCustomDateRangeChange,
  recordCounts,
  isOpenOnMobile = true,
}) => {
  const showCustomBar = timeRange === 'custom' && Boolean(onCustomDateRangeChange);

  if (!isOpenOnMobile && !showCustomBar) {
    return null;
  }

  const startDate = customDateRange?.startDate || '';
  const endDate = customDateRange?.endDate || '';
  const todayYmd = new Date().toISOString().substring(0, 10);

  return (
    <div className="border-b border-slate-200/80 bg-slate-50/95">
      {isOpenOnMobile && (
        <div className="md:hidden mx-auto max-w-7xl px-3 py-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl border border-slate-200/90 bg-white p-1.5">
            {TIME_RANGE_OPTIONS.map((opt) => {
              const isSelected = timeRange === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectTimeRange(opt.id)}
                  className={`rounded-lg px-2 py-1.5 text-[11px] font-bold text-center transition-colors truncate ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-700 bg-slate-50/80 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showCustomBar && onCustomDateRangeChange && (
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-2 border-t border-slate-200/70 bg-white/95">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Custom Dates
              </span>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs">
                <span className="text-[11px] font-semibold text-slate-500">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) =>
                    onCustomDateRangeChange({
                      startDate: e.target.value,
                      endDate:
                        endDate && e.target.value && e.target.value > endDate
                          ? e.target.value
                          : endDate,
                    })
                  }
                  aria-label="Custom filter start date"
                  className="bg-transparent font-mono text-xs font-semibold text-slate-900 focus:outline-none"
                />
                {startDate && (
                  <span className="hidden sm:inline font-mono text-[10px] text-slate-500 tabular-nums">
                    ({formatDateDDMMYYYY(startDate)})
                  </span>
                )}
              </label>

              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs">
                <span className="text-[11px] font-semibold text-slate-500">To</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) =>
                    onCustomDateRangeChange({
                      startDate:
                        startDate && e.target.value && e.target.value < startDate
                          ? e.target.value
                          : startDate,
                      endDate: e.target.value,
                    })
                  }
                  aria-label="Custom filter end date"
                  className="bg-transparent font-mono text-xs font-semibold text-slate-900 focus:outline-none"
                />
                {endDate && (
                  <span className="hidden sm:inline font-mono text-[10px] text-slate-500 tabular-nums">
                    ({formatDateDDMMYYYY(endDate)})
                  </span>
                )}
              </label>

              <button
                type="button"
                onClick={() => {
                  const target = startDate || endDate || todayYmd;
                  onCustomDateRangeChange({ startDate: target, endDate: target });
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                Single Day
              </button>

              <button
                type="button"
                onClick={() => onSelectTimeRange('all')}
                className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 whitespace-nowrap"
              >
                Reset
              </button>
            </div>

            {recordCounts && (
              <div className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
                {recordCounts.incomes} income · {recordCounts.expenses} expenses ·{' '}
                {recordCounts.transfers} transfers
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const BOTTOM_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter(
  (item) => item.id !== 'settings' && item.id !== 'budgets'
);

interface BottomMenuBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

export const BottomMenuBar: React.FC<BottomMenuBarProps> = ({
  activeTab,
  onSelectTab,
}) => {
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const activeIndex = BOTTOM_NAV_ITEMS.findIndex((item) => item.id === activeTab);
  const canSlidePrev = activeIndex > 0;
  const canSlideNext =
    activeIndex >= 0 && activeIndex < BOTTOM_NAV_ITEMS.length - 1;

  const handleBarTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleBarTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (
      touchStartXRef.current === null ||
      touchStartYRef.current === null ||
      e.changedTouches.length === 0
    ) {
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (dx < 0 && canSlideNext) {
        onSelectTab(BOTTOM_NAV_ITEMS[activeIndex + 1].id);
      } else if (dx > 0 && canSlidePrev) {
        onSelectTab(BOTTOM_NAV_ITEMS[activeIndex - 1].id);
      }
    }
  };

  return (
    <footer
      aria-label="Primary Bottom Navigation"
      onTouchStart={handleBarTouchStart}
      onTouchEnd={handleBarTouchEnd}
      className="shrink-0 z-40 w-full border-t border-slate-200/90 bg-white/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(15,23,42,0.06)] select-none overflow-hidden"
    >
      <div className="mx-auto max-w-7xl px-1.5 sm:px-6">
        <nav
          role="tablist"
          aria-label="Menu Options"
          className="grid grid-cols-5 gap-1 sm:gap-2.5 py-1.5 sm:py-2 w-full overflow-hidden"
        >
          {BOTTOM_NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={item.label}
                title={item.label}
                onClick={() => onSelectTab(item.id)}
                className={`flex h-14 sm:h-16 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {renderNavIcon(item.id, 'h-6 w-6 sm:h-7 sm:w-7 shrink-0')}
                <span className="max-w-full truncate text-[10px] sm:text-xs font-semibold leading-tight tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </footer>
  );
};


