// Hard rules from the answers. The prompt asks Gemini to follow them, and the
// backend enforces them again here so a model slip can never reach the user.

import type { Answers, MainConcern, ProductRec, RedFlagType, SafetyAdjustment, SkinProfile } from './schemas';
import { REACTIVITY_TO_SENSITIVITY, SKIN_FEEL_TO_TYPE } from './questions';

const RETINOID = /retin|tretinoin|adapalene|tazarotene|trifarotene|vitamin a\b/i;
const PEEL = /\bpeel\b|\btca\b|trichloroacetic/i;
const AHA = /glycolic|lactic|mandelic|malic|tartaric|\baha\b/i;
const BHA = /salicylic|\bbha\b|betaine salicylate|willow bark/i;
const ANY_ACID = /acid\b|\baha\b|\bbha\b|\bpha\b|gluconolactone/i;
const BENZOYL = /benzoyl/i;
const VITAMIN_C = /vitamin c|ascorbic|ascorbyl/i;
/** Acids that are not exfoliants (moisturizing or soothing) and don't count as actives. */
const NON_EXFOLIANT_ACID = /hyaluronic|sodium hyaluronate|fatty acid|linoleic|azelaic/i;

const GENTLE_CATEGORY = /cleanser|wash|moisturi[sz]er|cream|lotion|sunscreen|spf|sun block|sunblock/i;

function percentIn(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

export function isRetinoid(ing: string) {
  return RETINOID.test(ing);
}

export function isExfoliatingAcid(ing: string) {
  return ANY_ACID.test(ing) && !NON_EXFOLIANT_ACID.test(ing);
}

/** Actives that need a patch-test reminder (acids, retinoids, vitamin C, benzoyl peroxide). */
export function isActive(ing: string) {
  return isRetinoid(ing) || isExfoliatingAcid(ing) || BENZOYL.test(ing) || VITAMIN_C.test(ing) || /azelaic/i.test(ing);
}

/** High-strength acid: any peel, AHA over 10%, BHA over 2%. */
export function isHighStrengthAcid(ing: string, category = '') {
  if (PEEL.test(ing) || PEEL.test(category)) return true;
  const pct = percentIn(ing);
  if (pct === null) return false;
  if (AHA.test(ing)) return pct > 10;
  if (BHA.test(ing)) return pct > 2;
  return isExfoliatingAcid(ing) && pct > 10;
}

export interface SafetyRules {
  /** Pregnant, breastfeeding, or "not sure" on Q5: no retinoids, no high-strength acids. */
  cautious: boolean;
  /** Using prescription skin medicine: gentle basics only. */
  prescription: boolean;
  /** Terms the user wants to avoid ("Not sure" on Q4 means avoid fragrance). */
  avoid: string[];
}

export function rulesFromAnswers(a: Pick<Answers, 'avoid' | 'avoid_other' | 'conditions'>): SafetyRules {
  const avoid = new Set<string>();
  if (a.avoid.includes('fragrance') || a.avoid.includes('unsure')) avoid.add('fragrance');
  if (a.avoid.includes('alcohol')) avoid.add('alcohol');
  if (a.avoid.includes('other') && a.avoid_other.trim()) avoid.add(a.avoid_other.trim().toLowerCase());
  return {
    cautious: a.conditions.includes('pregnant_breastfeeding') || a.conditions.includes('unsure'),
    prescription: a.conditions.includes('prescription'),
    avoid: [...avoid],
  };
}

/** Does this ingredient (or title) contain an avoided term? "fragrance-free" does not count. */
export function mentionsAvoided(text: string, term: string): boolean {
  const t = text.toLowerCase();
  const patterns: Record<string, RegExp> = {
    fragrance: /fragrance|parfum|perfume|scented/g,
    // Drying alcohols only. Fatty alcohols (cetyl, cetearyl, stearyl...) are fine.
    alcohol: /alcohol|ethanol/g,
  };
  const re = patterns[term] ?? new RegExp(escapeRe(term), 'g');
  for (const m of t.matchAll(re)) {
    const i = m.index ?? 0;
    const before = t.slice(Math.max(0, i - 14), i);
    const after = t.slice(i + m[0].length, i + m[0].length + 8);
    if (/^\s*[- ]?\s*free/.test(after)) continue; // "fragrance-free", "alcohol free"
    if (/\b(free of|without|no|non[- ]?)\s*$/.test(before)) continue; // "no fragrance", "without alcohol"
    if (term === 'fragrance' && /un$/.test(before) && m[0] === 'scented') continue; // "unscented"
    if (term === 'alcohol' && /(cetyl|cetearyl|stearyl|behenyl|benzyl|myristyl|lanolin|fatty)\s*$/.test(before)) continue;
    return true;
  }
  return false;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Terms that every noon title must not contain, given the rules. */
export function avoidTermsForListings(rules: SafetyRules): string[] {
  const terms = [...rules.avoid];
  if (rules.cautious || rules.prescription) terms.push('retinol', 'retinal', 'retinoid', 'adapalene', 'tretinoin', 'peel');
  return [...new Set(terms)];
}

const RED_FLAG_CONCERN: Record<RedFlagType, MainConcern | null> = {
  possible_cystic_acne: 'breakouts',
  rash_or_infection: 'redness',
  severe_irritation: 'redness',
  unusual_mole: 'dark_spots',
  other: null,
};

export function concernsBlockedByRedFlags(profile: Pick<SkinProfile, 'red_flags'>): Set<MainConcern> {
  const s = new Set<MainConcern>();
  for (const f of profile.red_flags) {
    const c = RED_FLAG_CONCERN[f.type];
    if (c) s.add(c);
  }
  return s;
}

function productProblem(p: ProductRec, rules: SafetyRules, redFlagged: boolean): string | null {
  const ings = p.key_ingredients;
  for (const term of rules.avoid) {
    const hit = ings.find((i) => mentionsAvoided(i, term)) ?? (mentionsAvoided(p.category, term) ? p.category : null);
    if (hit) return `contains avoided ingredient "${term}"`;
  }
  if (rules.cautious) {
    if (ings.some(isRetinoid) || isRetinoid(p.category)) return 'retinoid not allowed (pregnancy / breastfeeding / not sure)';
    if (ings.some((i) => isHighStrengthAcid(i, p.category))) return 'high-strength acid not allowed (pregnancy / breastfeeding / not sure)';
  }
  if (rules.prescription) {
    if (!GENTLE_CATEGORY.test(p.category)) return 'only gentle basics while using prescription skin medicine';
    if (ings.some(isActive)) return 'no actives while using prescription skin medicine';
  }
  if (redFlagged && (ings.some(isActive) || !GENTLE_CATEGORY.test(p.category))) {
    return 'main focus was flagged for a dermatologist';
  }
  return null;
}

/**
 * Enforce the answer-driven rules on a Gemini profile:
 * - Q1/Q2 answered by the user override skin type / sensitivity.
 * - Q3 sets the main focus when the user picked one.
 * - Q4/Q5 and red flags remove unsafe products.
 * - Avoided terms are always listed in avoid_ingredients; actives always get a patch test.
 */
export function enforceProfile(
  profile: SkinProfile,
  answers: Answers,
): { profile: SkinProfile; adjustments: SafetyAdjustment[]; rules: SafetyRules } {
  const rules = rulesFromAnswers(answers);
  const out: SkinProfile = structuredClone(profile);
  const adjustments: SafetyAdjustment[] = [];

  if (answers.skin_feel.source === 'user' && answers.skin_feel.value) {
    out.skin_type = SKIN_FEEL_TO_TYPE[answers.skin_feel.value];
    out.confidence = 'high';
    out.also_possible = [];
  }
  out.also_possible = out.also_possible.filter((t) => t !== out.skin_type);
  if (answers.reactivity.source === 'user' && answers.reactivity.value) {
    out.sensitivity = REACTIVITY_TO_SENSITIVITY[answers.reactivity.value];
  }
  if (answers.main_bother) out.main_concern = answers.main_bother;

  if (!out.photo_quality.usable) {
    out.products = [];
    return { profile: out, adjustments, rules };
  }

  const redFlagged = concernsBlockedByRedFlags(out).has(out.main_concern);
  const kept: ProductRec[] = [];
  out.products.forEach((p, i) => {
    const problem = productProblem(p, rules, redFlagged);
    if (problem) {
      adjustments.push({ product_index: i, action: 'dropped', reason: problem });
      return;
    }
    const fixed = { ...p, avoid_ingredients: [...p.avoid_ingredients] };
    for (const term of rules.avoid) {
      if (!fixed.avoid_ingredients.some((x) => x.toLowerCase() === term)) {
        fixed.avoid_ingredients.push(term);
        adjustments.push({ product_index: i, action: 'avoid_added', reason: term });
      }
    }
    if (fixed.key_ingredients.some(isActive)) fixed.patch_test = true;
    kept.push(fixed);
  });
  out.products = kept;
  return { profile: out, adjustments, rules };
}
