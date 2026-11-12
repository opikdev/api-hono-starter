import { httpInstrumentationMiddleware } from '@hono/otel';
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
import { mountApiDocs } from './platform/api-docs.ts';
import { crossOriginProtection } from './platform/cross-origin.ts';
import { createErrorHandler, respond } from './platform/error-handler.ts';
import type { Logger } from './platform/logger.ts';
import { describeApi } from './platform/openapi.ts';
import { ProblemError, type ProblemResponses } from './platform/problem.ts';
import { project } from './platform/project.ts';
import { loginFailureLimit, rateLimit } from './platform/rate-limit.ts';
import { createRouter } from './platform/router.ts';
import type { Readiness } from './platform/shutdown.ts';

const maxBodyBytes = 100 * 1024;
const healthPaths = new Set(['/healthz', '/readyz']);
const apiContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

const corsExposedHeaders = [
  'ETag',
  'Location',
  'X-Request-Id',
  'Retry-After',
  'RateLimit',
  'RateLimit-Policy',
  'Idempotency-Replayed',
];

interface AppDependencies {
  config: Config;
  db: Db;
  logger: Logger;
  readiness?: Readiness;
}

export function createApp({
  config,
  db,
  logger,
  readiness = { draining: false },
}: AppDependencies) {
  const app = createRouter();
  const trustedProxyHops = config.TRUST_PROXY_HOPS;

  const instrumentation = httpInstrumentationMiddleware();
  app.use((c, next) => (healthPaths.has(c.req.path) ? next() : instrumentation(c, next)));
  app.use(requestId());
  app.use(async (c, next) => {
    const startedAt = performance.now();
    await next();
    const level = healthPaths.has(c.req.path) ? 'debug' : 'info';
    logger[level](
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
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has('Content-Security-Policy')) {
      c.header('Content-Security-Policy', apiContentSecurityPolicy);
    }
  });
  if (config.CORS_ORIGINS.length > 0) {
    app.use('/v1/*', cors({ origin: config.CORS_ORIGINS, exposeHeaders: corsExposedHeaders }));
  }
  app.use('/v1/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.use('/v1/*', crossOriginProtection(config.CORS_ORIGINS));
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
  const loginFailures = loginFailureLimit({
    db,
    limit: config.LOGIN_FAILURE_LIMIT,
    windowSeconds: config.LOGIN_FAILURE_WINDOW_SECONDS,
  });
  const requireAuth = createRequireAuth(db);

  const routes = app
    .route('/', createHealthRouter(db, readiness))
    .route(
      '/v1',
      createAuthRouter({
        db,
        requireAuth,
        authRateLimit,
        loginFailures,
        sessionTtlHours: config.SESSION_TTL_HOURS,
      }),
    )
    .route('/v1', createNotesRouter({ db, requireAuth }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: '__Host-session',
  });
  if (config.DOCS_ENABLED) {
    const document = describeApi(app, { title: project.name, version: project.version });
    app.get('/openapi.json', (c) => c.json(document));
    mountApiDocs(app, project.name);
  }

  app.notFound((c) =>
    respond(c, new ProblemError('not-found', `No route matches ${c.req.method} ${c.req.path}.`)),
  );
  app.onError(createErrorHandler(logger));

  return routes;
}

export type AppType = ApplyGlobalResponse<ReturnType<typeof createApp>, ProblemResponses>;
