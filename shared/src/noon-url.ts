/** The one place the noon search URL is built (backend fetch, WebView fallback, "See more" link). */
export function noonSearchUrl(query: string): string {
  return `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(query.trim())}`;
}
