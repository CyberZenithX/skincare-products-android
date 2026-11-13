// parseNoonSearch: the ONE parser for noon search pages. The backend's own fetch
// (Layer 1) and the phone's WebView text (Layer 2) both go through it.
//
// Order of attempts, most reliable first:
//   1. Next.js pages-router JSON:   <script id="__NEXT_DATA__">{...}</script>
//   2. Next.js app-router flight data: self.__next_f.push([1,"..."]) chunks
//   3. schema.org JSON-LD (Product / ItemList) plus noon's productBox cards.
//      This is what noon actually serves as of 2026-11 (server-rendered pages,
//      no Next.js data); see fixtures/noon/real-*.html.
//   4. A bare JSON document (the WebView may send just the JSON string)
//   5. Older visible HTML tiles (last resort, strict: incomplete tiles are skipped)
//
// Instead of hard-coding one path inside the JSON (which noon can move any day),
// we walk the whole tree and collect objects that look like catalogue items.

import type { Listing } from '@skinfix/shared';

export type ParseSource = 'next_data' | 'flight' | 'jsonld' | 'cards' | 'json' | 'html' | 'none';
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
  const r = parseInner(text);
  // A challenge only matters when nothing could be read. Google reCAPTCHA's badge
  // and script are on every normal noon page, so they don't count.
  const head = text.slice(0, 300_000).replace(/g?recaptcha/gi, '');
  return { ...r, challenge: r.items.length === 0 && CHALLENGE.test(head) };
}

function parseInner(text: string): Omit<ParseResult, 'challenge'> {

  const nextData = extractNextData(text);
  if (nextData) {
    const items = collect(nextData);
    if (items.length) return { items, source: 'next_data' };
  }

  const flight = extractFlight(text);
  if (flight.length) {
    const items = dedupe(flight.flatMap(collect));
    if (items.length) return { items, source: 'flight' };
  }

  const ld = parseJsonLd(text);
  const cards = dedupe([...parsePlpCards(text, ldBuyable(text)), ...parseProductCards(text)]);
  if (ld.length || cards.length) {
    return { items: mergeLdAndCards(ld, cards), source: ld.length ? 'jsonld' : 'cards' };
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const items = collect(JSON.parse(trimmed));
      if (items.length) return { items, source: 'json' };
    } catch {
      /* not JSON */
    }
  }

  const html = parseHtmlTiles(text);
  if (html.length) return { items: html, source: 'html' };
  return { items: [], source: 'none' };
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

// ---------------------------------------------------------------- schema.org JSON-LD

const SKU_IN_URL = /\/([A-Za-z0-9]{6,30})\/p\/?(?:[?#]|$)/;

function parseJsonLd(html: string): Listing[] {
  const out: Listing[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      walkLd(JSON.parse(m[1]!), out, 0);
    } catch {
      /* malformed block: skip it, keep the others */
    }
  }
  return dedupe(out);
}

const ldTypes = (o: Obj): string[] => {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
};

function walkLd(node: unknown, out: Listing[], depth: number) {
  if (depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walkLd(n, out, depth + 1);
    return;
  }
  const o = node as Obj;
  if (Array.isArray(o['@graph'])) walkLd(o['@graph'], out, depth + 1);
  const types = ldTypes(o);
  if (types.includes('ItemList') && Array.isArray(o.itemListElement)) {
    for (const el of o.itemListElement) {
      // ListItem { item: Product } or a Product directly.
      walkLd(isObj(el) && isObj(el.item) ? el.item : el, out, depth + 1);
    }
  }
  if (types.includes('Product')) {
    const l = ldProduct(o);
    if (l) out.push(l);
  }
}

const IN_STOCK = /InStock|LimitedAvailability|OnlineOnly/i;
const NOT_IN_STOCK = /OutOfStock|SoldOut|Discontinued|PreOrder|PreSale|BackOrder|InStoreOnly/i;

function ldProduct(p: Obj): Listing | null {
  const offersRaw = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
  // UAE store only: skip offers priced in another currency.
  const offer = offersRaw.find((x): x is Obj => isObj(x) && (x.priceCurrency === undefined || x.priceCurrency === 'AED'));
  if (!offer) return null;
  const price = num(offer.price) ?? num(offer.lowPrice);
  if (price === null) return null;

  const url = str(offer.url) ?? str(p.url);
  if (!url || !/^https?:\/\//.test(url) || !isNoon(url)) return null;
  const sku = str(p.sku) ?? url.match(SKU_IN_URL)?.[1] ?? null;
  const title = str(p.name);
  if (!sku || !title) return null;

  const images = (Array.isArray(p.image) ? p.image : [p.image])
    .map((im) => (typeof im === 'string' ? im : isObj(im) ? str(im.url) ?? str(im.contentUrl) : null))
    .filter((u): u is string => !!u && /^https:\/\//.test(u));
  if (!images[0]) return null;

  const specs = (Array.isArray(offer.priceSpecification) ? offer.priceSpecification : [offer.priceSpecification]).filter(isObj);
  const struck = specs.find((sp) => /StrikethroughPrice|ListPrice|MSRP/i.test(String(sp.priceType ?? '')));
  const was = struck ? num(struck.price) : null;

  const agg = isObj(p.aggregateRating) ? p.aggregateRating : null;
  let rating = num(agg?.ratingValue);
  const best = num(agg?.bestRating) ?? 5;
  if (rating !== null && best !== 5 && best > 0) rating = (rating / best) * 5; // keep everything on a 5-star scale
  const count = num(agg?.reviewCount) ?? num(agg?.ratingCount);

  const availability = String(offer.availability ?? '');
  const inStock = availability ? IN_STOCK.test(availability) && !NOT_IN_STOCK.test(availability) : true;

  return {
    id: sku,
    title: decodeEntities(title),
    brand: str(p.brand) ?? (isObj(p.brand) ? str(p.brand.name) : null),
    url,
    image: cardImage(images[0]),
    price_aed: round2(price),
    original_price_aed: was !== null && was > price ? round2(was) : null,
    rating: rating !== null && rating > 0 && rating <= 5 ? round2(rating) : null,
    rating_count: count !== null ? Math.round(count) : null,
    in_stock: inStock,
  };
}

/** noon's CDN takes a width parameter: ask for a card-sized image instead of 1200px. */
function cardImage(u: string): string {
  try {
    const url = new URL(u);
    if (url.hostname.endsWith('nooncdn.com') && url.searchParams.has('width')) url.searchParams.set('width', '400');
    return url.toString();
  } catch {
    return u;
  }
}

// ---------------------------------------------------------------- noon search-result (PLP) cards
//
// <div data-qa="plp-product-box"><a href=".../<slug>/<SKU>/p/?o=…&pcl=…">
//   <img class="_productImage_…" src="https://f.nooncdn.com/p/…" …>            (several slides)
//   <h2 data-qa="plp-product-box-name" title="Full title">…</h2>
//   <div class="_textCtr_…">4.3</div> <div class="_countCtr_…">(<span>392</span>)</div>
//   <div data-qa="plp-product-box-price"> <strong class="_amount_…">36</strong>
//     <span class="_oldPrice_… strikeThrough">45</span> </div>
// data-qa attributes are noon's own test hooks, so they're steadier than the
// hashed class names. Used only with a title, price AND an https image.

/** ItemList JSON-LD on search pages: url + isBuyable per result (no price). */
function ldBuyable(html: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const d = JSON.parse(m[1]!);
      for (const el of isObj(d) && Array.isArray(d.itemListElement) ? d.itemListElement : []) {
        const url = isObj(el) ? str(el.url) ?? (isObj(el.item) ? str(el.item.url) : null) : null;
        const sku = url?.match(SKU_IN_URL)?.[1];
        if (sku && isObj(el) && typeof el.isBuyable === 'boolean') map.set(sku, el.isBuyable);
      }
    } catch {
      /* skip */
    }
  }
  return map;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;

/** noon link without tracking: keep the offer id (?o=) so the price matches the seller shown. */
function cleanProductUrl(href: string): string | null {
  try {
    const u = new URL(decodeEntities(href), BASE);
    if (!isNoon(u.toString())) return null;
    const o = u.searchParams.get('o');
    return `https://www.noon.com${u.pathname}${o ? `?o=${encodeURIComponent(o)}` : ''}`;
  } catch {
    return null;
  }
}

function countText(t: string | null): number | null {
  const m = t?.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  return m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : null;
}

function parsePlpCards(html: string, buyable: Map<string, boolean>): Listing[] {
  const starts = [...html.matchAll(/data-qa=["']plp-product-box["']/g)].map((m) => m.index ?? 0);
  const out: Listing[] = [];
  starts.forEach((start, i) => {
    const chunk = html.slice(start, Math.min(starts[i + 1] ?? html.length, start + 80_000));
    const a = chunk.match(/<a\b[^>]*\bhref=["']([^"']*\/([A-Za-z0-9]{5,40})\/p\/?[^"']*)["'][^>]*>/i);
    if (!a) return;
    const url = cleanProductUrl(a[1]!);
    const sku = a[2]!;
    if (!url) return;

    const nameTag = chunk.match(/<\w+\b[^>]*data-qa=["']plp-product-box-name["'][^>]*>([\s\S]*?)<\/\w+>/i);
    const title =
      (nameTag && (attr(nameTag[0], 'title') ?? nameTag[1]!.replace(/<[^>]+>/g, ' '))) ??
      attr(chunk.match(/<img\b[^>]*class=["'][^"']*productImage[^"']*["'][^>]*>/i)?.[0] ?? '', 'alt')?.replace(/\s+-\s+Image\s+\d+\s*$/i, '') ??
      null;

    const pAt = chunk.search(/data-qa=["']plp-product-box-price["']/);
    const priceRegion = pAt >= 0 ? chunk.slice(pAt, pAt + 3000) : '';
    const price = priceText(classed(priceRegion, /_amount_|productPrice|sellingPrice/));
    const was = priceText(classed(priceRegion, /_oldPrice_|strikeThrough|wasPrice/));

    const imgs = [...chunk.matchAll(/<img\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /productImage/i.test(attr(tag, 'class') ?? ''))
      .flatMap((tag) => [attr(tag, 'src'), attr(tag, 'data-src'), ...(attr(tag, 'srcset') ?? '').split(',').map((x) => x.trim().split(/\s+/)[0] ?? '')])
      .filter((u): u is string => !!u && /^https:\/\/[^/]*nooncdn\.com\//.test(u));
    if (!title || price === null || !imgs[0]) return;

    // Rating sits right after the title; don't wander into the price block.
    const nAt = chunk.search(/data-qa=["']plp-product-box-name["']/);
    const ratingRegion = nAt >= 0 ? chunk.slice(nAt, pAt > nAt ? pAt : nAt + 3000) : '';
    const ratingTxt = classed(ratingRegion, /_textCtr_|ratingValue/);
    const rating = ratingTxt ? Number(ratingTxt.match(/^\s*([0-5](?:\.\d)?)\s*$/)?.[1]) : NaN;
    const hasRating = Number.isFinite(rating) && rating > 0;
    const text = chunk.replace(/<[^>]+>/g, ' ');

    out.push({
      id: sku,
      title: decodeEntities(title),
      brand: null,
      url,
      image: cardImage(decodeEntities(imgs[0])),
      price_aed: round2(price),
      original_price_aed: was !== null && was > price ? round2(was) : null,
      rating: hasRating ? rating : null,
      rating_count: hasRating ? countText(classed(ratingRegion, /_countCtr_|ratingCount/)) : null,
      in_stock: buyable.get(sku) ?? !/out of stock|sold out|نفدت الكمية|غير متوفر/i.test(text),
    });
  });
  return dedupe(out);
}

// ---------------------------------------------------------------- noon productBox cards
//
// <a id="productBox-<SKU>" href=".../<slug>/<SKU>/p/?o=..."> … <strong class="_productPrice_xxxx">45.00</strong>
//   … <p class="_productTitle_xxxx">Title</p> … </a>
// Class names carry a build hash (_productPrice_1kuur_26); we match only the stable middle part.
// A card is used only when it has a title, a price AND an image inside it. Nothing is guessed.

function classed(inner: string, name: RegExp): string | null {
  const re = new RegExp(`<(\\w+)\\b[^>]*class=["'][^"']*(?:${name.source})[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`, 'i');
  const m = inner.match(re);
  return m ? decodeEntities(m[2]!.replace(/<[^>]+>/g, ' ')) : null;
}

const priceText = (t: string | null) => {
  if (!t) return null;
  const m = t.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function balancedAnchor(html: string, start: number): string | null {
  let depth = 0;
  const re = /<a\b|<\/a>/gi;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index - start > 30_000) return null;
    depth += m[0].toLowerCase() === '</a>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return null;
}

function parseProductCards(html: string): Listing[] {
  const out: Listing[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bid=["']productBox-([A-Za-z0-9]{5,40})["'][^>]*>/gi)) {
    const card = balancedAnchor(html, m.index ?? 0);
    if (!card) continue;
    const open = m[0];
    const sku = m[1]!;
    const href = open.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const url = href.startsWith('http') ? href : href.startsWith('/') ? BASE + href : null;
    if (!url || !isNoon(url) || !url.includes(`/${sku}/p`)) continue;

    const inner = card.slice(open.length);
    const title = classed(inner, /productTitle|_title_/) ?? inner.match(/<img\b[^>]*\balt=["']([^"']{5,})["']/i)?.[1] ?? null;
    const price = priceText(classed(inner, /productPrice|sellingPrice|_amount_/));
    const imgUrls = [...inner.matchAll(/\b(?:src|data-src|srcset)=["']([^"']+)["']/gi)]
      .flatMap((x) => x[1]!.split(',').map((part) => part.trim().split(/\s+/)[0]!))
      .filter((u) => /^https:\/\/[^/]*nooncdn\.com\//.test(u));
    if (!title || price === null || !imgUrls[0]) continue;

    const was = priceText(classed(inner, /oldPrice|wasPrice|strikethrough|crossedPrice|_was_/));
    const ratingTxt = classed(inner, /_rating_|ratingValue|productRating/);
    const rating = ratingTxt ? Number(ratingTxt.match(/^\s*([0-5](?:\.\d)?)\b/)?.[1]) : NaN;
    const countMatch = inner.replace(/<[^>]+>/g, ' ').match(/\((\d[\d,.]*)\s*([kK])?\)/);
    const count = countMatch ? Math.round(Number(countMatch[1]!.replace(/,/g, '')) * (countMatch[2] ? 1000 : 1)) : null;
    const text = inner.replace(/<[^>]+>/g, ' ');

    out.push({
      id: sku,
      title: decodeEntities(title),
      brand: null,
      url,
      image: cardImage(imgUrls[0]),
      price_aed: round2(price),
      original_price_aed: was !== null && was > price ? round2(was) : null,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      rating_count: Number.isFinite(rating) && rating > 0 && count !== null && Number.isFinite(count) ? count : null,
      in_stock: !/out of stock|sold out|نفدت الكمية|غير متوفر/i.test(text),
    });
  }
  return dedupe(out);
}

/**
 * Cards keep noon's on-page result order; JSON-LD has the richer, more reliable
 * fields (brand, rating, struck-through price, stock), so it wins per product.
 */
function mergeLdAndCards(ld: Listing[], cards: Listing[]): Listing[] {
  const byId = new Map(ld.map((l) => [l.id, l]));
  const out = cards.map((c) => byId.get(c.id) ?? c);
  const seen = new Set(out.map((l) => l.id));
  for (const l of ld) if (!seen.has(l.id)) out.push(l);
  return out;
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
