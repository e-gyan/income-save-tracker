import { AppColorTheme, ThemeMode } from '../types/finance.ts';

const COLOR_THEME_STORAGE_KEY = 'savenknow_preferred_color_theme';
const THEME_MODE_STORAGE_KEY = 'savenknow_preferred_theme_mode';

export interface ColorThemeConfig {
  id: AppColorTheme;
  name: string;
  functionLabel: string;
  uxInsight: string;
  primary: string;
  primaryHover: string;
  darkPrimary: string;
  darkPrimaryHover: string;
  softBgLight: string;
  softBgDark: string;
  softBorderLight: string;
  softBorderDark: string;
  accentTextLight: string;
  accentTextDark: string;
  canvasTintLight: string;
  canvasTintDark: string;
  chartSecondary: string;
  chartTertiary: string;
  chartPalette: string[];
}

export const APP_COLOR_THEMES: ColorThemeConfig[] = [
  {
    id: 'emerald',
    name: 'Emerald Growth',
    functionLabel: 'Savings & Compounding',
    uxInsight: 'Reinforces net retention and vault growth',
    primary: '#059669',
    primaryHover: '#047857',
    darkPrimary: '#10b981',
    darkPrimaryHover: '#059669',
    softBgLight: '#ecfdf5',
    softBgDark: 'rgba(16, 185, 129, 0.14)',
    softBorderLight: '#a7f3d0',
    softBorderDark: 'rgba(16, 185, 129, 0.35)',
    accentTextLight: '#047857',
    accentTextDark: '#34d399',
    canvasTintLight: '#f4fbf7',
    canvasTintDark: '#07120e',
    chartSecondary: '#10b981',
    chartTertiary: '#34d399',
    chartPalette: [
      '#065f46',
      '#047857',
      '#059669',
      '#10b981',
      '#34d399',
      '#6ee7b7',
      '#0d9488',
    ],
  },
  {
    id: 'sapphire',
    name: 'Sapphire Trust',
    functionLabel: 'Treasury & Banking',
    uxInsight: 'Enhances focus and account clarity',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    darkPrimary: '#3b82f6',
    darkPrimaryHover: '#2563eb',
    softBgLight: '#eff6ff',
    softBgDark: 'rgba(59, 130, 246, 0.15)',
    softBorderLight: '#bfdbfe',
    softBorderDark: 'rgba(59, 130, 246, 0.35)',
    accentTextLight: '#1d4ed8',
    accentTextDark: '#60a5fa',
    canvasTintLight: '#f5f8ff',
    canvasTintDark: '#080e1a',
    chartSecondary: '#3b82f6',
    chartTertiary: '#60a5fa',
    chartPalette: [
      '#1e40af',
      '#1d4ed8',
      '#2563eb',
      '#3b82f6',
      '#60a5fa',
      '#93c5fd',
      '#0284c7',
    ],
  },
  {
    id: 'indigo',
    name: 'Indigo Strategy',
    functionLabel: 'Allocation & Routing',
    uxInsight: 'Supports structured multi-pillar splits',
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    darkPrimary: '#6366f1',
    darkPrimaryHover: '#4f46e5',
    softBgLight: '#eef2ff',
    softBgDark: 'rgba(99, 102, 241, 0.15)',
    softBorderLight: '#c7d2fe',
    softBorderDark: 'rgba(99, 102, 241, 0.35)',
    accentTextLight: '#4338ca',
    accentTextDark: '#818cf8',
    canvasTintLight: '#f6f7ff',
    canvasTintDark: '#0b0c1a',
    chartSecondary: '#6366f1',
    chartTertiary: '#818cf8',
    chartPalette: [
      '#3730a3',
      '#4338ca',
      '#4f46e5',
      '#6366f1',
      '#818cf8',
      '#a5b4fc',
      '#7c3aed',
    ],
  },
  {
    id: 'teal',
    name: 'Teal Liquidity',
    functionLabel: 'Cash Flow Balance',
    uxInsight: 'Balances operating inflows and outflows',
    primary: '#0d9488',
    primaryHover: '#0f766e',
    darkPrimary: '#14b8a6',
    darkPrimaryHover: '#0d9488',
    softBgLight: '#f0fdfa',
    softBgDark: 'rgba(20, 184, 166, 0.14)',
    softBorderLight: '#99f6e4',
    softBorderDark: 'rgba(20, 184, 166, 0.35)',
    accentTextLight: '#0f766e',
    accentTextDark: '#2dd4bf',
    canvasTintLight: '#f3fbfa',
    canvasTintDark: '#071313',
    chartSecondary: '#14b8a6',
    chartTertiary: '#2dd4bf',
    chartPalette: [
      '#115e59',
      '#0f766e',
      '#0d9488',
      '#14b8a6',
      '#2dd4bf',
      '#5eead4',
      '#0891b2',
    ],
  },
  {
    id: 'violet',
    name: 'Violet Stewardship',
    functionLabel: 'Endowment & Vision',
    uxInsight: 'Encourages long-term capital discipline',
    primary: '#7c3aed',
    primaryHover: '#6d28d9',
    darkPrimary: '#8b5cf6',
    darkPrimaryHover: '#7c3aed',
    softBgLight: '#f5f3ff',
    softBgDark: 'rgba(139, 92, 246, 0.15)',
    softBorderLight: '#ddd6fe',
    softBorderDark: 'rgba(139, 92, 246, 0.35)',
    accentTextLight: '#6d28d9',
    accentTextDark: '#a78bfa',
    canvasTintLight: '#f9f7ff',
    canvasTintDark: '#0e0a1a',
    chartSecondary: '#8b5cf6',
    chartTertiary: '#a78bfa',
    chartPalette: [
      '#5b21b6',
      '#6d28d9',
      '#7c3aed',
      '#8b5cf6',
      '#a78bfa',
      '#c4b5fd',
      '#9333ea',
    ],
  },
  {
    id: 'amber',
    name: 'Amber Capital',
    functionLabel: 'Seed & Enterprise',
    uxInsight: 'Highlights revenue velocity and seed funds',
    primary: '#d97706',
    primaryHover: '#b45309',
    darkPrimary: '#f59e0b',
    darkPrimaryHover: '#d97706',
    softBgLight: '#fffbeb',
    softBgDark: 'rgba(245, 158, 11, 0.14)',
    softBorderLight: '#fde68a',
    softBorderDark: 'rgba(245, 158, 11, 0.35)',
    accentTextLight: '#b45309',
    accentTextDark: '#fbbf24',
    canvasTintLight: '#fffcf5',
    canvasTintDark: '#141007',
    chartSecondary: '#f59e0b',
    chartTertiary: '#fbbf24',
    chartPalette: [
      '#92400e',
      '#b45309',
      '#d97706',
      '#f59e0b',
      '#fbbf24',
      '#fcd34d',
      '#ea580c',
    ],
  },
  {
    id: 'rose',
    name: 'Crimson Vigilance',
    functionLabel: 'Expense Control',
    uxInsight: 'Sharpens focus on expenses and outflow limits',
    primary: '#e11d48',
    primaryHover: '#be123c',
    darkPrimary: '#f43f5e',
    darkPrimaryHover: '#e11d48',
    softBgLight: '#fff1f2',
    softBgDark: 'rgba(244, 63, 94, 0.15)',
    softBorderLight: '#fecdd3',
    softBorderDark: 'rgba(244, 63, 94, 0.35)',
    accentTextLight: '#be123c',
    accentTextDark: '#fb7185',
    canvasTintLight: '#fff7f8',
    canvasTintDark: '#16090d',
    chartSecondary: '#f43f5e',
    chartTertiary: '#fb7185',
    chartPalette: [
      '#9f1239',
      '#be123c',
      '#e11d48',
      '#f43f5e',
      '#fb7185',
      '#fda4af',
      '#db2777',
    ],
  },
  {
    id: 'slate',
    name: 'Obsidian Ledger',
    functionLabel: 'Executive Minimalist',
    uxInsight: 'High-contrast distraction-free accounting',
    primary: '#0f172a',
    primaryHover: '#1e293b',
    darkPrimary: '#38bdf8',
    darkPrimaryHover: '#0284c7',
    softBgLight: '#f1f5f9',
    softBgDark: 'rgba(56, 189, 248, 0.14)',
    softBorderLight: '#cbd5e1',
    softBorderDark: 'rgba(56, 189, 248, 0.35)',
    accentTextLight: '#0f172a',
    accentTextDark: '#38bdf8',
    canvasTintLight: '#f8fafc',
    canvasTintDark: '#090d16',
    chartSecondary: '#334155',
    chartTertiary: '#64748b',
    chartPalette: [
      '#0f172a',
      '#1e293b',
      '#334155',
      '#475569',
      '#64748b',
      '#94a3b8',
      '#0284c7',
    ],
  },
];

export function getPersistedColorTheme(): AppColorTheme {
  try {
    const saved = localStorage.getItem(COLOR_THEME_STORAGE_KEY) as AppColorTheme | null;
    if (saved && APP_COLOR_THEMES.some((t) => t.id === saved)) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'emerald';
}

export function setPersistedColorTheme(themeId: AppColorTheme): void {
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, themeId);
  } catch {
    // ignore storage errors
  }
}

export function getPersistedThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY) as ThemeMode | null;
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function setPersistedThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

export function getColorThemeConfig(themeId?: AppColorTheme): ColorThemeConfig {
  const effectiveId = themeId || getPersistedColorTheme();
  return (
    APP_COLOR_THEMES.find((t) => t.id === effectiveId) || APP_COLOR_THEMES[0]
  );
}

export function applyColorThemeToDocument(
  themeId?: AppColorTheme,
  isDark = false
): void {
  const cfg = getColorThemeConfig(themeId);
  setPersistedColorTheme(cfg.id);
  const root = document.documentElement;

  const activePrimary = isDark ? cfg.darkPrimary : cfg.primary;
  const activeHover = isDark ? cfg.darkPrimaryHover : cfg.primaryHover;
  const activeSoftBg = isDark ? cfg.softBgDark : cfg.softBgLight;
  const activeSoftBorder = isDark ? cfg.softBorderDark : cfg.softBorderLight;
  const activeText = isDark ? cfg.accentTextDark : cfg.accentTextLight;
  const activeCanvas = isDark ? cfg.canvasTintDark : cfg.canvasTintLight;

  root.setAttribute('data-color-theme', cfg.id);
  root.style.setProperty('--app-accent', activePrimary);
  root.style.setProperty('--app-accent-hover', activeHover);
  root.style.setProperty('--app-accent-soft', activeSoftBg);
  root.style.setProperty('--app-accent-border', activeSoftBorder);
  root.style.setProperty('--app-accent-text', activeText);
  root.style.setProperty('--app-canvas-tint', activeCanvas);
  root.style.setProperty('--app-chart-secondary', cfg.chartSecondary);
  root.style.setProperty('--app-chart-tertiary', cfg.chartTertiary);
}
