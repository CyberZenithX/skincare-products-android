// The hard listing filter. Pure and deterministic so it can be unit-tested.

import { mentionsAvoided, type Listing } from '@skinfix/shared';

export const MIN_RATING = 3.8;

export interface FilterOptions {
  budget: number;
  avoidTerms: string[];
  /** Product type from the analysis, e.g. "gentle gel cleanser". */
  category: string;
  /** When true, the rating rule is dropped (top-up step). */
  relaxRating?: boolean;
}

export type DropReason =
  | 'over_budget'
  | 'out_of_stock'
  | 'missing_url_or_image'
  | 'low_rating'
  | 'avoided_ingredient'
  | 'bundle';

// Bundles, sets and multi-packs that aren't the product type itself.
// "Pack of 1" and "1 x 30ml" are single units and are kept; "2-in-1" is a product, not a bundle.
const MULTI = String.raw`(?:[2-9]|\d{2,})`;
const BUNDLE = new RegExp(
  String.raw`\b(bundle|combo|kit|gift set|set of \d+|value pack|pack of ${MULTI}|${MULTI}\s*(?:x|pcs|pieces|packs?)\b|${MULTI}\s*-?\s*piece|duo|trio|routine set)\b|\bset\b(?!\s*of 1\b)`,
  'i',
);

export function dropReason(l: Listing, o: FilterOptions): DropReason | null {
  if (!(l.price_aed > 0) || l.price_aed > o.budget) return 'over_budget';
  if (!l.in_stock) return 'out_of_stock';
  if (!l.url || !l.image) return 'missing_url_or_image';
  if (!o.relaxRating && l.rating !== null && (l.rating_count ?? 0) > 0 && l.rating < MIN_RATING) return 'low_rating';
  if (o.avoidTerms.some((t) => mentionsAvoided(l.title, t))) return 'avoided_ingredient';
  if (BUNDLE.test(l.title) && !BUNDLE.test(o.category)) return 'bundle';
  return null;
}

export function filterListings(items: Listing[], o: FilterOptions): Listing[] {
  const out: Listing[] = [];
  const titles = new Set<string>();
  for (const l of items) {
    if (dropReason(l, o)) continue;
    const key = l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (titles.has(key)) continue; // same product listed twice by different sellers
    titles.add(key);
    out.push(l);
  }
  return out;
}

/**
 * Build the candidate list in noon's own relevance order:
 * main query first, backup query to top up, and the rating rule relaxed only if
 * still short of 3. Returns at most `max` candidates.
 */
export function buildCandidates(
  main: Listing[],
  backup: Listing[] | null,
  o: FilterOptions,
  max = 15,
): { candidates: Listing[]; usedBackup: boolean; relaxedRating: boolean } {
  let candidates = filterListings(main, o);
  let usedBackup = false;
  let relaxedRating = false;
  if (candidates.length < 3 && backup) {
    candidates = filterListings([...main, ...backup], o);
    usedBackup = true;
  }
  if (candidates.length < 3) {
    candidates = filterListings([...main, ...(backup ?? [])], { ...o, relaxRating: true });
    relaxedRating = true;
  }
  return { candidates: candidates.slice(0, max), usedBackup, relaxedRating };
}
