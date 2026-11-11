import { createMiddleware } from 'hono/factory';
import { ProblemError } from './problem.ts';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const sameOriginFetchSites = new Set(['same-origin', 'none']);

function isAllowed(
  method: string,
  headers: Record<'origin' | 'secFetchSite' | 'host', string | undefined>,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  if (safeMethods.has(method)) return true;
  if (headers.origin !== undefined && trustedOrigins.has(headers.origin)) return true;
  if (headers.secFetchSite !== undefined) return sameOriginFetchSites.has(headers.secFetchSite);
  if (headers.origin === undefined) return true;
  const originHost = URL.parse(headers.origin)?.host;
  return originHost !== undefined && originHost === headers.host;
}

export function crossOriginProtection(trustedOrigins: string[]) {
  const trusted = new Set(trustedOrigins);
  return createMiddleware(async (c, next) => {
    const headers = {
      origin: c.req.header('origin'),
      secFetchSite: c.req.header('sec-fetch-site'),
      host: c.req.header('host'),
    };
    if (!isAllowed(c.req.method, headers, trusted)) {
      throw new ProblemError(
        'forbidden',
        'Cross-origin requests that change data are blocked. Send the request from the same origin, or add the origin to CORS_ORIGINS.',
      );
    }
    await next();
  });
}
