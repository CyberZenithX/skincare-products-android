import { Hono, type Context } from 'hono';
import {
  AnalyzeRequest,
  ClarifyRequest,
  ProductsRequest,
  SkinProfile,
  ClarifyResponse,
  ProductsResponse,
  HEADERS,
  noonSearchUrl,
  type ErrorResponse,
} from '@skinfix/shared';
import type { Env } from './env';
import { analyze, finish } from './analyze';
import { clarify, MAX_CLUES } from './clarify';
import { products, fetchNoon } from './products';
import { parseNoonSearch } from './noon/parse';
import { AiError } from './gemini';
import { safeEqual, takeQuota } from './kv';
import mockAnalyze from '../mocks/analyze.json';
import mockUnusable from '../mocks/analyze-unusable.json';
import mockRedFlag from '../mocks/analyze-redflag.json';
import mockClarifyAsking from '../mocks/clarify-asking.json';
import mockClarifyTest from '../mocks/clarify-test.json';
import mockClarifyAnswered from '../mocks/clarify-answered.json';
import mockProducts from '../mocks/products.json';

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const fail = (c: Ctx, status: 400 | 401 | 429 | 502 | 504 | 500, error: ErrorResponse['error'], message: string) =>
  c.json<ErrorResponse>({ ok: false, error, message }, status);

// No request logging middleware on purpose: bodies hold face photos.

app.get('/health', (c) => c.json({ ok: true, mock: c.env.MOCK === '1', model: c.env.GEMINI_MODEL, store: c.env.store.kind }));

// Every other endpoint needs the invite code and a device id.
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next();
  const code = c.req.header(HEADERS.invite) ?? '';
  if (!c.env.INVITE_CODE || !safeEqual(code, c.env.INVITE_CODE)) return fail(c, 401, 'unauthorized', 'Invite code not recognised.');
  const device = c.req.header(HEADERS.device) ?? '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(device)) return fail(c, 400, 'bad_request', 'Missing device id.');
  return next();
});

// Lightweight invite check for the first-launch screen.
app.post('/verify', (c) => c.json({ ok: true }));

async function body<T>(c: Ctx, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }) {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return null;
  }
  const r = schema.safeParse(json);
  return r.success ? r.data : null;
}

function aiFail(c: Ctx, e: unknown) {
  if (e instanceof AiError) {
    if (e.kind === 'timeout') return fail(c, 504, 'ai_failed', 'The analysis took too long. Please try again.');
    return fail(c, 502, 'ai_failed', 'We could not finish the analysis. Please try again.');
  }
  console.error('internal error', (e as Error)?.message); // message only, never the request
  return fail(c, 500, 'internal', 'Something went wrong. Please try again.');
}

const scansPerDay = (env: Env) => Number(env.SCANS_PER_DAY ?? '20');
const OTHER_PER_DAY = 200;

app.post('/analyze', async (c) => {
  const req = await body(c, AnalyzeRequest);
  if (!req) return fail(c, 400, 'bad_request', 'The request was not complete.');
  if (!req.image_base64.startsWith('/9j/')) return fail(c, 400, 'bad_request', 'The photo must be a JPEG.');
  if (!(await takeQuota(c.env, c.req.header(HEADERS.device)!, 'scan', scansPerDay(c.env))))
    return fail(c, 429, 'rate_limited', 'You have reached today’s scan limit. Try again tomorrow.');

  if (c.env.MOCK === '1') {
    const v = c.req.query('mock');
    const raw = SkinProfile.parse(v === 'unusable' ? mockUnusable : v === 'redflag' ? mockRedFlag : mockAnalyze);
    return c.json(await finish(null, raw, req.answers, 'en'));
  }
  try {
    return c.json(await analyze(c.env, req));
  } catch (e) {
    return aiFail(c, e);
  }
});

app.post('/clarify', async (c) => {
  const req = await body(c, ClarifyRequest);
  if (!req) return fail(c, 400, 'bad_request', 'The request was not complete.');
  if (!(await takeQuota(c.env, c.req.header(HEADERS.device)!, 'other', OTHER_PER_DAY)))
    return fail(c, 429, 'rate_limited', 'You have reached today’s limit. Try again tomorrow.');

  if (c.env.MOCK === '1') {
    const clues = req.turns.filter((t) => t.kind === 'clue').length;
    const tested = req.turns.some((t) => t.kind === 'test');
    const must = req.force_answer || clues >= MAX_CLUES || tested;
    const mock = must ? mockClarifyAnswered : clues === 2 && req.question_id === 'skin_feel' ? mockClarifyTest : mockClarifyAsking;
    const r = ClarifyResponse.parse({ ...mock, clue_number: Math.min(clues + 1, MAX_CLUES + 1) });
    if (r.answer && req.question_id === 'reactivity') r.answer = { ...r.answer, value: 'sometimes', also_possible: 'rarely' };
    return c.json(r);
  }
  try {
    return c.json(await clarify(c.env, req));
  } catch (e) {
    return aiFail(c, e);
  }
});

app.post('/products', async (c) => {
  const req = await body(c, ProductsRequest);
  if (!req) return fail(c, 400, 'bad_request', 'The request was not complete.');
  if (!(await takeQuota(c.env, c.req.header(HEADERS.device)!, 'other', OTHER_PER_DAY)))
    return fail(c, 429, 'rate_limited', 'You have reached today’s limit. Try again tomorrow.');

  if (c.env.MOCK === '1') {
    const v = c.req.query('mock');
    const url = noonSearchUrl(req.product.noon_query);
    if (v === 'blocked' && !req.raw_pages)
      return c.json(ProductsResponse.parse({ status: 'blocked', queries: [req.product.noon_query, req.product.backup_query], search_url: url }));
    if (v === 'link' || req.link_fallback) return c.json(ProductsResponse.parse({ status: 'link', search_url: url }));
    return c.json(ProductsResponse.parse({ ...mockProducts, search_url: url, layer: req.raw_pages ? 'webview' : 'server' }));
  }
  try {
    return c.json(await products(c.env, req));
  } catch (e) {
    console.error('products error', (e as Error)?.message);
    return fail(c, 502, 'upstream_failed', 'Could not load products right now.');
  }
});

// Phase 1 check: does noon answer this backend? Reports counts only, never page bodies.
app.get('/probe', async (c) => {
  const q = c.req.query('q') ?? 'niacinamide serum';
  const started = Date.now();
  try {
    const r = await fetchNoon(q);
    const parsed = parseNoonSearch(r.text);
    return c.json({
      query: q,
      http_status: r.status,
      bytes: r.text.length,
      source: parsed.source,
      challenge: parsed.challenge,
      products: parsed.items.length,
      verdict: r.status === 200 && parsed.items.length > 0 ? 'works' : 'blocked',
      sample: parsed.items.slice(0, 3).map((i) => ({ title: i.title, price_aed: i.price_aed, url: i.url })),
      ms: Date.now() - started,
    });
  } catch (e) {
    return c.json({ query: q, verdict: 'blocked', error: (e as Error)?.name ?? 'error', ms: Date.now() - started });
  }
});

app.notFound((c) => fail(c, 400, 'bad_request', 'Unknown endpoint.'));
app.onError((e, c) => aiFail(c, e));

export default app;
