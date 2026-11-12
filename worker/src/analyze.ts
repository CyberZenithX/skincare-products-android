import {
  enforceProfile,
  avoidTermsForListings,
  z,
  SkinProfile,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type Language,
} from '@skinfix/shared';
import type { Env } from './env';
import { generateJson, imagePart } from './gemini';
import { ANALYZE_SYSTEM, TRANSLATE_SYSTEM, describeAnswers } from './prompts';

/** Checks zod can't express. Returns a problem for the retry, or null. */
export function checkProfile(p: SkinProfile): string | null {
  if (p.photo_quality.usable) {
    if (p.photo_quality.issue !== 'none') return 'usable is true but issue is not "none"';
    if (p.products.length === 0 && p.red_flags.length === 0) return 'a usable photo needs 1 or 2 products';
    if (p.confidence !== 'high' && p.also_possible.length === 0 && p.how_to_confirm.trim() === '')
      return 'skin type is not certain: fill also_possible or how_to_confirm';
  } else {
    if (p.photo_quality.issue === 'none') return 'usable is false but issue is "none"';
    if (!p.photo_quality.tip.trim()) return 'an unusable photo needs a tip';
  }
  for (const pr of p.products) {
    if (/https?:|www\.|\.com/i.test(JSON.stringify(pr))) return 'products must not contain links';
  }
  return null;
}

export async function analyze(env: Env, req: AnalyzeRequest): Promise<AnalyzeResponse> {
  // Identical prompt for every language: the judgment can't depend on it.
  const raw = await generateJson(env, {
    system: ANALYZE_SYSTEM,
    parts: [imagePart(req.image_base64), { text: describeAnswers(req.answers) }],
    schema: SkinProfile,
    check: checkProfile,
    timeoutMs: 25_000,
  });
  return finish(env, raw, req.answers, req.language);
}

export async function finish(
  env: Env | null,
  raw: SkinProfile,
  answers: AnalyzeRequest['answers'],
  language: Language,
): Promise<AnalyzeResponse> {
  const { profile, adjustments, rules } = enforceProfile(raw, answers);
  const display = profile.products.map((p) => ({
    category: p.category,
    key_ingredients: [...p.key_ingredients],
    avoid_ingredients: [...p.avoid_ingredients],
  }));
  const base: AnalyzeResponse = {
    ok: true,
    profile,
    text_language: 'en',
    adjustments,
    avoid_terms: avoidTermsForListings(rules),
    product_display: display,
  };
  if (language === 'en' || !env) return base;
  try {
    return await translate(env, base);
  } catch {
    // Better to show correct English than nothing: the app labels it.
    return base;
  }
}

// ---------------------------------------------------------------- translation

/** Only the free text people read. Enums, scores, queries never pass through here. */
const TextBundle = z.object({
  photo_tip: z.string(),
  how_to_confirm: z.string(),
  summary: z.string(),
  zone_notes: z.object({
    forehead: z.string(),
    nose: z.string(),
    left_cheek: z.string(),
    right_cheek: z.string(),
    chin: z.string(),
  }),
  red_flag_notes: z.array(z.string()),
  products: z.array(
    z.object({
      category: z.string(),
      why: z.string(),
      how_to_use: z.string(),
      key_ingredients: z.array(z.string()),
      avoid_ingredients: z.array(z.string()),
    }),
  ),
});
type TextBundle = z.infer<typeof TextBundle>;

async function translate(env: Env, res: AnalyzeResponse): Promise<AnalyzeResponse> {
  const p = res.profile;
  const src: TextBundle = {
    photo_tip: p.photo_quality.tip,
    how_to_confirm: p.how_to_confirm,
    summary: p.summary,
    zone_notes: {
      forehead: p.zones.forehead.note,
      nose: p.zones.nose.note,
      left_cheek: p.zones.left_cheek.note,
      right_cheek: p.zones.right_cheek.note,
      chin: p.zones.chin.note,
    },
    red_flag_notes: p.red_flags.map((f) => f.note),
    products: p.products.map((x) => ({
      category: x.category,
      why: x.why,
      how_to_use: x.how_to_use,
      key_ingredients: x.key_ingredients,
      avoid_ingredients: x.avoid_ingredients,
    })),
  };
  const shapeOk = (t: TextBundle): string | null => {
    if (t.red_flag_notes.length !== src.red_flag_notes.length) return 'red_flag_notes count changed';
    if (t.products.length !== src.products.length) return 'products count changed';
    for (let i = 0; i < t.products.length; i++) {
      if (t.products[i]!.key_ingredients.length !== src.products[i]!.key_ingredients.length) return 'key_ingredients count changed';
      if (t.products[i]!.avoid_ingredients.length !== src.products[i]!.avoid_ingredients.length) return 'avoid_ingredients count changed';
    }
    return null;
  };
  const t = await generateJson(env, {
    system: TRANSLATE_SYSTEM,
    parts: [{ text: JSON.stringify(src) }],
    schema: TextBundle,
    check: shapeOk,
    temperature: 0,
    timeoutMs: 15_000,
  });

  const out: AnalyzeResponse = structuredClone(res);
  const q = out.profile;
  q.photo_quality.tip = t.photo_tip;
  q.how_to_confirm = t.how_to_confirm;
  q.summary = t.summary;
  for (const z of ['forehead', 'nose', 'left_cheek', 'right_cheek', 'chin'] as const) q.zones[z].note = t.zone_notes[z];
  q.red_flags.forEach((f, i) => (f.note = t.red_flag_notes[i]!));
  q.products.forEach((x, i) => {
    x.why = t.products[i]!.why;
    x.how_to_use = t.products[i]!.how_to_use;
    // category, key_ingredients and avoid_ingredients stay English (safety + search); display gets Arabic.
  });
  out.product_display = t.products.map((x) => ({
    category: x.category,
    key_ingredients: x.key_ingredients,
    avoid_ingredients: x.avoid_ingredients,
  }));
  out.text_language = 'ar';
  return out;
}
