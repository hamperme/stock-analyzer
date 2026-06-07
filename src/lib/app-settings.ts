export type AppTheme = "dark" | "light";
export type AppLocale = "en" | "zh";
export type AppAiProvider = "gemini" | "openai" | "anthropic";
export type DashboardMarket = "us" | "japan" | "europe" | "china" | "canada";

export const THEME_COOKIE = "stockpulse_theme";
export const LOCALE_COOKIE = "stockpulse_locale";
export const AI_PROVIDER_COOKIE = "stockpulse_ai_provider";
export const MARKET_COOKIE = "stockpulse_market";
export const SETTINGS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const AI_PROVIDER_OPTIONS = ["gemini", "openai", "anthropic"] as const;
export const DASHBOARD_MARKET_OPTIONS = ["us", "japan", "europe", "china", "canada"] as const;

export const DEFAULT_THEME: AppTheme = "dark";
export const DEFAULT_LOCALE: AppLocale = "en";
export const DEFAULT_AI_PROVIDER: AppAiProvider = "gemini";
export const DEFAULT_DASHBOARD_MARKET: DashboardMarket = "us";

export function normalizeTheme(value?: string | null): AppTheme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function normalizeLocale(value?: string | null): AppLocale {
  return value === "zh" ? "zh" : DEFAULT_LOCALE;
}

export function normalizeAiProvider(
  value?: string | null,
  allowedProviders: readonly AppAiProvider[] = AI_PROVIDER_OPTIONS
): AppAiProvider {
  if (value && allowedProviders.includes(value as AppAiProvider)) {
    return value as AppAiProvider;
  }
  return allowedProviders[0] ?? DEFAULT_AI_PROVIDER;
}

export function normalizeDashboardMarket(value?: string | null): DashboardMarket {
  if (value && DASHBOARD_MARKET_OPTIONS.includes(value as DashboardMarket)) {
    return value as DashboardMarket;
  }
  return DEFAULT_DASHBOARD_MARKET;
}

export function readAppSettings(cookieStore: {
  get(name: string): { value: string } | undefined;
}, allowedProviders: readonly AppAiProvider[] = AI_PROVIDER_OPTIONS): {
  theme: AppTheme;
  locale: AppLocale;
  aiProvider: AppAiProvider;
  market: DashboardMarket;
} {
  return {
    theme: normalizeTheme(cookieStore.get(THEME_COOKIE)?.value),
    locale: normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value),
    aiProvider: normalizeAiProvider(cookieStore.get(AI_PROVIDER_COOKIE)?.value, allowedProviders),
    market: normalizeDashboardMarket(cookieStore.get(MARKET_COOKIE)?.value),
  };
}
