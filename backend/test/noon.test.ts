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
