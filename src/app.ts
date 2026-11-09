import { httpInstrumentationMiddleware } from '@hono/otel';
import { swaggerUI } from '@hono/swagger-ui';
import { bodyLimit } from 'hono/body-limit';
import type { ApplyGlobalResponse } from 'hono/client';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { createRequireAuth } from './features/auth/middleware.ts';
import { createAuthRouter } from './features/auth/routes.ts';
import { createHealthRouter } from './features/health/routes.ts';
import { createNotesRouter } from './features/notes/routes.ts';
import { createErrorHandler, respond } from './platform/error-handler.ts';
import type { Logger } from './platform/logger.ts';
import { ProblemError, type ProblemResponses } from './platform/problem.ts';
import { rateLimit } from './platform/rate-limit.ts';
import { createRouter } from './platform/router.ts';

const maxBodyBytes = 100 * 1024;

const corsExposedHeaders = [
  'ETag',
  'Location',
  'X-Request-Id',
  'Retry-After',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Idempotency-Replayed',
];

interface AppDependencies {
  config: Config;
  db: Db;
  logger: Logger;
}

export function createApp({ config, db, logger }: AppDependencies) {
  const app = createRouter();
  const trustedProxyHops = config.TRUST_PROXY_HOPS;

  app.use(httpInstrumentationMiddleware());
  app.use(requestId());
  app.use(async (c, next) => {
    const startedAt = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      'Request completed',
    );
  });
  app.use(secureHeaders());
  if (config.CORS_ORIGINS.length > 0) {
    app.use('/v1/*', cors({ origin: config.CORS_ORIGINS, exposeHeaders: corsExposedHeaders }));
  }
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: () => {
        throw new ProblemError(
          'payload-too-large',
          `The request body is over the ${maxBodyBytes}-byte limit.`,
        );
      },
    }),
  );
  app.use(
    '/v1/*',
    rateLimit({ db, name: 'global', limit: config.RATE_LIMIT_PER_MINUTE, trustedProxyHops }),
  );

  const authRateLimit = rateLimit({
    db,
    name: 'auth',
    limit: config.AUTH_RATE_LIMIT_PER_MINUTE,
    trustedProxyHops,
  });
  const requireAuth = createRequireAuth(db);

  const routes = app
    .route('/', createHealthRouter(db))
    .route(
      '/v1',
      createAuthRouter({
        db,
        requireAuth,
        authRateLimit,
        sessionTtlHours: config.SESSION_TTL_HOURS,
      }),
    )
    .route('/v1', createNotesRouter({ db, requireAuth }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'API Hono starter', version: '1.0.0' },
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  app.notFound((c) =>
    respond(c, new ProblemError('not-found', `No route matches ${c.req.method} ${c.req.path}.`)),
  );
  app.onError(createErrorHandler(logger));

  return routes;
}

export type AppType = ApplyGlobalResponse<ReturnType<typeof createApp>, ProblemResponses>;
