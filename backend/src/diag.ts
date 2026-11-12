// /diag: measures how the Gemini model behaves with our real analysis prompt.
//
// GET  /diag                       tiny 64×64 test image (fast, checks setup)
// POST /diag {"image_base64": ...}  a real selfie (realistic timings)
//
// Runs in parallel: a plain text call, then the full analysis (system prompt,
// schema, validation) under each thinking level × temperature, and reports time
// and whether the answer passed validation. Nothing is stored or logged.

import { SkinProfile, type Answers } from '@skinfix/shared';
import type { Env } from './env';
import { AiError, callGemini, describeAiError, envThinking, imagePart, toGeminiSchema, type Thinking } from './gemini';
import { ANALYZE_SYSTEM, describeAnswers } from './prompts';
import { checkProfile } from './analyze';

/** 64×64 plain skin-toned JPEG (no face): only checks that image input works. */
export const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0WiiivGPbCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP//Z';

const ANSWERS: Answers = {
  skin_feel: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
  reactivity: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
  main_bother: null,
  avoid: ['nothing'],
  avoid_other: '',
  conditions: ['none'],
  budget_aed: 50,
};

const LEVELS: Thinking[] = ['minimal', 'low', 'medium', 'default'];
const TIMEOUT_MS = 50_000; // everything runs in parallel, inside the 60 s function limit

type Result = { ok: boolean; ms: number; status?: number | null; detail?: string };

async function timed(fn: () => Promise<string>, after?: (text: string) => string): Promise<Result> {
  const t0 = Date.now();
  try {
    const text = await fn();
    return { ok: true, ms: Date.now() - t0, detail: after ? after(text) : `${text.length} chars` };
  } catch (e) {
    const d = e instanceof AiError ? describeAiError(e) : { status: null, detail: String((e as Error)?.message ?? e).slice(0, 300) };
    return { ok: false, ms: Date.now() - t0, status: d.status, detail: d.detail };
  }
}

/** Does the answer pass the same checks the real /analyze applies? */
function judge(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'INVALID: not JSON';
  }
  const r = SkinProfile.safeParse(json);
  if (!r.success) return `INVALID: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`.slice(0, 200);
  const problem = checkProfile(r.data);
  if (problem) return `INVALID: ${problem}`;
  const p = r.data;
  return p.photo_quality.usable ? `valid: ${p.skin_type}, focus ${p.main_concern}` : `valid: photo unusable (${p.photo_quality.issue})`;
}

export async function diagnose(env: Env, imageBase64?: string) {
  const image = imageBase64 ?? TINY_JPEG;
  const schema = toGeminiSchema(SkinProfile);
  const envTemp = Number(env.GEMINI_TEMPERATURE ?? '0.2');
  const temps = [...new Set([envTemp, 1.0])];

  const textCall = timed(() => callGemini(env, { parts: [{ text: 'Reply with the single word OK.' }], timeoutMs: TIMEOUT_MS }));
  const variants = LEVELS.flatMap((thinking) =>
    temps.map(async (temperature) => ({
      thinking,
      temperature,
      ...(await timed(
        () =>
          callGemini(env, {
            system: ANALYZE_SYSTEM,
            parts: [imagePart(image), { text: describeAnswers(ANSWERS) }],
            responseJsonSchema: schema,
            temperature,
            thinking,
            timeoutMs: TIMEOUT_MS,
          }),
        judge,
      )),
    })),
  );
  const [text, ...analysis] = await Promise.all([textCall, ...variants]);

  return {
    model: env.GEMINI_MODEL,
    current_settings: { thinking: envThinking(env), temperature: envTemp },
    image: imageBase64 ? 'your photo' : 'tiny test image (POST a real selfie for realistic timings)',
    key_set: env.GEMINI_API_KEY.length > 0,
    key_has_whitespace: /\s/.test(env.GEMINI_API_KEY),
    text_call: text,
    analysis: analysis.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms),
  };
}
