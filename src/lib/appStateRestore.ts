/**
 * App Session, Navigation History & Workflow State Restoration Manager
 * Preserves the user's active tab, date filter, scroll position per view,
 * and active workflow sessions (Drive alignment & Settings import) across
 * Back/Forward navigation, tab switches, reloads, and PWA resume.
 */

import { TimeRangePreset } from './dateFilters.ts';
import type { ActiveTab } from '../components/Navigation.tsx';

export type RestorableTab = ActiveTab;

export interface RestorableNavigationState {
  activeTab: RestorableTab;
  timeRange: TimeRangePreset;
  isDriveAlignmentOpen?: boolean;
  scrollByTab?: Partial<Record<RestorableTab, number>>;
  updatedAt: number;
}

export interface BrowserHistoryNavSnapshot {
  __savenknowNav: true;
  activeTab: RestorableTab;
  timeRange: TimeRangePreset;
  isDriveAlignmentOpen?: boolean;
}

const NAV_STATE_PREFIX = 'savenknow_nav_state_v1_';
const WORKFLOW_STATE_PREFIX = 'savenknow_workflow_state_v1_';

const VALID_TABS: Set<string> = new Set([
  'dashboard',
  'income_log',
  'flexible_expenses',
  'budgets',
  'accounts',
  'analytics',
  'settings',
]);

const VALID_RANGES: Set<string> = new Set([
  'all',
  '7d',
  'this_month',
  '31d',
  'last_month',
  'this_year',
  '365d',
  'last_year',
  '1d',
  '14d',
  '1m',
  '3m',
  '1y',
]);

function getNavKey(userId: string): string {
  return `${NAV_STATE_PREFIX}${userId || 'guest_user'}`;
}

function getWorkflowKey(scope: string, userId: string): string {
  return `${WORKFLOW_STATE_PREFIX}${scope}_${userId || 'guest_user'}`;
}

export function isValidRestorableTab(tab: unknown): tab is RestorableTab {
  return typeof tab === 'string' && VALID_TABS.has(tab);
}

export function isValidTimeRange(range: unknown): range is TimeRangePreset {
  return typeof range === 'string' && VALID_RANGES.has(range);
}

export function buildHistoryStateSnapshot(
  activeTab: RestorableTab,
  timeRange: TimeRangePreset,
  isDriveAlignmentOpen = false
): BrowserHistoryNavSnapshot {
  return {
    __savenknowNav: true,
    activeTab,
    timeRange,
    isDriveAlignmentOpen: Boolean(isDriveAlignmentOpen),
  };
}

export function parseHistoryStateSnapshot(
  state: unknown
): BrowserHistoryNavSnapshot | null {
  if (!state || typeof state !== 'object') return null;
  const candidate = state as Partial<BrowserHistoryNavSnapshot>;
  if (!candidate.__savenknowNav || !isValidRestorableTab(candidate.activeTab)) {
    return null;
  }
  return {
    __savenknowNav: true,
    activeTab: candidate.activeTab,
    timeRange: isValidTimeRange(candidate.timeRange)
      ? candidate.timeRange
      : 'all',
    isDriveAlignmentOpen: Boolean(candidate.isDriveAlignmentOpen),
  };
}

export function loadPersistedNavigationState(
  userId: string
): RestorableNavigationState | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getNavKey(userId);
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RestorableNavigationState>;
    if (!parsed || !isValidRestorableTab(parsed.activeTab)) {
      return null;
    }
    const timeRange: TimeRangePreset = isValidTimeRange(parsed.timeRange)
      ? parsed.timeRange
      : 'all';
    return {
      activeTab: parsed.activeTab,
      timeRange,
      isDriveAlignmentOpen: Boolean(parsed.isDriveAlignmentOpen),
      scrollByTab: parsed.scrollByTab || {},
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePersistedNavigationState(
  userId: string,
  state: RestorableNavigationState
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getNavKey(userId);
    const serialized = JSON.stringify(state);
    sessionStorage.setItem(key, serialized);
    localStorage.setItem(key, serialized);
  } catch {
    // Ignore quota or storage restriction errors
  }
}

export function loadWorkflowState<T>(
  scope: string,
  userId: string
): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getWorkflowKey(scope, userId);
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveWorkflowState<T>(
  scope: string,
  userId: string,
  value: T
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getWorkflowKey(scope, userId);
    const serialized = JSON.stringify(value);
    // Guard against exceeding browser storage limits for very large workbooks
    if (serialized.length > 2_500_000) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, serialized);
    localStorage.setItem(key, serialized);
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function clearWorkflowState(scope: string, userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getWorkflowKey(scope, userId);
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}
