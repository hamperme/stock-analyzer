"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DASHBOARD_MARKET_OPTIONS,
  DEFAULT_LOCALE,
  DEFAULT_DASHBOARD_MARKET,
  DEFAULT_THEME,
  LOCALE_COOKIE,
  MARKET_COOKIE,
  SETTINGS_COOKIE_MAX_AGE,
  THEME_COOKIE,
  normalizeDashboardMarket,
  normalizeLocale,
  normalizeTheme,
  type AppLocale,
  type AppTheme,
  type DashboardMarket,
} from "@/lib/app-settings";
import { getDictionary, type AppDictionary } from "@/lib/i18n";

interface SettingsContextValue {
  locale: AppLocale;
  theme: AppTheme;
  market: DashboardMarket;
  dict: AppDictionary;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: AppTheme) => void;
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
  initialMarket = DEFAULT_DASHBOARD_MARKET,
  children,
}: {
  initialLocale?: AppLocale;
  initialTheme?: AppTheme;
  initialMarket?: DashboardMarket;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(normalizeLocale(initialLocale));
  const [theme, setThemeState] = useState<AppTheme>(normalizeTheme(initialTheme));
  const [market, setMarketState] = useState<DashboardMarket>(normalizeDashboardMarket(initialMarket));

  useEffect(() => {
    applyHtmlSettings(locale, theme);
    persistCookie(LOCALE_COOKIE, locale);
    persistCookie(THEME_COOKIE, theme);
    persistCookie(MARKET_COOKIE, market);
    window.localStorage.setItem(LOCALE_COOKIE, locale);
    window.localStorage.setItem(THEME_COOKIE, theme);
    window.localStorage.setItem(MARKET_COOKIE, market);
  }, [locale, theme, market]);

  const value: SettingsContextValue = {
    locale,
    theme,
    market,
    dict: getDictionary(locale),
    setLocale: (nextLocale) => setLocaleState(normalizeLocale(nextLocale)),
    setTheme: (nextTheme) => setThemeState(normalizeTheme(nextTheme)),
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
