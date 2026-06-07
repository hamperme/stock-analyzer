import {
  normalizeAiProvider,
  type AppAiProvider,
} from "./app-settings";

export interface AiProviderStatus {
  id: AppAiProvider;
  label: string;
  envVar: string;
  model: string;
  available: boolean;
}

const AI_PROVIDER_LABELS: Record<AppAiProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
};

const AI_PROVIDER_ENV_VARS: Record<AppAiProvider, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function getAiProviderLabel(provider: AppAiProvider): string {
  return AI_PROVIDER_LABELS[provider];
}

export function getAiProviderModel(provider: AppAiProvider): string {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_MODEL || "gemini-2.5-flash";
    case "openai":
      return process.env.OPENAI_MODEL || "gpt-4.1-mini";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  }
}

export function getAiProviderApiKey(provider: AppAiProvider): string | null {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY || null;
    case "openai":
      return process.env.OPENAI_API_KEY || null;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || null;
  }
}

export function getAiProviderStatuses(): Record<AppAiProvider, AiProviderStatus> {
  return {
    gemini: {
      id: "gemini",
      label: AI_PROVIDER_LABELS.gemini,
      envVar: AI_PROVIDER_ENV_VARS.gemini,
      model: getAiProviderModel("gemini"),
      available: !!getAiProviderApiKey("gemini"),
    },
    openai: {
      id: "openai",
      label: AI_PROVIDER_LABELS.openai,
      envVar: AI_PROVIDER_ENV_VARS.openai,
      model: getAiProviderModel("openai"),
      available: !!getAiProviderApiKey("openai"),
    },
    anthropic: {
      id: "anthropic",
      label: AI_PROVIDER_LABELS.anthropic,
      envVar: AI_PROVIDER_ENV_VARS.anthropic,
      model: getAiProviderModel("anthropic"),
      available: !!getAiProviderApiKey("anthropic"),
    },
  };
}

export function getAvailableAiProviders(): AppAiProvider[] {
  const statuses = getAiProviderStatuses();
  return (Object.keys(statuses) as AppAiProvider[]).filter((provider) => statuses[provider].available);
}

export function resolveAiProvider(requested?: string | null): {
  provider: AppAiProvider;
  availableProviders: AppAiProvider[];
  status: AiProviderStatus;
} {
  const availableProviders = getAvailableAiProviders();
  const provider = availableProviders.length > 0
    ? normalizeAiProvider(requested, availableProviders)
    : normalizeAiProvider(requested);
  const statuses = getAiProviderStatuses();

  return {
    provider,
    availableProviders,
    status: statuses[provider],
  };
}
