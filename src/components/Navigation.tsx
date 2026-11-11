import React from 'react';
import { TimeRangePreset, TIME_RANGE_OPTIONS } from '../lib/dateFilters.ts';

export type ActiveTab =
  | 'dashboard'
  | 'accounts'
  | 'income_log'
  | 'analytics'
  | 'flexible_expenses'
  | 'savings_detail'
  | 'monthly_summary'
  | 'settings'
  | 'revisions'
  | 'advisor';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange?: (tab: ActiveTab) => void;
  timeRange: TimeRangePreset;
  onSelectTimeRange: (range: TimeRangePreset) => void;
  onCleanSheet?: () => void;
  isMenuOpen?: boolean;
  onToggleMenu?: () => void;
  recordsCount?: number;
}

const TAB_LABELS: Record<string, string> = {
  dashboard: 'Overview',
  income_log: 'Income & Deductions',
  flexible_expenses: 'Expenses',
  accounts: 'Accounts',
  analytics: 'Analytics',
  revisions: 'Version Control',
  settings: 'Settings',
};

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  timeRange,
  onSelectTimeRange,
  onCleanSheet,
  isMenuOpen,
  onToggleMenu,
  recordsCount,
}) => {
  return (
    <div className="border-b border-slate-200/80 bg-slate-50/95">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2.5 px-4 py-2 sm:px-6 lg:px-8">
        {/* Left: Menu Trigger + Current Section */}
        <div className="flex items-center gap-2.5 min-w-0">
          {onToggleMenu && (
            <button
              type="button"
              onClick={onToggleMenu}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors shrink-0 ${
                isMenuOpen
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
              }`}
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                {isMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
                )}
              </svg>
              <span>Menu</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
            <span aria-hidden="true" className="text-slate-300">
              /
            </span>
            <span
              className="font-display font-semibold truncate"
              style={{ color: 'var(--app-accent-text)' }}
            >
              {TAB_LABELS[activeTab] || 'Workspace'}
            </span>
          </div>
        </div>

        {/* Right: Date Range Filter & Reset */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-200/70 p-0.5">
            {TIME_RANGE_OPTIONS.map((opt) => {
              const active = timeRange === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectTimeRange(opt.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.shortLabel}
                </button>
              );
            })}
          </div>

          {onCleanSheet && (
            <button
              type="button"
              onClick={onCleanSheet}
              className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-rose-600 transition-colors whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
