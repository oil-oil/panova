// Central AI configuration and helpers (server-side usage)

export const APP_TITLE = "Panova";
export const DEFAULT_MODEL = "google/gemini-2.5-pro";

// Server-side only: read OpenRouter API key from env
export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || !key.trim()) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }
  return key.trim();
}

