// parseNoonSearch: the ONE parser for noon search pages. The Worker's own fetch
// (Layer 1) and the phone's WebView text (Layer 2) both go through it.
//
// Order of attempts, most reliable first:
//   1. Next.js pages-router JSON:   <script id="__NEXT_DATA__">{...}</script>
//   2. Next.js app-router flight data: self.__next_f.push([1,"..."]) chunks
//   3. A bare JSON document (the WebView may send just the JSON string)
//   4. Visible HTML product tiles (last resort, strict: incomplete tiles are skipped)
//
// Instead of hard-coding one path inside the JSON (which noon can move any day),
// we walk the whole tree and collect objects that look like catalogue items.

import type { Listing } from '@skinfix/shared';

export type ParseSource = 'next_data' | 'flight' | 'json' | 'html' | 'none';
export interface ParseResult {
  items: Listing[];
  source: ParseSource;
  /** Captcha / challenge / access-denied markers were found. */
  challenge: boolean;
}

const BASE = 'https://www.noon.com';
const LOCALE = 'uae-en';
const IMAGE_BASE = 'https://f.nooncdn.com/p/';

const CHALLENGE = /captcha|px-captcha|access denied|request unsuccessful|incapsula|challenge-platform|cf-chl|are you a robot|verify you are human|_abck|bot detection/i;

export function parseNoonSearch(text: string): ParseResult {
  const challenge = CHALLENGE.test(text.slice(0, 200_000)) && !/"sku"\s*:/.test(text);

  const nextData = extractNextData(text);
  if (nextData) {
    const items = collect(nextData);
    if (items.length) return { items, source: 'next_data', challenge };
  }

  const flight = extractFlight(text);
  if (flight.length) {
    const items = dedupe(flight.flatMap(collect));
    if (items.length) return { items, source: 'flight', challenge };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const items = collect(JSON.parse(trimmed));
      if (items.length) return { items, source: 'json', challenge };
    } catch {
      /* not JSON */
    }
  }

  const html = parseHtmlTiles(text);
  if (html.length) return { items: html, source: 'html', challenge };
  return { items: [], source: 'none', challenge };
}

// ---------------------------------------------------------------- extraction

function extractNextData(html: string): unknown | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Decode app-router flight chunks and parse every JSON row we can. */
function extractFlight(html: string): unknown[] {
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)/g;
  for (const m of html.matchAll(re)) {
    try {
      chunks.push(JSON.parse(m[1]!) as string);
    } catch {
      /* skip bad chunk */
    }
  }
  if (!chunks.length) return [];
  const out: unknown[] = [];
  // Rows look like `1a:{"json":...}` or `1b:["$","div",...]`. Rows can span chunks.
  for (const line of chunks.join('').split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1 || colon > 8) continue;
    const body = line.slice(colon + 1);
    if (!body.startsWith('{') && !body.startsWith('[')) continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      /* partial row */
    }
  }
  return out;
}

// ---------------------------------------------------------------- tree walk

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function collect(root: unknown): Listing[] {
  const found: Listing[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  let guard = 0;
  while (stack.length && guard++ < 500_000) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    const item = toListing(v as Obj);
    if (item) {
      found.push(item);
      continue; // don't descend into a product (variants would duplicate it)
    }
    const vals = Object.values(v);
    for (let i = vals.length - 1; i >= 0; i--) stack.push(vals[i]);
  }
  return dedupe(found);
}

function dedupe(items: Listing[]): Listing[] {
  const byId = new Map<string, Listing>();
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
  return [...byId.values()];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
  }
  if (isObj(v)) return num(v.value ?? v.amount);
  return null;
}

/** Recognise one catalogue item. Returns null unless every field we need is present. */
function toListing(o: Obj): Listing | null {
  const sku = str(o.sku) ?? str(o.sku_config) ?? str(o.skuConfig);
  const title = str(o.name) ?? str(o.title) ?? str(o.product_title);
  if (!sku || !title || !/^[A-Za-z0-9_-]{5,40}$/.test(sku)) return null;

  const price = num(o.price);
  const sale = num(o.sale_price ?? o.salePrice ?? o.offer_price);
  if (price === null && sale === null) return null;
  const current = sale !== null && (price === null || sale <= price) ? sale : price!;
  const original = price !== null && sale !== null && sale < price ? price : null;

  const url = productUrl(o, sku);
  const image = imageUrl(o);
  if (!url || !image) return null;

  const ratingObj = isObj(o.product_rating) ? o.product_rating : isObj(o.rating) ? o.rating : null;
  const rating = num(ratingObj?.value ?? ratingObj?.average ?? o.rating_value ?? (typeof o.rating === 'number' ? o.rating : null));
  const ratingCount = num(ratingObj?.count ?? ratingObj?.total ?? o.rating_count ?? o.reviews_count);

  const buyable = o.is_buyable ?? o.isBuyable ?? o.in_stock ?? o.inStock;
  const outOfStock = o.is_out_of_stock === true || o.out_of_stock === true || buyable === false;

  return {
    id: sku,
    title: decodeEntities(title),
    brand: str(o.brand) ?? (isObj(o.brand) ? str(o.brand.name) : null),
    url,
    image,
    price_aed: round2(current),
    original_price_aed: original === null ? null : round2(original),
    rating: rating !== null && rating > 0 && rating <= 5 ? round2(rating) : null,
    rating_count: ratingCount !== null ? Math.round(ratingCount) : null,
    in_stock: !outOfStock,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function productUrl(o: Obj, sku: string): string | null {
  const raw = str(o.url) ?? str(o.product_url) ?? str(o.link) ?? str(o.slug);
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return isNoon(raw) ? raw : null;
  if (raw.startsWith('/')) return BASE + raw;
  // Catalogue items carry a slug: /uae-en/<slug>/<SKU>/p/
  const slug = raw.replace(/^\/+|\/+$/g, '');
  return `${BASE}/${LOCALE}/${slug}/${sku}/p/`;
}

function imageUrl(o: Obj): string | null {
  const key = str(o.image_key) ?? str(o.imageKey) ?? (Array.isArray(o.image_keys) ? str(o.image_keys[0]) : null);
  if (key) return /^https?:\/\//.test(key) ? key : `${IMAGE_BASE}${key.replace(/^\/+/, '')}.jpg`;
  const direct = str(o.image_url) ?? str(o.image) ?? str(o.thumbnail);
  if (direct && /^https?:\/\//.test(direct)) return direct;
  if (direct?.startsWith('//')) return `https:${direct}`;
  return null;
}

const isNoon = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === 'noon.com' || h.endsWith('.noon.com');
  } catch {
    return false;
  }
};

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- HTML fallback

/**
 * Strict tile reader for when no JSON exists. A tile is an <a> to a product page
 * (/uae-en/<slug>/<SKU>/p/) that contains an image, a title and an AED price.
 * Rating is optional. Anything incomplete is skipped rather than guessed.
 */
function parseHtmlTiles(html: string): Listing[] {
  const out: Listing[] = [];
  const re = /<a\b[^>]*href=["']((?:https:\/\/www\.noon\.com)?\/uae-en\/[^"'?#]+?\/([A-Z0-9]{6,30})\/p\/?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, href, sku, inner] = m as unknown as [string, string, string, string];
    const img = inner.match(/<img\b[^>]*src=["'](https:\/\/[^"']+)["'][^>]*>/i);
    const alt = inner.match(/<img\b[^>]*alt=["']([^"']{5,})["']/i);
    const titleAttr = m[0].match(/\btitle=["']([^"']{5,})["']/i);
    const title = titleAttr?.[1] ?? alt?.[1];
    const priceMatch = inner.replace(/<[^>]+>/g, ' ').match(/AED\s*([\d,]+(?:\.\d+)?)/i);
    if (!img?.[1] || !title || !priceMatch?.[1]) continue;
    const price = Number(priceMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      id: sku,
      title: decodeEntities(title),
      brand: null,
      url: href.startsWith('http') ? href : BASE + href,
      image: img[1],
      price_aed: price,
      original_price_aed: null,
      rating: null,
      rating_count: null,
      in_stock: true,
    });
  }
  return dedupe(out);
}
