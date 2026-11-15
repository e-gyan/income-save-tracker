import React, { useRef } from 'react';
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
    </div>
  );
};

export const BOTTOM_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter(
  (item) => item.id !== 'settings'
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

  const activeIndex = NAV_ITEMS.findIndex((item) => item.id === activeTab);
  const canSlidePrev = activeIndex > 0;
  const canSlideNext = activeIndex >= 0 && activeIndex < NAV_ITEMS.length - 1;

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
        onSelectTab(NAV_ITEMS[activeIndex + 1].id);
      } else if (dx > 0 && canSlidePrev) {
        onSelectTab(NAV_ITEMS[activeIndex - 1].id);
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
      <div className="mx-auto max-w-7xl px-2 sm:px-6">
        <nav
          role="tablist"
          aria-label="Menu Options"
          className="grid grid-cols-6 gap-1.5 sm:gap-3 py-1.5 sm:py-2 w-full overflow-hidden"
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
                className={`flex h-12 sm:h-14 w-full items-center justify-center rounded-xl transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {renderNavIcon(item.id, 'h-7 w-7 sm:h-8 sm:w-8 shrink-0')}
              </button>
            );
          })}
        </nav>
      </div>
    </footer>
  );
};


