"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AI_PROVIDER_COOKIE,
  AI_PROVIDER_OPTIONS,
  DASHBOARD_MARKET_OPTIONS,
  DEFAULT_LOCALE,
  DEFAULT_DASHBOARD_MARKET,
  DEFAULT_THEME,
  LOCALE_COOKIE,
  MARKET_COOKIE,
  SETTINGS_COOKIE_MAX_AGE,
  THEME_COOKIE,
  normalizeAiProvider,
  normalizeDashboardMarket,
  normalizeLocale,
  normalizeTheme,
  type AppAiProvider,
  type AppLocale,
  type AppTheme,
  type DashboardMarket,
} from "@/lib/app-settings";
import { getDictionary, type AppDictionary } from "@/lib/i18n";

interface SettingsContextValue {
  locale: AppLocale;
  theme: AppTheme;
  aiProvider: AppAiProvider;
  market: DashboardMarket;
  availableAiProviders: readonly AppAiProvider[];
  dict: AppDictionary;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: AppTheme) => void;
  setAiProvider: (provider: AppAiProvider) => void;
  setMarket: (market: DashboardMarket) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function persistCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${SETTINGS_COOKIE_MAX_AGE}; samesite=lax`;
}

function applyHtmlSettings(locale: AppLocale, theme: AppTheme) {
  document.documentElement.lang = locale;
  document.documentElement.classList.remove("dark", "light");
  document.documentElement.classList.add(theme);
}

export function SettingsProvider({
  initialLocale = DEFAULT_LOCALE,
  initialTheme = DEFAULT_THEME,
  initialAiProvider = "gemini",
  initialMarket = DEFAULT_DASHBOARD_MARKET,
  initialAvailableAiProviders = AI_PROVIDER_OPTIONS,
  children,
}: {
  initialLocale?: AppLocale;
  initialTheme?: AppTheme;
  initialAiProvider?: AppAiProvider;
  initialMarket?: DashboardMarket;
  initialAvailableAiProviders?: readonly AppAiProvider[];
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(normalizeLocale(initialLocale));
  const [theme, setThemeState] = useState<AppTheme>(normalizeTheme(initialTheme));
  const [aiProvider, setAiProviderState] = useState<AppAiProvider>(
    normalizeAiProvider(
      initialAiProvider,
      initialAvailableAiProviders.length > 0 ? initialAvailableAiProviders : AI_PROVIDER_OPTIONS
    )
  );
  const [market, setMarketState] = useState<DashboardMarket>(normalizeDashboardMarket(initialMarket));

  useEffect(() => {
    applyHtmlSettings(locale, theme);
    persistCookie(LOCALE_COOKIE, locale);
    persistCookie(THEME_COOKIE, theme);
    persistCookie(AI_PROVIDER_COOKIE, aiProvider);
    persistCookie(MARKET_COOKIE, market);
    window.localStorage.setItem(LOCALE_COOKIE, locale);
    window.localStorage.setItem(THEME_COOKIE, theme);
    window.localStorage.setItem(AI_PROVIDER_COOKIE, aiProvider);
    window.localStorage.setItem(MARKET_COOKIE, market);
  }, [locale, theme, aiProvider, market]);

  const value: SettingsContextValue = {
    locale,
    theme,
    aiProvider,
    market,
    availableAiProviders: initialAvailableAiProviders,
    dict: getDictionary(locale),
    setLocale: (nextLocale) => setLocaleState(normalizeLocale(nextLocale)),
    setTheme: (nextTheme) => setThemeState(normalizeTheme(nextTheme)),
    setAiProvider: (nextProvider) => setAiProviderState(
      normalizeAiProvider(
        nextProvider,
        initialAvailableAiProviders.length > 0 ? initialAvailableAiProviders : AI_PROVIDER_OPTIONS
      )
    ),
    setMarket: (nextMarket) => setMarketState(
      DASHBOARD_MARKET_OPTIONS.includes(nextMarket)
        ? nextMarket
        : DEFAULT_DASHBOARD_MARKET
    ),
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
