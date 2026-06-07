"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { Bot, Languages, MonitorCog, Moon, Settings2, Sparkles, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/components/app/SettingsProvider";
import type { AppAiProvider, AppLocale, AppTheme } from "@/lib/app-settings";

function OptionButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-surface-border bg-surface text-neutral hover:bg-surface-elevated hover:text-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function SettingsButton() {
  const router = useRouter();
  const {
    dict,
    locale,
    theme,
    aiProvider,
    availableAiProviders,
    setLocale,
    setTheme,
    setAiProvider,
  } = useSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const changeLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;
    setLocale(nextLocale);
    setOpen(false);
    startTransition(() => {
      router.refresh();
    });
  };

  const changeTheme = (nextTheme: AppTheme) => {
    if (nextTheme === theme) return;
    setTheme(nextTheme);
    setOpen(false);
  };

  const changeAiProvider = (nextProvider: AppAiProvider) => {
    if (nextProvider === aiProvider) return;
    setAiProvider(nextProvider);
    setOpen(false);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-neutral transition-colors hover:bg-surface-elevated hover:text-slate-200"
        aria-expanded={open}
        aria-label={dict.settings.button}
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{dict.settings.button}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-80 rounded-xl border border-surface-border bg-surface p-4 shadow-2xl">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral">
              {dict.settings.appearance}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <OptionButton
                active={theme === "dark"}
                icon={<Moon className="h-4 w-4" />}
                label={dict.settings.dark}
                onClick={() => changeTheme("dark")}
              />
              <OptionButton
                active={theme === "light"}
                icon={<Sun className="h-4 w-4" />}
                label={dict.settings.light}
                onClick={() => changeTheme("light")}
              />
            </div>
          </div>

          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral">
              {dict.settings.language}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <OptionButton
                active={locale === "en"}
                icon={<Languages className="h-4 w-4" />}
                label={dict.settings.english}
                onClick={() => changeLocale("en")}
              />
              <OptionButton
                active={locale === "zh"}
                icon={<MonitorCog className="h-4 w-4" />}
                label={dict.settings.chinese}
                onClick={() => changeLocale("zh")}
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral">
              {dict.settings.aiProvider}
            </p>
            {availableAiProviders.length > 0 ? (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {availableAiProviders.map((provider) => (
                  <OptionButton
                    key={provider}
                    active={aiProvider === provider}
                    icon={provider === "gemini"
                      ? <Sparkles className="h-4 w-4" />
                      : provider === "openai"
                      ? <Bot className="h-4 w-4" />
                      : <Bot className="h-4 w-4" />}
                    label={dict.settings.providers[provider]}
                    onClick={() => changeAiProvider(provider)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-neutral/70">
                {dict.settings.noAiProviders}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
