import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

/**
 * Better Auth's own endpoints. The handler is resolved per request rather than at module
 * scope so that `next build` — which imports every route module and has no database —
 * does not try to construct the auth instance.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}
