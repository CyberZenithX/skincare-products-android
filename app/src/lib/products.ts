// The three-layer listing lookup, driven from the app:
//   1. ask the Worker (it fetches noon itself, or answers from cache)
//   2. if it says "blocked", load both searches in the hidden WebView and send the pages
//   3. if that fails too, tell the Worker (counter) and show a plain noon search link

import { noonSearchUrl, type AnalyzeResponse, type Language } from '@skinfix/shared';
import { api } from './api';
import type { ListingState } from './scanStore';

export async function loadListings(
  result: AnalyzeResponse,
  index: number,
  language: Language,
  budget: number,
  fetchPage: (q: string) => Promise<string | null>,
): Promise<ListingState> {
  const product = result.profile.products[index]!;
  const base = { product, budget_aed: budget, avoid_terms: result.avoid_terms, language };
  const fallbackUrl = noonSearchUrl(product.noon_query);
  try {
    const first = await api.products(base);
    if (first.status === 'ok') return { state: 'ok', listings: first.listings, search_url: first.search_url };
    if (first.status === 'link') return { state: 'link', search_url: first.search_url };

    // Layer 2
    const pages: { query: string; page: string }[] = [];
    for (const q of first.queries) {
      const page = await fetchPage(q);
      if (page) pages.push({ query: q, page });
    }
    if (pages.length) {
      const second = await api.products({ ...base, raw_pages: pages });
      if (second.status === 'ok') return { state: 'ok', listings: second.listings, search_url: second.search_url };
      return { state: 'link', search_url: second.search_url };
    }

    // Layer 3
    await api.products({ ...base, link_fallback: true }).catch(() => undefined);
    return { state: 'link', search_url: first.search_url };
  } catch {
    return { state: 'error', search_url: fallbackUrl };
  }
}
