// Typed client for the Worker. Every shape comes from @skinfix/shared and every
// response is validated before the UI sees it.

import {
  AnalyzeResponse,
  ClarifyResponse,
  ErrorResponse,
  HEADERS,
  ProductsResponse,
  type AnalyzeRequest,
  type ClarifyRequest,
  type ProductsRequest,
} from '@skinfix/shared';
import { getDeviceId, getInvite } from './secure';

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export type ApiErrorKind = 'network' | 'timeout' | 'server' | 'rate_limited' | 'unauthorized' | 'bad_request';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string = kind,
  ) {
    super(message);
  }
}

/** i18n key for an error, used by every error state. */
export function errorKey(e: unknown): string {
  const k = e instanceof ApiError ? e.kind : 'server';
  return {
    network: 'errors.network',
    timeout: 'errors.timeout',
    server: 'errors.server',
    rate_limited: 'errors.rateLimited',
    unauthorized: 'errors.unauthorized',
    bad_request: 'errors.server',
  }[k];
}

async function post<T>(
  path: string,
  body: unknown,
  parse: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  timeoutMs: number,
  inviteOverride?: string,
): Promise<T> {
  const [invite, device] = await Promise.all([inviteOverride ?? getInvite(), getDeviceId()]);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HEADERS.invite]: invite ?? '',
        [HEADERS.device]: device,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ApiError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('server');
  }
  if (!res.ok) {
    const err = ErrorResponse.safeParse(json);
    const code = err.success ? err.data.error : 'internal';
    if (res.status === 401 || code === 'unauthorized') throw new ApiError('unauthorized');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status === 504) throw new ApiError('timeout');
    if (res.status === 400) throw new ApiError('bad_request');
    throw new ApiError('server');
  }
  const parsed = parse.safeParse(json);
  if (!parsed.success) throw new ApiError('server', 'response failed validation');
  return parsed.data;
}

const Ok = { safeParse: (v: unknown) => ({ success: true as const, data: v }) };

export const api = {
  verify: (code: string) => post('/verify', {}, Ok, 15_000, code.trim()),
  analyze: (req: AnalyzeRequest) => post('/analyze', req, AnalyzeResponse, 45_000),
  clarify: (req: ClarifyRequest) => post('/clarify', req, ClarifyResponse, 30_000),
  products: (req: ProductsRequest) => post('/products', req, ProductsResponse, 40_000),
};
