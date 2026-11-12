// GET /diag: pinpoints why Gemini calls fail, step by step, without a selfie.
// 1) plain text  → key, billing, model name
// 2) structured output with the real SkinProfile schema → schema / config accepted
// 3) the same with a tiny image → image input accepted
// Returns Gemini's status and error text for the first failing step.

import { SkinProfile } from '@skinfix/shared';
import type { Env } from './env';
import { AiError, callGemini, describeAiError, imagePart, toGeminiSchema } from './gemini';

/** 64×64 plain skin-toned JPEG (no face): only checks that image input is accepted. */
const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0WiiivGPbCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Z';

type Step = { step: string; ok: boolean; ms: number; status?: number | null; detail?: string };

async function run(step: string, fn: () => Promise<string>): Promise<Step> {
  const t0 = Date.now();
  try {
    const text = await fn();
    return { step, ok: true, ms: Date.now() - t0, detail: `${text.length} chars returned` };
  } catch (e) {
    const d = e instanceof AiError ? describeAiError(e) : { status: null, detail: String((e as Error)?.message ?? e).slice(0, 500) };
    return { step, ok: false, ms: Date.now() - t0, status: d.status, detail: d.detail };
  }
}

export async function diagnose(env: Env) {
  const steps: Step[] = [];
  const schema = toGeminiSchema(SkinProfile);
  const plan: [string, () => Promise<string>][] = [
    ['1_text', () => callGemini(env, { parts: [{ text: 'Reply with the single word OK.' }], timeoutMs: 20_000 })],
    [
      '2_schema',
      () =>
        callGemini(env, {
          parts: [{ text: 'There is no photo. Return a profile with photo_quality.usable=false, issue "face_not_clear", all scores 0, no products.' }],
          responseJsonSchema: schema,
          timeoutMs: 30_000,
        }),
    ],
    [
      '3_image',
      () =>
        callGemini(env, {
          parts: [imagePart(TINY_JPEG), { text: 'Describe this image in one word.' }],
          timeoutMs: 20_000,
        }),
    ],
  ];
  for (const [name, fn] of plan) {
    const r = await run(name, fn);
    steps.push(r);
    if (!r.ok) break; // later steps would fail for the same reason
  }
  return {
    model: env.GEMINI_MODEL,
    key_set: env.GEMINI_API_KEY.length > 0,
    key_length: env.GEMINI_API_KEY.length,
    key_has_whitespace: /\s/.test(env.GEMINI_API_KEY),
    ok: steps.every((s) => s.ok),
    steps,
  };
}
