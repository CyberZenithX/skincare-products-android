import { storeFromEnv, type Store } from './store';

export interface Env {
  /** Secret (Vercel env var, "Sensitive"): Gemini API key. */
  GEMINI_API_KEY: string;
  /** Secret (Vercel env var, "Sensitive"): invite code friends and family type in. */
  INVITE_CODE: string;
  /** Gemini model name, e.g. gemini-3.8-flash. */
  GEMINI_MODEL: string;
  /** "1" serves /backend/mocks instead of calling Gemini or noon. */
  MOCK?: string;
  /** Sampling temperature for the analysis calls (default 0.2). */
  GEMINI_TEMPERATURE?: string;
  /** How much the model thinks before answering: minimal | low | medium | high | default (default: low). */
  GEMINI_THINKING?: string;
  /** Scans per device per day (default 20). */
  SCANS_PER_DAY?: string;
  /** Listing cache, rate-limit counters, layer counters. */
  store: Store;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';

export function envFromProcess(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    GEMINI_API_KEY: e.GEMINI_API_KEY ?? '',
    INVITE_CODE: e.INVITE_CODE ?? '',
    GEMINI_MODEL: e.GEMINI_MODEL || DEFAULT_MODEL,
    MOCK: e.MOCK,
    GEMINI_TEMPERATURE: e.GEMINI_TEMPERATURE,
    GEMINI_THINKING: e.GEMINI_THINKING,
    SCANS_PER_DAY: e.SCANS_PER_DAY,
    store: storeFromEnv(e),
  };
}
