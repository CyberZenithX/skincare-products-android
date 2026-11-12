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
  ) {
    super(message);
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
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const responseJsonSchema = toGeminiSchema(call.schema);
  const temperature = call.temperature ?? Number(env.GEMINI_TEMPERATURE ?? '0.2');
  let feedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const parts: Part[] = feedback
      ? [...call.parts, { text: `Your previous answer was rejected: ${feedback}. Return corrected JSON only.` }]
      : call.parts;
    let text: string | undefined;
    try {
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: call.system,
          responseMimeType: 'application/json',
          responseJsonSchema,
          temperature,
          seed: 7,
          abortSignal: AbortSignal.timeout(call.timeoutMs ?? 25_000),
        },
      });
      text = res.text;
    } catch (e) {
      const name = (e as Error)?.name ?? '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('Gemini timed out', 'timeout');
      // Status only: never echo the request.
      throw new AiError(`Gemini call failed (${(e as { status?: number })?.status ?? 'network'})`, 'upstream');
    }

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
  throw new AiError(`Gemini output failed validation twice: ${feedback}`, 'invalid_output');
}

export const imagePart = (base64: string): Part => ({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
