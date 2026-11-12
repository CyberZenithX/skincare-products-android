import type { Env } from '../src/env';
import { MemoryStore } from '../src/store';

export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    GEMINI_API_KEY: 'test',
    INVITE_CODE: 'letmein',
    GEMINI_MODEL: 'test-model',
    MOCK: '1',
    store: new MemoryStore(),
    ...over,
  };
}

/** A tiny but valid JPEG-looking base64 (starts with /9j/, long enough for the schema). */
export const FAKE_JPEG = '/9j/' + 'A'.repeat(2000);

export const ANSWERS = {
  skin_feel: { value: null, source: 'unsure', confidence: 'low', also_possible: null },
  reactivity: { value: 'rarely', source: 'user', confidence: 'high', also_possible: null },
  main_bother: null,
  avoid: ['fragrance'],
  avoid_other: '',
  conditions: ['none'],
  budget_aed: 50,
};

export const headers = { 'content-type': 'application/json', 'x-invite-code': 'letmein', 'x-device-id': 'device-1234' };
