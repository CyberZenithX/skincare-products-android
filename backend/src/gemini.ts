import { GoogleGenAI, ThinkingLevel, type Part, type ThinkingConfig } from '@google/genai';
import { z } from '@skinfix/shared';
import type { Env } from './env';

// Keys Gemini's responseJsonSchema accepts (from the @google/genai docs).
const ALLOWED = new Set([
  '$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum', 'items',
  'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf', 'properties',
  'additionalProperties', 'required', 'propertyOrdering',
]);

/** zod schema → the JSON Schema subset Gemini supports. zod still does the real validation. */
export function toGeminiSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' });
  return clean(json);
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'const') {
      out.enum = [v];
      continue;
    }
    if (!ALLOWED.has(k)) continue;
    if (k === 'properties' || k === '$defs') {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, clean(pv)]));
      // Keep the zod field order: it's the order the model writes them in.
      if (k === 'properties') out.propertyOrdering = Object.keys(v as object);
    } else if (k === 'minimum' || k === 'maximum') {
      // zod writes ±MAX_SAFE_INTEGER for plain ints; leave those out.
      if (Math.abs(v as number) < 1e12) out[k] = v;
    } else {
      out[k] = clean(v);
    }
  }
  return out;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid_output' | 'upstream' | 'timeout',
    /** Gemini's HTTP status, when it answered with an error. */
    readonly status?: number,
    /** Gemini's error text or the validation problem. Never contains the photo or prompt. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Safe-to-log summary of an error (no request data). */
export function describeAiError(e: AiError) {
  return { kind: e.kind, status: e.status ?? null, detail: e.detail ?? e.message };
}

export type Thinking = 'minimal' | 'low' | 'medium' | 'high' | 'default';
const THINKING: readonly Thinking[] = ['minimal', 'low', 'medium', 'high', 'default'];

/** The thinking level from GEMINI_THINKING, or 'low'. */
export function envThinking(env: Env): Thinking {
  const v = (env.GEMINI_THINKING ?? '').trim().toLowerCase();
  return (THINKING as readonly string[]).includes(v) ? (v as Thinking) : 'low';
}

/**
 * Gemini 3+ models take a thinking level; 2.x models take a token budget.
 * 'default' sends nothing and lets the model decide (slowest on Gemini 3).
 */
export function thinkingConfig(model: string, level: Thinking): ThinkingConfig | undefined {
  if (level === 'default') return undefined;
  if (/^gemini-2/.test(model)) {
    const budget = { minimal: 0, low: 1024, medium: 4096, high: -1 }[level];
    return { thinkingBudget: /pro/.test(model) && budget === 0 ? 128 : budget }; // 2.x Pro can't turn thinking off
  }
  return { thinkingLevel: { minimal: ThinkingLevel.MINIMAL, low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH }[level] };
}

/**
 * One raw generateContent call with our standard config. Returns the response
 * text or throws AiError carrying Gemini's status and error message.
 */
export async function callGemini(
  env: Env,
  opts: { system?: string; parts: Part[]; responseJsonSchema?: unknown; temperature?: number; timeoutMs?: number; thinking?: Thinking },
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  try {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: 'user', parts: opts.parts }],
      config: {
        ...(opts.system ? { systemInstruction: opts.system } : {}),
        ...(opts.responseJsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: opts.responseJsonSchema } : {}),
        temperature: opts.temperature ?? Number(env.GEMINI_TEMPERATURE ?? '0.2'),
        seed: 7,
        ...(() => {
          const t = thinkingConfig(env.GEMINI_MODEL, opts.thinking ?? envThinking(env));
          return t ? { thinkingConfig: t } : {};
        })(),
        abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      },
    });
    const text = res.text;
    if (!text) {
      // Blocked by safety filters, or the model stopped early: say why.
      const c = res.candidates?.[0];
      const reason = res.promptFeedback?.blockReason ?? c?.finishReason ?? 'empty response';
      throw new AiError('Gemini returned no text', 'upstream', undefined, `no text (${reason})`);
    }
    return text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    const name = (e as Error)?.name ?? '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('Gemini timed out', 'timeout', undefined, `no answer within ${opts.timeoutMs ?? 25_000} ms`);
    const status = (e as { status?: number })?.status;
    // Gemini's error message describes what it rejected (key, model, schema...), not our data.
    const detail = String((e as Error)?.message ?? e).slice(0, 500);
    throw new AiError(`Gemini call failed (${status ?? 'network'})`, 'upstream', status, detail);
  }
}

export interface JsonCall<T> {
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  /** Extra checks zod can't express. Return a problem description, or null when fine. */
  check?: (value: T) => string | null;
  timeoutMs?: number;
  temperature?: number;
  /** Thinking level for this call (default: GEMINI_THINKING, else low). */
  thinking?: Thinking;
  /**
   * Absolute time (Date.now() ms) the whole call, retry included, must finish by.
   * Keeps the request inside Vercel's function time limit.
   */
  deadline?: number;
}

/**
 * One structured-output call. Validates against zod (+ check); on failure retries
 * ONCE with the problem fed back, then throws. Never logs prompts or images.
 */
export async function generateJson<T>(env: Env, call: JsonCall<T>): Promise<T> {
  const responseJsonSchema = toGeminiSchema(call.schema);
  let feedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const parts: Part[] = feedback
      ? [...call.parts, { text: `Your previous answer was rejected: ${feedback}. Return corrected JSON only.` }]
      : call.parts;
    let timeoutMs = call.timeoutMs ?? 25_000;
    if (call.deadline) {
      const left = call.deadline - Date.now();
      // Not enough time for a useful attempt: report it as a timeout, not a bad answer.
      if (left < 5_000) throw new AiError('Gemini timed out', 'timeout', undefined, 'no time left for another attempt');
      timeoutMs = Math.min(timeoutMs, left);
    }
    const text = await callGemini(env, {
      system: call.system,
      parts,
      responseJsonSchema,
      temperature: call.temperature,
      timeoutMs,
      thinking: call.thinking,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text ?? '');
    } catch {
      feedback = 'it was not valid JSON';
      continue;
    }
    const result = call.schema.safeParse(parsed);
    if (!result.success) {
      feedback = z.prettifyError(result.error).slice(0, 800);
      continue;
    }
    const problem = call.check?.(result.data) ?? null;
    if (problem) {
      feedback = problem;
      continue;
    }
    return result.data;
  }
  throw new AiError('Gemini output failed validation twice', 'invalid_output', undefined, feedback?.slice(0, 500));
}

export const imagePart = (base64: string): Part => ({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
