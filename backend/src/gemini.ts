import { GoogleGenAI, type Part } from '@google/genai';
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

/**
 * One raw generateContent call with our standard config. Returns the response
 * text or throws AiError carrying Gemini's status and error message.
 */
export async function callGemini(
  env: Env,
  opts: { system?: string; parts: Part[]; responseJsonSchema?: unknown; temperature?: number; timeoutMs?: number },
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
    const text = await callGemini(env, {
      system: call.system,
      parts,
      responseJsonSchema,
      temperature: call.temperature,
      timeoutMs: call.timeoutMs,
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
