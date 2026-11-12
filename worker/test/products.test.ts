import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ProductsRequest } from '@skinfix/shared';
import { products, type FetchPage, type Picker } from '../src/products';
import { makeEnv } from './helpers';

const page = readFileSync(new URL('../../fixtures/noon/SYNTHETIC-next-data-niacinamide.html', import.meta.url), 'utf8');
const blocked = readFileSync(new URL('../../fixtures/noon/SYNTHETIC-blocked.html', import.meta.url), 'utf8');

const req: ProductsRequest = {
  product: {
    category: 'niacinamide serum',
    why: '',
    key_ingredients: ['niacinamide'],
    avoid_ingredients: ['fragrance'],
    how_to_use: '',
    patch_test: false,
    noon_query: 'niacinamide serum',
    backup_query: 'face serum oily skin',
  },
  budget_aed: 50,
  avoid_terms: ['fragrance'],
  language: 'en',
};

// Deterministic picker: first 3 candidates, so we test the pipeline, not the model.
const pick: Picker = async (_e, _r, c) => c.slice(0, 3).map((x) => ({ ...x, reason: 'test' }));

describe('products pipeline', () => {
  it('Layer 1: fetches, filters, picks 3 under budget, then serves from cache', async () => {
    const env = makeEnv({ MOCK: '0' });
    let calls = 0;
    const fetchPage: FetchPage = async () => {
      calls++;
      return { status: 200, text: page };
    };
    const r = await products(env, req, { fetchPage, pick });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.layer).toBe('worker');
    expect(r.listings).toHaveLength(3);
    for (const l of r.listings) {
      expect(l.price_aed).toBeLessThanOrEqual(50);
      expect(l.url.startsWith('https://www.noon.com/uae-en/')).toBe(true);
    }
    expect(calls).toBe(1);

    const again = await products(env, req, { fetchPage, pick });
    expect(again.status === 'ok' && again.cached).toBe(true);
    expect(calls).toBe(1); // served from KV
  });

  it('Layer 1: a block page returns blocked with both queries, no retry loop', async () => {
    const env = makeEnv({ MOCK: '0' });
    let calls = 0;
    const r = await products(env, req, {
      fetchPage: async () => {
        calls++;
        return { status: 200, text: blocked };
      },
      pick,
    });
    expect(r).toMatchObject({ status: 'blocked', queries: ['niacinamide serum', 'face serum oily skin'] });
    expect(calls).toBe(1);
  });

  it('Layer 1: non-200 and network errors count as blocked', async () => {
    const env = makeEnv({ MOCK: '0' });
    expect((await products(env, req, { fetchPage: async () => ({ status: 403, text: '' }), pick })).status).toBe('blocked');
    expect(
      (await products(env, req, { fetchPage: async () => Promise.reject(new Error('reset')), pick })).status,
    ).toBe('blocked');
  });

  it('Layer 2: a raw_page from the phone gives the same listings as Layer 1', async () => {
    const a = await products(makeEnv({ MOCK: '0' }), req, { fetchPage: async () => ({ status: 200, text: page }), pick });
    const b = await products(makeEnv({ MOCK: '0' }), { ...req, raw_pages: [{ query: 'niacinamide serum', page }] }, { pick });
    expect(b.status === 'ok' && b.layer).toBe('webview');
    expect(b.status === 'ok' && b.listings).toEqual(a.status === 'ok' && a.listings);
  });

  it('Layer 2: unreadable pages fall back to the search link', async () => {
    const r = await products(makeEnv({ MOCK: '0' }), { ...req, raw_pages: [{ query: 'niacinamide serum', page: blocked }] }, { pick });
    expect(r).toEqual({ status: 'link', search_url: 'https://www.noon.com/uae-en/search/?q=niacinamide%20serum' });
  });

  it('cache key separates different avoid lists', async () => {
    const env = makeEnv({ MOCK: '0' });
    const fetchPage: FetchPage = async () => ({ status: 200, text: page });
    await products(env, req, { fetchPage, pick });
    const other = await products(env, { ...req, avoid_terms: [] }, { fetchPage, pick });
    expect(other.status === 'ok' && other.cached).toBe(false);
  });

  it('only returns ids the picker chose from the candidates', async () => {
    const r = await products(makeEnv({ MOCK: '0' }), req, {
      fetchPage: async () => ({ status: 200, text: page }),
      pick: async (_e, _r, c) => [{ ...c[1]!, reason: 'x' }],
    });
    expect(r.status === 'ok' && r.listings.map((l) => l.id)).toEqual(['N44444444A']);
  });
});
