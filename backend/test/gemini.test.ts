import { afterEach, describe, expect, it, vi } from 'vitest';
import { callGemini, generateJson, AiError } from '../src/gemini';
import { z } from '@skinfix/shared';
import { makeEnv } from './helpers';

// Capture the HTTP request the SDK sends, and answer like Gemini would.
function stubFetch(reply: unknown = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) {
  const bodies: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return bodies;
}
afterEach(() => vi.unstubAllGlobals());

describe('thinking config on the wire', () => {
  it('sends thinkingLevel for Gemini 3 models (default low)', async () => {
    const bodies = stubFetch();
    await callGemini(makeEnv({ GEMINI_MODEL: 'gemini-3.8-flash' }), { parts: [{ text: 'hi' }] });
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(bodies[0].generationConfig.temperature).toBe(0.2);
  });

  it('follows GEMINI_THINKING and per-call overrides', async () => {
    const bodies = stubFetch();
    const env = makeEnv({ GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING: 'medium' });
    await callGemini(env, { parts: [{ text: 'hi' }] });
    await callGemini(env, { parts: [{ text: 'hi' }], thinking: 'minimal' });
    await callGemini(env, { parts: [{ text: 'hi' }], thinking: 'default' });
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(bodies[1].generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
  });

  it('sends a token budget for Gemini 2.x models', async () => {
    const bodies = stubFetch();
    await callGemini(makeEnv({ GEMINI_MODEL: 'gemini-2.5-flash' }), { parts: [{ text: 'hi' }], thinking: 'minimal' });
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

describe('errors and deadlines', () => {
  it('reports why an empty answer came back', async () => {
    stubFetch({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] });
    const e = await callGemini(makeEnv(), { parts: [{ text: 'hi' }] }).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.detail).toContain('SAFETY');
  });

  it('gives up as a timeout when the deadline leaves no time for a retry', async () => {
    stubFetch({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
    const e = await generateJson(makeEnv(), {
      system: 's',
      parts: [{ text: 'hi' }],
      schema: z.object({ a: z.number() }),
      deadline: Date.now() + 4_000,
    }).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.kind).toBe('timeout');
  });
});
