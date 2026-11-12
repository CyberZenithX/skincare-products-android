import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNoonSearch } from '../src/noon/parse';
import { buildCandidates, dropReason, filterListings } from '../src/noon/filter';
import { Listing } from '@skinfix/shared';

const fx = (name: string) => readFileSync(new URL(`../../fixtures/noon/${name}`, import.meta.url), 'utf8');

describe('parseNoonSearch', () => {
  const nd = parseNoonSearch(fx('SYNTHETIC-next-data-niacinamide.html'));

  it('reads __NEXT_DATA__ first', () => {
    expect(nd.source).toBe('next_data');
    expect(nd.challenge).toBe(false);
    // 11 hits, one has no image → skipped (we never show a card without an image)
    expect(nd.items).toHaveLength(10);
    for (const it of nd.items) expect(Listing.safeParse(it).success).toBe(true);
  });

  it('normalises one item exactly', () => {
    const a = nd.items.find((i) => i.id === 'N11111111A')!;
    expect(a).toEqual({
      id: 'N11111111A',
      title: 'Brand Alpha Niacinamide 10% + Zinc 1% Serum 30ml',
      brand: 'Brand Alpha',
      url: 'https://www.noon.com/uae-en/brand-alpha-niacinamide-10--zinc-1-serum-30ml/N11111111A/p/',
      image: 'https://f.nooncdn.com/p/v1700000000/N11111111A_1.jpg',
      price_aed: 35,
      original_price_aed: 42,
      rating: 4.6,
      rating_count: 5210,
      in_stock: true,
    });
  });

  it('reads stock and missing ratings', () => {
    expect(nd.items.find((i) => i.id === 'N88888888A')!.in_stock).toBe(false);
    const noRating = nd.items.find((i) => i.id === 'N44444444A')!;
    expect(noRating.rating).toBeNull();
    expect(noRating.price_aed).toBe(29);
  });

  it('reads app-router flight data split across chunks', () => {
    const fl = parseNoonSearch(fx('SYNTHETIC-flight-niacinamide.html'));
    expect(fl.source).toBe('flight');
    expect(fl.items.map((i) => i.id).sort()).toEqual(nd.items.map((i) => i.id).sort());
  });

  it('reads a bare JSON string (WebView may send just the JSON)', () => {
    const html = fx('SYNTHETIC-next-data-niacinamide.html');
    const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)![1]!;
    const r = parseNoonSearch(json);
    expect(r.source).toBe('json');
    expect(r.items).toHaveLength(10);
  });

  it('falls back to strict HTML tiles', () => {
    const r = parseNoonSearch(fx('SYNTHETIC-tiles.html'));
    expect(r.source).toBe('html');
    expect(r.items.map((i) => [i.id, i.price_aed])).toEqual([
      ['N11111111A', 35],
      ['N44444444A', 1029.5],
    ]);
    expect(r.items[0]!.url).toBe('https://www.noon.com/uae-en/niacinamide-10-zinc-1-serum/N11111111A/p/?o=abc');
  });

  it('spots a block page', () => {
    const r = parseNoonSearch(fx('SYNTHETIC-blocked.html'));
    expect(r.items).toHaveLength(0);
    expect(r.challenge).toBe(true);
  });

  it('rejects links that are not noon', () => {
    const r = parseNoonSearch(
      JSON.stringify({ hits: [{ sku: 'N12345678A', name: 'x serum', price: 10, url: 'https://evil.example/p', image_key: 'k' }] }),
    );
    expect(r.items).toHaveLength(0);
  });
});

describe('listing filter', () => {
  const items = parseNoonSearch(fx('SYNTHETIC-next-data-niacinamide.html')).items;
  const opts = { budget: 50, avoidTerms: ['fragrance'], category: 'niacinamide serum' };
  const reason = (id: string) => dropReason(items.find((i) => i.id === id)!, opts);

  it('applies each hard rule', () => {
    expect(reason('N11111111A')).toBeNull();
    expect(reason('N22222222A')).toBe('over_budget');
    expect(reason('N33333333A')).toBe('low_rating');
    expect(reason('N44444444A')).toBeNull(); // no rating is allowed
    expect(reason('N55555555A')).toBe('bundle');
    expect(reason('N66666666A')).toBe('avoided_ingredient');
    expect(reason('N77777777A')).toBeNull(); // "Fragrance-Free" is fine
    expect(reason('N88888888A')).toBe('out_of_stock');
    expect(reason('N12121212A')).toBeNull(); // "Pack of 1" is a single unit
  });

  it('keeps budget inclusive', () => {
    expect(dropReason({ ...items[0]!, price_aed: 50 }, opts)).toBeNull();
    expect(dropReason({ ...items[0]!, price_aed: 50.01 }, opts)).toBe('over_budget');
  });

  it('drops the same product from a second seller and keeps noon order', () => {
    expect(filterListings(items, opts).map((i) => i.id)).toEqual(['N11111111A', 'N44444444A', 'N77777777A', 'N12121212A']);
  });

  it('allows a bundle only when the product type is a set', () => {
    expect(dropReason(items.find((i) => i.id === 'N55555555A')!, { ...opts, category: 'serum set' })).toBeNull();
  });

  it('tops up from backup, then relaxes the rating rule', () => {
    const main = items.filter((i) => ['N11111111A', 'N33333333A'].includes(i.id));
    const noBackup = buildCandidates(main, null, opts);
    expect(noBackup.relaxedRating).toBe(true);
    expect(noBackup.candidates.map((i) => i.id)).toEqual(['N11111111A', 'N33333333A']);

    const backup = items.filter((i) => ['N44444444A', 'N77777777A'].includes(i.id));
    const withBackup = buildCandidates(main, backup, opts);
    expect(withBackup.usedBackup).toBe(true);
    expect(withBackup.relaxedRating).toBe(false);
    expect(withBackup.candidates.map((i) => i.id)).toEqual(['N11111111A', 'N44444444A', 'N77777777A']);
  });
});

describe('real noon page (2026-11): JSON-LD + productBox cards', () => {
  const real = parseNoonSearch(fx('real-product-page-niacinamide.html'));

  it('reads the schema.org Product block exactly', () => {
    expect(real.source).toBe('jsonld');
    expect(real.challenge).toBe(false);
    expect(real.items).toEqual([
      {
        id: 'N35159878A',
        title: 'Niacinamide 10% Zinc 1% Face Serum 60ml',
        brand: 'The Ordinary',
        url: 'https://www.noon.com/uae-en/niacinamide-10-zinc-1-face-serum-60ml/N35159878A/p/',
        image:
          'https://f.nooncdn.com/p/fb889ec50f784103a85817c4c97eadd1|pzsku/ZB63AB6A5927414764443Z/45/1771237772/2da0ef53-254f-4f91-b9c7-90c66df9e665.jpg?width=400',
        price_aed: 45,
        original_price_aed: 113,
        rating: 4.2,
        rating_count: 815,
        in_stock: true,
      },
    ]);
    for (const it of real.items) expect(Listing.safeParse(it).success).toBe(true);
  });

  it('skips real cards that have no image inside them (never guesses one)', () => {
    // The page also has 3 related-product cards (incl. a Z…Z SKU) with price + title but no image.
    expect(real.items.map((i) => i.id)).not.toContain('N70099651V');
  });

  it('passes the hard filter at 50 AED and fails it at 40 AED', () => {
    const opts = { avoidTerms: ['fragrance'], category: 'niacinamide serum' };
    expect(dropReason(real.items[0]!, { ...opts, budget: 50 })).toBeNull();
    expect(dropReason(real.items[0]!, { ...opts, budget: 40 })).toBe('over_budget');
  });

  // SYNTHETIC: the real card markup from the page above, with an image, rating and
  // old price added the way a search-results card would carry them.
  const card = (sku: string, slug: string, price: string, title: string, extra = '') =>
    `<a id="productBox-${sku}" href="https://www.noon.com/uae-en/${slug}/${sku}/p/?o=abc" class="_productLink_1jroc_14">` +
    `<div class="_imageCtr_9xk2"><img src="https://f.nooncdn.com/p/pzsku/${sku}/45/1/x.jpg?width=800" alt="${title}"></div>` +
    `<div class="_priceCtr_1jroc_36"><div class="_container_1kuur_1"><div class="_sellingPrice_1kuur_11">` +
    `<span class="_currency_1kuur_22 _isCurrencySymbol_1kuur_19"></span><strong class="_productPrice_1kuur_26">${price}</strong>` +
    `</div>${extra}</div></div><p class="_productTitle_1jroc_23">${title}</p></a>`;

  it('reads search-style cards in page order, with optional rating and old price', () => {
    const html =
      card('N70099651V', 'rice-toner', '69.90', 'Anua Rice 70 Glow Milky Toner 250ml', '<span class="_oldPrice_1kuur_30">1,099.00</span><div class="_rating_77x_1">4.6</div><span>(2.3K)</span>') +
      card('Z8E6F1415BFF0A8DC3C94Z', 'niacinamide-serum', '29', 'Niacinamide Serum 30ml');
    const r = parseNoonSearch(html);
    expect(r.source).toBe('cards');
    expect(r.items.map((i) => [i.id, i.price_aed, i.original_price_aed, i.rating, i.rating_count])).toEqual([
      ['N70099651V', 69.9, 1099, 4.6, 2300],
      ['Z8E6F1415BFF0A8DC3C94Z', 29, null, null, null],
    ]);
    expect(r.items[0]!.image).toBe('https://f.nooncdn.com/p/pzsku/N70099651V/45/1/x.jpg?width=400');
    expect(r.items[1]!.url).toBe('https://www.noon.com/uae-en/niacinamide-serum/Z8E6F1415BFF0A8DC3C94Z/p/?o=abc');
  });

  it('prefers JSON-LD fields but keeps the cards’ page order', () => {
    const ld = fx('real-product-page-niacinamide.html').match(/<script[^>]*ld\+json[^>]*>[^<]*"@type":"Product"[\s\S]*?<\/script>/)![0];
    const html = ld + card('N70099651V', 'rice-toner', '69.90', 'Anua Rice Toner') + card('N35159878A', 'niacinamide-10-zinc-1-face-serum-60ml', '44.00', 'The Ordinary Niacinamide');
    const r = parseNoonSearch(html);
    expect(r.items.map((i) => i.id)).toEqual(['N70099651V', 'N35159878A']);
    expect(r.items[1]!.price_aed).toBe(45); // JSON-LD wins over the card
    expect(r.items[1]!.rating_count).toBe(815);
  });

  it('reads an ItemList, skips other currencies, maps stock and rating scale', () => {
    const p = (sku: string, extra: object) => ({
      '@type': 'Product',
      sku,
      name: `Serum ${sku}`,
      image: { '@type': 'ImageObject', url: `https://f.nooncdn.com/p/${sku}.jpg` },
      offers: { '@type': 'Offer', url: `https://www.noon.com/uae-en/serum/${sku}/p/`, price: '25.50', priceCurrency: 'AED', availability: 'https://schema.org/InStock' },
      ...extra,
    });
    const list = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: p('N11111111A', { aggregateRating: { ratingValue: 9, bestRating: 10, reviewCount: 40 } }) },
        { '@type': 'ListItem', position: 2, item: p('N22222222A', { offers: { price: 20, priceCurrency: 'SAR', url: 'https://www.noon.com/saudi-en/x/N22222222A/p/' } }) },
        { '@type': 'ListItem', position: 3, item: p('N33333333A', { offers: { price: 20, priceCurrency: 'AED', url: 'https://www.noon.com/uae-en/x/N33333333A/p/', availability: 'https://schema.org/OutOfStock' } }) },
      ],
    };
    const r = parseNoonSearch(`<script type="application/ld+json">${JSON.stringify(list)}</script>`);
    expect(r.items.map((i) => [i.id, i.price_aed, i.rating, i.in_stock])).toEqual([
      ['N11111111A', 25.5, 4.5, true],
      ['N33333333A', 20, null, false],
    ]);
  });
});
