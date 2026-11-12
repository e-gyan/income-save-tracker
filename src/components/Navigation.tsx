import React from 'react';
import {
  TimeRangePreset,
  TIME_RANGE_OPTIONS,
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
    label: 'Income & Deductions',
    shortLabel: 'Income & Deductions',
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

interface NavigationProps {
  timeRange: TimeRangePreset;
  onSelectTimeRange: (range: TimeRangePreset) => void;
  isOpenOnMobile?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  timeRange,
  onSelectTimeRange,
  isOpenOnMobile = true,
}) => {
  if (!isOpenOnMobile) {
    return null;
  }

  return (
    <div className="md:hidden border-b border-slate-200/80 bg-slate-50/95">
      <div className="mx-auto max-w-7xl px-3 py-2">
        <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-slate-200/90 bg-white p-1.5">
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
    </div>
  );
};
