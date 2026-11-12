import React from 'react';
import { ActiveTab, NAV_ITEMS } from './Navigation.tsx';
import {
  TimeRangePreset,
  TIME_RANGE_OPTIONS,
  getPresetLabel,
} from '../lib/dateFilters.ts';

export const APP_VERSION = '3.5.0';

interface HeaderProps {
  activeTab?: ActiveTab;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  timeRange?: TimeRangePreset;
  onSelectTimeRange?: (range: TimeRangePreset) => void;
  isMobileDateFilterOpen?: boolean;
  onToggleMobileDateFilter?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab = 'dashboard',
  isSidebarOpen = false,
  onToggleSidebar,
  timeRange = 'all',
  onSelectTimeRange,
  isMobileDateFilterOpen = false,
  onToggleMobileDateFilter,
}) => {
  const currentNav =
    NAV_ITEMS.find((item) => item.id === activeTab) || NAV_ITEMS[0];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6 lg:px-8">
        {/* Left: App Brand & Active View Context */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white font-display font-bold text-sm shadow-xs"
            style={{ backgroundColor: 'var(--app-accent)' }}
          >
            S
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-display text-sm sm:text-base font-extrabold tracking-tight text-slate-900 truncate">
              Save N Know
            </span>
            <span className="text-slate-300 font-light">/</span>
            <span className="font-display text-xs sm:text-sm font-semibold text-slate-600 truncate">
              {currentNav.shortLabel}
            </span>
          </div>
        </div>

        {/* Right: Desktop Inline Date Filter + Mobile Date Filter Pill + Top-Right Menu Trigger */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Desktop Inline Date Filter Segmented Bar */}
          {onSelectTimeRange && (
            <div className="hidden xl:flex items-center gap-0.5 rounded-lg border border-slate-200/90 bg-slate-100/80 p-0.5">
              {TIME_RANGE_OPTIONS.map((opt) => {
                const isSelected = timeRange === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSelectTimeRange(opt.id)}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-all whitespace-nowrap ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                    }`}
                    title={`Filter by ${opt.label}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Medium Desktop Select for Date Filter (md to xl) */}
          {onSelectTimeRange && (
            <div className="hidden md:flex xl:hidden items-center">
              <select
                value={timeRange}
                onChange={(e) =>
                  onSelectTimeRange(e.target.value as TimeRangePreset)
                }
                aria-label="Date Filter"
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
              >
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mobile Compact Date Filter Trigger Button */}
          {onToggleMobileDateFilter && (
            <button
              type="button"
              onClick={onToggleMobileDateFilter}
              aria-expanded={isMobileDateFilterOpen}
              className={`md:hidden flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                timeRange !== 'all' || isMobileDateFilterOpen
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
              title="Toggle Date Filter"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.25}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <span>{getPresetLabel(timeRange)}</span>
              <svg
                className={`h-3 w-3 transition-transform ${
                  isMobileDateFilterOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          )}

          {/* Top-Right Menu Button (Bundles Navigation, Color Theme, Mode, Login & Account Details) */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Toggle Menu"
              aria-expanded={isSidebarOpen}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-1.5 text-xs font-bold transition-colors ${
                isSidebarOpen
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <span>Menu</span>
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                {isSidebarOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
