export interface Env {
  /** Secret: wrangler secret put GEMINI_API_KEY */
  GEMINI_API_KEY: string;
  /** Secret: wrangler secret put INVITE_CODE */
  INVITE_CODE: string;
  /** Var: Gemini model name, e.g. gemini-3.8-flash */
  GEMINI_MODEL: string;
  /** Var: "1" serves /worker/mocks instead of calling Gemini or noon. */
  MOCK?: string;
  /** Var: sampling temperature for the analysis calls (default 0.2). */
  GEMINI_TEMPERATURE?: string;
  /** Var: scans per device per day (default 20). */
  SCANS_PER_DAY?: string;
  /** KV: listing cache, rate-limit counters, layer counters. */
  KV: KVNamespace;
}
