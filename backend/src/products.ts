import { noonSearchUrl, z, type Listing, type ProductsRequest, type ProductsResponse, type PickedListing } from '@skinfix/shared';
import type { Env } from './env';
import { generateJson } from './gemini';
import { buildCandidates } from './noon/filter';
import { parseNoonSearch } from './noon/parse';
import { PICK_SYSTEM } from './prompts';
import { bumpLayer, sha256 } from './kv';

const CACHE_TTL = 60 * 60 * 24;
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export type FetchPage = (query: string) => Promise<{ status: number; text: string }>;
export type Picker = (env: Env, req: ProductsRequest, candidates: Listing[]) => Promise<PickedListing[]>;

export const fetchNoon: FetchPage = async (query) => {
  const res = await fetch(noonSearchUrl(query), {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-AE,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8_000),
  });
  return { status: res.status, text: res.status === 200 ? await res.text() : '' };
};

/**
 * Cache key. The plan says query + budget; we also include everything else that
 * changes the answer (avoid list, product type, ingredients, language of the
 * reasons), so one user's filter can never leak into another's results.
 */
export async function cacheKey(req: ProductsRequest): Promise<string> {
  const p = req.product;
  const id = JSON.stringify([
    p.noon_query.toLowerCase().trim(),
    p.backup_query.toLowerCase().trim(),
    req.budget_aed,
    [...req.avoid_terms].map((t) => t.toLowerCase()).sort(),
    p.category.toLowerCase(),
    [...p.key_ingredients].map((t) => t.toLowerCase()).sort(),
    req.language,
  ]);
  return `noon:v1:${await sha256(id)}`;
}

type PageResult = { items: Listing[]; blocked: boolean };

function readPage(status: number, text: string): PageResult {
  if (status !== 200) return { items: [], blocked: true };
  const parsed = parseNoonSearch(text);
  // Zero products counts as blocked: a real search for a common ingredient always has hits.
  return { items: parsed.items, blocked: parsed.items.length === 0 };
}

export async function products(
  env: Env,
  req: ProductsRequest,
  deps: { fetchPage?: FetchPage; pick?: Picker } = {},
): Promise<ProductsResponse> {
  const p = req.product;
  const searchUrl = noonSearchUrl(p.noon_query);
  const fetchPage = deps.fetchPage ?? fetchNoon;
  const pick = deps.pick ?? pickWithGemini;

  if (req.link_fallback) {
    await bumpLayer(env, 'link');
    return { status: 'link', search_url: searchUrl };
  }

  const key = await cacheKey(req);
  if (!req.raw_pages) {
    const hit = await env.store.getJson<Extract<ProductsResponse, { status: 'ok' }>>(key);
    if (hit) return { ...(hit as Extract<ProductsResponse, { status: 'ok' }>), cached: true };
  }

  let main: PageResult;
  let backup: PageResult | null = null;
  let layer: 'server' | 'webview';

  if (req.raw_pages) {
    // Layer 2: same parser, same filter, same pick.
    layer = 'webview';
    const byQuery = new Map(req.raw_pages.map((r) => [r.query.trim().toLowerCase(), r.page]));
    const mainText = byQuery.get(p.noon_query.trim().toLowerCase()) ?? req.raw_pages[0]!.page;
    main = readPage(200, mainText);
    const b = byQuery.get(p.backup_query.trim().toLowerCase());
    if (b !== undefined) backup = readPage(200, b);
    if (main.blocked && (!backup || backup.blocked)) {
      await bumpLayer(env, 'link');
      return { status: 'link', search_url: searchUrl };
    }
  } else {
    // Layer 1: one request per query, no loops, never product pages.
    layer = 'server';
    main = await safeFetch(fetchPage, p.noon_query);
    if (main.blocked) {
      await bumpLayer(env, 'blocked');
      return { status: 'blocked', queries: [p.noon_query, p.backup_query], search_url: searchUrl };
    }
  }

  const opts = { budget: req.budget_aed, avoidTerms: req.avoid_terms, category: p.category };
  let built = buildCandidates(main.items, backup?.items ?? null, opts);
  if (built.candidates.length < 3 && layer === 'server' && p.backup_query.trim().toLowerCase() !== p.noon_query.trim().toLowerCase()) {
    backup = await safeFetch(fetchPage, p.backup_query);
    built = buildCandidates(main.items, backup.blocked ? null : backup.items, opts);
  }

  const listings = built.candidates.length ? await pick(env, req, built.candidates) : [];
  const result: Extract<ProductsResponse, { status: 'ok' }> = {
    status: 'ok',
    layer,
    cached: false,
    listings,
    search_url: searchUrl,
  };
  if (listings.length) await env.store.setJson(key, result, CACHE_TTL);
  await bumpLayer(env, layer);
  return result;
}

async function safeFetch(fetchPage: FetchPage, query: string): Promise<PageResult> {
  try {
    const r = await fetchPage(query);
    return readPage(r.status, r.text);
  } catch {
    return { items: [], blocked: true };
  }
}

// ---------------------------------------------------------------- Gemini pick

const PickOut = z.object({
  picks: z
    .array(z.object({ id: z.string(), reason: z.string().max(160) }))
    .max(3),
});

export const pickWithGemini: Picker = async (env, req, candidates) => {
  const ids = new Set(candidates.map((c) => c.id));
  const p = req.product;
  const lines = candidates.map(
    (c) =>
      `id=${c.id} | title=${c.title} | brand=${c.brand ?? '-'} | price=${c.price_aed} AED | rating=${c.rating ?? '-'} | reviews=${c.rating_count ?? 0}`,
  );
  const text = [
    `PRODUCT TYPE: ${p.category}`,
    `KEY INGREDIENTS: ${p.key_ingredients.join(', ')}`,
    `AVOID: ${[...new Set([...p.avoid_ingredients, ...req.avoid_terms])].join(', ') || 'none'}`,
    `WRITE REASONS IN: ${req.language === 'ar' ? 'Modern Standard Arabic' : 'English'}`,
    'CANDIDATES (text only):',
    ...lines,
  ].join('\n');
  try {
    const out = await generateJson(env, {
      system: PICK_SYSTEM,
      parts: [{ text }],
      schema: PickOut,
      check: (o) => {
        const bad = o.picks.find((x) => !ids.has(x.id));
        if (bad) return `id ${bad.id} is not in the candidate list`;
        if (new Set(o.picks.map((x) => x.id)).size !== o.picks.length) return 'ids must be unique';
        return null;
      },
      temperature: 0,
      thinking: 'minimal', // choosing ids from a short text list
      timeoutMs: 12_000,
    });
    // Map back to the stored listing: nothing from the model reaches the card except the reason.
    return out.picks.map((x) => ({ ...candidates.find((c) => c.id === x.id)!, reason: x.reason }));
  } catch {
    // Model unavailable: fall back to noon's own relevance order, without reasons.
    return candidates.slice(0, 3).map((c) => ({ ...c, reason: null }));
  }
};
