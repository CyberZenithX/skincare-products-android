import type { Env } from './env';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Per-device daily counter. KV isn't atomic, so two simultaneous calls can both
 * pass at the limit; that's fine for a cost guard of this size.
 */
export async function takeQuota(env: Env, device: string, bucket: 'scan' | 'other', limit: number): Promise<boolean> {
  const key = `rl:${bucket}:${today()}:${device}`;
  const n = Number((await env.KV.get(key)) ?? '0');
  if (n >= limit) return false;
  await env.KV.put(key, String(n + 1), { expirationTtl: 60 * 60 * 48 });
  return true;
}

export async function bumpLayer(env: Env, layer: 'worker' | 'webview' | 'link' | 'blocked'): Promise<void> {
  const key = `layer:${today()}:${layer}`;
  const n = Number((await env.KV.get(key)) ?? '0');
  await env.KV.put(key, String(n + 1), { expirationTtl: 60 * 60 * 24 * 90 });
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare for the invite code. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
