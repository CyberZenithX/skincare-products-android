import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { AnalyzeResponse, ClarifyResponse, ProductsResponse } from '@skinfix/shared';
import { ANSWERS, FAKE_JPEG, headers, makeEnv } from './helpers';
import { toGeminiSchema } from '../src/gemini';
import { SkinProfile } from '@skinfix/shared';
import { checkProfile } from '../src/analyze';
import mock from '../mocks/analyze.json';

const post = (path: string, body: unknown, env = makeEnv(), h: Record<string, string> = headers) =>
  app.request(path, { method: 'POST', headers: h, body: JSON.stringify(body) }, env);

describe('auth and limits', () => {
  it('rejects a wrong invite code', async () => {
    const r = await post('/analyze', {}, makeEnv(), { ...headers, 'x-invite-code': 'nope' });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('rejects a missing device id', async () => {
    const { 'x-device-id': _, ...h } = headers;
    expect((await post('/analyze', {}, makeEnv(), h)).status).toBe(400);
  });

  it('rejects a malformed body with a clean error', async () => {
    const r = await post('/analyze', { image_base64: 'x' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, error: 'bad_request' });
  });

  it('limits scans per device per day', async () => {
    const env = makeEnv({ SCANS_PER_DAY: '2' });
    const b = { image_base64: FAKE_JPEG, answers: ANSWERS, language: 'en' };
    expect((await post('/analyze', b, env)).status).toBe(200);
    expect((await post('/analyze', b, env)).status).toBe(200);
    expect((await post('/analyze', b, env)).status).toBe(429);
    // A different device still works.
    expect((await post('/analyze', b, env, { ...headers, 'x-device-id': 'device-9999' })).status).toBe(200);
  });
});

describe('MOCK=1', () => {
  it('/analyze returns a schema-valid response with safety rules applied', async () => {
    const r = await post('/analyze', { image_base64: FAKE_JPEG, answers: ANSWERS, language: 'en' });
    const body = AnalyzeResponse.parse(await r.json());
    expect(body.profile.sensitivity).toBe('low'); // user said "rarely" → overrides the mock's "medium"
    expect(body.avoid_terms).toEqual(['fragrance']);
    expect(body.profile.products.find((p) => /salicylic/.test(p.category))!.patch_test).toBe(true);
  });

  it('/analyze unusable and red-flag variants', async () => {
    const u = AnalyzeResponse.parse(await (await app.request('/analyze?mock=unusable', { method: 'POST', headers, body: JSON.stringify({ image_base64: FAKE_JPEG, answers: ANSWERS, language: 'en' }) }, makeEnv())).json());
    expect(u.profile.photo_quality.usable).toBe(false);
    expect(u.profile.products).toEqual([]);
    const f = AnalyzeResponse.parse(await (await app.request('/analyze?mock=redflag', { method: 'POST', headers, body: JSON.stringify({ image_base64: FAKE_JPEG, answers: ANSWERS, language: 'en' }) }, makeEnv())).json());
    expect(f.profile.red_flags).toHaveLength(1);
  });

  it('/clarify always lands on an answer within 3 clues, even with all "Not sure"', async () => {
    const turns: { kind: 'clue' | 'test'; asked: string; answered: string }[] = [];
    let res: ClarifyResponse | null = null;
    for (let i = 0; i < 6; i++) {
      res = ClarifyResponse.parse(await (await post('/clarify', { question_id: 'skin_feel', image_base64: FAKE_JPEG, turns, language: 'en' })).json());
      if (res.status === 'answered') break;
      if (res.status === 'suggest_test') turns.push({ kind: 'test', asked: res.test!.name, answered: 'skipped' });
      else turns.push({ kind: 'clue', asked: res.message, answered: 'Not sure' });
    }
    expect(res!.status).toBe('answered');
    expect(turns.filter((t) => t.kind === 'clue').length).toBeLessThanOrEqual(3);
  });

  it('/products returns ok, blocked and link variants', async () => {
    const product = mock.products[0];
    const b = { product, budget_aed: 50, avoid_terms: [], language: 'en' };
    expect(ProductsResponse.parse(await (await post('/products', b)).json()).status).toBe('ok');
    const blocked = await app.request('/products?mock=blocked', { method: 'POST', headers, body: JSON.stringify(b) }, makeEnv());
    expect(ProductsResponse.parse(await blocked.json()).status).toBe('blocked');
    expect(ProductsResponse.parse(await (await post('/products', { ...b, link_fallback: true })).json()).status).toBe('link');
  });
});

describe('Gemini plumbing', () => {
  it('turns the zod schema into the subset Gemini accepts', () => {
    const s = JSON.stringify(toGeminiSchema(SkinProfile));
    expect(s).not.toContain('$schema');
    expect(s).not.toContain('maxLength');
    expect(s).toContain('"enum":["oily","dry","combination","normal"]');
    expect(s).toContain('propertyOrdering');
  });

  it('semantic checks catch inconsistent output', () => {
    const p = SkinProfile.parse(mock);
    expect(checkProfile(p)).toBeNull();
    expect(checkProfile({ ...p, products: [] })).toMatch(/1 or 2 products/);
    expect(checkProfile({ ...p, photo_quality: { usable: false, issue: 'none', tip: '' } })).toMatch(/issue/);
    expect(checkProfile({ ...p, confidence: 'low', also_possible: [], how_to_confirm: '' })).toMatch(/not certain/);
  });
});
