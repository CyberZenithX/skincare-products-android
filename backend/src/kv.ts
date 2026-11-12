import type { Env } from './env';

const today = () => new Date().toISOString().slice(0, 10);

/** Per-device daily counter (atomic INCR in Redis). */
export async function takeQuota(env: Env, device: string, bucket: 'scan' | 'other', limit: number): Promise<boolean> {
  const n = await env.store.incr(`rl:${bucket}:${today()}:${device}`, 60 * 60 * 48);
  return n <= limit;
}

/** Which lookup layer served a request, per day, so we can see if blocks become common. */
export async function bumpLayer(env: Env, layer: 'server' | 'webview' | 'link' | 'blocked'): Promise<void> {
  await env.store.incr(`layer:${today()}:${layer}`, 60 * 60 * 24 * 90);
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
