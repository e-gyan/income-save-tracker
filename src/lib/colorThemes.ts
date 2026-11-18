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
    name: 'Emerald',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#effaf4',
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
    name: 'Sapphire',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#eff5ff',
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
    name: 'Indigo',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#f1f3ff',
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
    name: 'Teal',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#edfbf9',
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
    name: 'Violet',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#f6f2ff',
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
    name: 'Amber',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#fff9eb',
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
    name: 'Rose',
    functionLabel: '',
    uxInsight: '',
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
    canvasTintLight: '#fff2f4',
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
    id: 'fuchsia',
    name: 'Fuchsia',
    functionLabel: '',
    uxInsight: '',
    primary: '#c026d3',
    primaryHover: '#a21caf',
    darkPrimary: '#e879f9',
    darkPrimaryHover: '#d946ef',
    softBgLight: '#fdf4ff',
    softBgDark: 'rgba(217, 70, 239, 0.15)',
    softBorderLight: '#f5d0fe',
    softBorderDark: 'rgba(217, 70, 239, 0.35)',
    accentTextLight: '#a21caf',
    accentTextDark: '#f0abfc',
    canvasTintLight: '#fdf2fb',
    canvasTintDark: '#17081a',
    chartSecondary: '#d946ef',
    chartTertiary: '#e879f9',
    chartPalette: [
      '#86198f',
      '#a21caf',
      '#c026d3',
      '#d946ef',
      '#e879f9',
      '#f0abfc',
      '#db2777',
    ],
  },
  {
    id: 'slate',
    name: 'Slate',
    functionLabel: '',
    uxInsight: '',
    primary: '#334155',
    primaryHover: '#1e293b',
    darkPrimary: '#94a3b8',
    darkPrimaryHover: '#cbd5e1',
    softBgLight: '#f1f5f9',
    softBgDark: 'rgba(148, 163, 184, 0.16)',
    softBorderLight: '#cbd5e1',
    softBorderDark: 'rgba(148, 163, 184, 0.35)',
    accentTextLight: '#1e293b',
    accentTextDark: '#cbd5e1',
    canvasTintLight: '#f3f6fa',
    canvasTintDark: '#090d16',
    chartSecondary: '#475569',
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
  {
    id: 'cyan',
    name: 'Cyan',
    functionLabel: '',
    uxInsight: '',
    primary: '#0891b2',
    primaryHover: '#0e7490',
    darkPrimary: '#22d3ee',
    darkPrimaryHover: '#06b6d4',
    softBgLight: '#ecfeff',
    softBgDark: 'rgba(34, 211, 238, 0.14)',
    softBorderLight: '#a5f3fc',
    softBorderDark: 'rgba(34, 211, 238, 0.35)',
    accentTextLight: '#0e7490',
    accentTextDark: '#67e8f9',
    canvasTintLight: '#ecfeff',
    canvasTintDark: '#061519',
    chartSecondary: '#06b6d4',
    chartTertiary: '#22d3ee',
    chartPalette: [
      '#155e75',
      '#0e7490',
      '#0891b2',
      '#06b6d4',
      '#22d3ee',
      '#67e8f9',
      '#0284c7',
    ],
  },
  {
    id: 'sky',
    name: 'Sky',
    functionLabel: '',
    uxInsight: '',
    primary: '#0284c7',
    primaryHover: '#0369a1',
    darkPrimary: '#38bdf8',
    darkPrimaryHover: '#0ea5e9',
    softBgLight: '#f0f9ff',
    softBgDark: 'rgba(56, 189, 248, 0.15)',
    softBorderLight: '#bae6fd',
    softBorderDark: 'rgba(56, 189, 248, 0.35)',
    accentTextLight: '#0369a1',
    accentTextDark: '#7dd3fc',
    canvasTintLight: '#eef8ff',
    canvasTintDark: '#07131d',
    chartSecondary: '#0ea5e9',
    chartTertiary: '#38bdf8',
    chartPalette: [
      '#075985',
      '#0369a1',
      '#0284c7',
      '#0ea5e9',
      '#38bdf8',
      '#7dd3fc',
      '#2563eb',
    ],
  },
];

export function getScheduledThemeIsDark(now: Date = new Date()): boolean {
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const lightStart = 6 * 60 + 45; // 06:45 AM
  const darkStart = 18 * 60 + 45; // 06:45 PM
  return minutesOfDay < lightStart || minutesOfDay >= darkStart;
}

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
    if (
      saved === 'light' ||
      saved === 'dark' ||
      saved === 'schedule' ||
      saved === 'system'
    ) {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'schedule';
}

export function setPersistedThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

export interface AccountingFigureColorPreset {
  id: string;
  label: string;
  lightHex: string;
  darkHex: string;
}

export const ACCOUNTING_POSITIVE_COLORS: AccountingFigureColorPreset[] = [
  {
    id: 'emerald',
    label: 'Emerald',
    lightHex: '#059669',
    darkHex: '#34d399',
  },
  {
    id: 'green',
    label: 'Classic Green',
    lightHex: '#16a34a',
    darkHex: '#4ade80',
  },
  {
    id: 'forest',
    label: 'Forest Green',
    lightHex: '#15803d',
    darkHex: '#22c55e',
  },
  {
    id: 'teal',
    label: 'Teal Green',
    lightHex: '#0d9488',
    darkHex: '#2dd4bf',
  },
];

export const ACCOUNTING_NEGATIVE_COLORS: AccountingFigureColorPreset[] = [
  {
    id: 'crimson',
    label: 'Crimson Red',
    lightHex: '#e11d48',
    darkHex: '#fb7185',
  },
  {
    id: 'red',
    label: 'Accounting Red',
    lightHex: '#dc2626',
    darkHex: '#f87171',
  },
  {
    id: 'ruby',
    label: 'Deep Ruby',
    lightHex: '#b91c1c',
    darkHex: '#ef4444',
  },
  {
    id: 'coral',
    label: 'Coral Red',
    lightHex: '#ef4444',
    darkHex: '#fca5a5',
  },
];

const ACCOUNTING_FIGURES_ENABLED_KEY = 'savenknow_accounting_figures_enabled';
const POSITIVE_FIGURE_COLOR_KEY = 'savenknow_positive_figure_color';
const NEGATIVE_FIGURE_COLOR_KEY = 'savenknow_negative_figure_color';

export function getPersistedAccountingFiguresEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ACCOUNTING_FIGURES_ENABLED_KEY);
    if (raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function getPersistedPositiveFigureColor(): string {
  try {
    const raw = localStorage.getItem(POSITIVE_FIGURE_COLOR_KEY);
    if (raw && /^#[0-9A-Fa-f]{6}$/.test(raw)) return raw;
  } catch {
    // ignore
  }
  return '#059669';
}

export function getPersistedNegativeFigureColor(): string {
  try {
    const raw = localStorage.getItem(NEGATIVE_FIGURE_COLOR_KEY);
    if (raw && /^#[0-9A-Fa-f]{6}$/.test(raw)) return raw;
  } catch {
    // ignore
  }
  return '#e11d48';
}

export function applyAccountingFigureColorsToDocument(options?: {
  enabled?: boolean;
  positiveColor?: string;
  negativeColor?: string;
}): void {
  const enabled =
    options?.enabled !== undefined
      ? Boolean(options.enabled)
      : getPersistedAccountingFiguresEnabled();
  const posHex =
    options?.positiveColor && /^#[0-9A-Fa-f]{6}$/.test(options.positiveColor)
      ? options.positiveColor
      : getPersistedPositiveFigureColor();
  const negHex =
    options?.negativeColor && /^#[0-9A-Fa-f]{6}$/.test(options.negativeColor)
      ? options.negativeColor
      : getPersistedNegativeFigureColor();

  try {
    localStorage.setItem(ACCOUNTING_FIGURES_ENABLED_KEY, String(enabled));
    localStorage.setItem(POSITIVE_FIGURE_COLOR_KEY, posHex);
    localStorage.setItem(NEGATIVE_FIGURE_COLOR_KEY, negHex);
  } catch {
    // ignore storage errors
  }

  const posPreset = ACCOUNTING_POSITIVE_COLORS.find(
    (p) => p.lightHex.toLowerCase() === posHex.toLowerCase()
  );
  const negPreset = ACCOUNTING_NEGATIVE_COLORS.find(
    (n) => n.lightHex.toLowerCase() === negHex.toLowerCase()
  );

  const root = document.documentElement;
  root.setAttribute('data-accounting-figures', enabled ? 'true' : 'false');
  root.style.setProperty('--figure-positive-color', posHex);
  root.style.setProperty('--figure-negative-color', negHex);
  root.style.setProperty(
    '--figure-positive-dark-color',
    posPreset?.darkHex || posHex
  );
  root.style.setProperty(
    '--figure-negative-dark-color',
    negPreset?.darkHex || negHex
  );
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
