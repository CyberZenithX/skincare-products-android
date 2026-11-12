import { describe, expect, it } from 'vitest';
import { enforceProfile, mentionsAvoided, rulesFromAnswers, isHighStrengthAcid } from '../src/safety';
import { Answers, SkinProfile, type ProductRec } from '../src/schemas';

const zone = { oil: 0, redness: 0, breakouts: 0, dark_spots: 0, dryness: 0, texture: 0, note: '' };
const product = (p: Partial<ProductRec>): ProductRec => ({
  category: 'serum',
  why: 'helps',
  key_ingredients: ['niacinamide'],
  avoid_ingredients: [],
  how_to_use: 'night',
  patch_test: false,
  noon_query: 'niacinamide serum',
  backup_query: 'face serum',
  ...p,
});
const baseProfile = (products: ProductRec[], extra: Partial<SkinProfile> = {}): SkinProfile =>
  SkinProfile.parse({
    photo_quality: { usable: true, issue: 'none', tip: '' },
    skin_type: 'oily',
    sensitivity: 'low',
    confidence: 'medium',
    also_possible: ['combination'],
    how_to_confirm: '',
    main_concern: 'breakouts',
    summary: '',
    zones: { forehead: zone, nose: zone, left_cheek: zone, right_cheek: zone, chin: zone },
    red_flags: [],
    products,
    ...extra,
  });
const answers = (a: Partial<Answers> = {}): Answers =>
  Answers.parse({
    skin_feel: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
    reactivity: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
    main_bother: null,
    avoid: ['nothing'],
    conditions: ['none'],
    budget_aed: 50,
    ...a,
  });

describe('mentionsAvoided', () => {
  it('ignores "-free" and "without" phrasing', () => {
    expect(mentionsAvoided('Fragrance-Free Gentle Cleanser', 'fragrance')).toBe(false);
    expect(mentionsAvoided('alcohol free toner', 'alcohol')).toBe(false);
    expect(mentionsAvoided('Toner without alcohol', 'alcohol')).toBe(false);
    expect(mentionsAvoided('Unscented lotion', 'fragrance')).toBe(false);
  });
  it('ignores fatty alcohols', () => {
    expect(mentionsAvoided('cetearyl alcohol', 'alcohol')).toBe(false);
  });
  it('catches real mentions', () => {
    expect(mentionsAvoided('Rose Scented Toner with Parfum', 'fragrance')).toBe(true);
    expect(mentionsAvoided('alcohol denat.', 'alcohol')).toBe(true);
    expect(mentionsAvoided('Lavender oil serum', 'lavender oil')).toBe(true);
  });
});

describe('rulesFromAnswers', () => {
  it('treats "not sure" as the cautious case', () => {
    const r = rulesFromAnswers({ avoid: ['unsure'], avoid_other: '', conditions: ['unsure'] });
    expect(r.cautious).toBe(true);
    expect(r.avoid).toEqual(['fragrance']);
  });
});

describe('isHighStrengthAcid', () => {
  it('flags peels and strong acids only', () => {
    expect(isHighStrengthAcid('glycolic acid 30%')).toBe(true);
    expect(isHighStrengthAcid('salicylic acid 2%')).toBe(false);
    expect(isHighStrengthAcid('salicylic acid 5%')).toBe(true);
    expect(isHighStrengthAcid('lactic acid 5%')).toBe(false);
    expect(isHighStrengthAcid('AHA', 'peeling solution peel')).toBe(true);
  });
});

describe('enforceProfile', () => {
  it('lets user answers override skin type, sensitivity and focus', () => {
    const { profile } = enforceProfile(
      baseProfile([product({})]),
      answers({
        skin_feel: { value: 'tight_flaky', source: 'user', confidence: 'high', also_possible: null },
        reactivity: { value: 'often', source: 'user', confidence: 'high', also_possible: null },
        main_bother: 'dark_spots',
      }),
    );
    expect(profile.skin_type).toBe('dry');
    expect(profile.sensitivity).toBe('high');
    expect(profile.main_concern).toBe('dark_spots');
    expect(profile.also_possible).toEqual([]);
  });

  it('keeps the photo judgment for helper answers', () => {
    const { profile } = enforceProfile(
      baseProfile([product({})]),
      answers({ skin_feel: { value: 'tight_flaky', source: 'helper', confidence: 'medium', also_possible: 'comfortable' } }),
    );
    expect(profile.skin_type).toBe('oily');
  });

  it('drops retinoids when pregnant or not sure', () => {
    for (const c of [['pregnant_breastfeeding'], ['unsure']] as const) {
      const { profile, adjustments } = enforceProfile(
        baseProfile([product({ key_ingredients: ['retinol 0.3%'] }), product({})]),
        answers({ conditions: [...c] }),
      );
      expect(profile.products).toHaveLength(1);
      expect(profile.products[0]!.key_ingredients).toEqual(['niacinamide']);
      expect(adjustments[0]!.action).toBe('dropped');
    }
  });

  it('keeps only gentle basics with prescription medicine', () => {
    const { profile } = enforceProfile(
      baseProfile([
        product({ category: 'gentle gel cleanser', key_ingredients: ['glycerin'] }),
        product({ category: 'exfoliating toner', key_ingredients: ['glycolic acid 7%'] }),
      ]),
      answers({ conditions: ['prescription'] }),
    );
    expect(profile.products.map((p) => p.category)).toEqual(['gentle gel cleanser']);
  });

  it('drops products with avoided ingredients and lists the avoid term', () => {
    const { profile } = enforceProfile(
      baseProfile([product({ key_ingredients: ['niacinamide', 'fragrance'] }), product({ category: 'gel moisturizer' })]),
      answers({ avoid: ['fragrance'] }),
    );
    expect(profile.products).toHaveLength(1);
    expect(profile.products[0]!.avoid_ingredients).toContain('fragrance');
  });

  it('removes actives for a red-flagged main focus', () => {
    const { profile } = enforceProfile(
      baseProfile([product({ key_ingredients: ['benzoyl peroxide 2.5%'] }), product({ category: 'gentle cleanser', key_ingredients: ['glycerin'] })], {
        red_flags: [{ type: 'possible_cystic_acne', note: 'deep painful bumps' }],
      }),
      answers(),
    );
    expect(profile.products.map((p) => p.category)).toEqual(['gentle cleanser']);
  });

  it('forces a patch test for actives', () => {
    const { profile } = enforceProfile(baseProfile([product({ key_ingredients: ['salicylic acid 2%'] })]), answers());
    expect(profile.products[0]!.patch_test).toBe(true);
  });

  it('returns no products for an unusable photo', () => {
    const { profile } = enforceProfile(
      baseProfile([product({})], { photo_quality: { usable: false, issue: 'too_dark', tip: 'Face a window' } }),
      answers(),
    );
    expect(profile.products).toEqual([]);
  });
});
