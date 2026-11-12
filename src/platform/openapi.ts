import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  type ProblemStatus,
  problemCatalog,
  problemResponseNames,
  problemResponseRef,
  problemSchema,
} from './problem.ts';
import type { AppEnv } from './router.ts';

const headers = {
  'X-Request-Id': {
    description: 'Identifies the request. Quote it when you report a problem.',
    schema: { type: 'string', example: '0b5f7c1e-6a0f-4b8e-9d3c-2f1a7e4b9c10' },
  },
  'Cache-Control': {
    description: '`no-store` on every `/v1` response.',
    schema: { type: 'string', example: 'no-store' },
  },
  RateLimit: {
    description:
      'Sent on every `/v1` response. The quota left in each policy, `r`, and the seconds until it resets, `t`, per draft-ietf-httpapi-ratelimit-headers. On a 429, only the policy that was exceeded.',
    schema: { type: 'string', example: '"global";r=238;t=25' },
  },
  'RateLimit-Policy': {
    description:
      'Sent on every `/v1` response. Each policy that applies, with its quota, `q`, and window in seconds, `w`.',
    schema: { type: 'string', example: '"global";q=300;w=60, "auth";q=10;w=60' },
  },
  'Retry-After': {
    description: 'Seconds to wait before retrying.',
    schema: { type: 'integer', example: 25 },
  },
  ETag: {
    description: "The resource's version. Send it back in `If-Match` to update it.",
    schema: { type: 'string', example: '"1"' },
  },
  Location: {
    description: 'The URL of the created resource.',
    schema: { type: 'string', example: '/v1/notes/note_0190a7e4c1f07c3e8d21b6f4a9e05d13' },
  },
  'Idempotency-Replayed': {
    description:
      '`true` when the response replays an earlier request with the same `Idempotency-Key`.',
    schema: { type: 'string', example: 'true' },
  },
} as const;

type HeaderName = keyof typeof headers;

export function headerRefs(...names: HeaderName[]) {
  return Object.fromEntries(names.map((name) => [name, { $ref: `#/components/headers/${name}` }]));
}

const commonHeaders = ['X-Request-Id', 'Cache-Control', 'RateLimit', 'RateLimit-Policy'] as const;
const retryStatuses = new Set<number>([429, 503]);
const unsafeMethods = new Set(['post', 'put', 'patch', 'delete']);
const methods = new Set(['get', 'head', 'options', ...unsafeMethods]);

function registerComponents(app: OpenAPIHono<AppEnv>) {
  const registry = app.openAPIRegistry;
  registry.register('Problem', problemSchema);
  for (const [name, header] of Object.entries(headers)) {
    registry.registerComponent('headers', name, header);
  }
  const statuses = [...new Set(Object.values(problemCatalog).map(({ status }) => status))];
  for (const status of statuses) {
    const types = Object.entries(problemCatalog)
      .filter(([, problem]) => problem.status === status)
      .map(([slug]) => `\`urn:problem:${slug}\``);
    registry.registerComponent('responses', problemResponseNames[status], {
      description: `Problem Details with \`type\` ${types.join(' or ')}`,
      headers: headerRefs(
        ...commonHeaders,
        ...(retryStatuses.has(status) ? (['Retry-After'] as const) : []),
      ),
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
      },
    });
  }
}

interface Operation {
  requestBody?: unknown;
  responses: Record<string, { $ref?: string; headers?: Record<string, unknown> }>;
}

/** Adds the problems and headers that middleware returns, so routes declare only their own. */
function addMiddlewareResponses(path: string, method: string, operation: Operation) {
  const isV1 = path.startsWith('/v1/');
  const statuses: ProblemStatus[] = [500];
  if (isV1) statuses.push(429);
  if (isV1 && unsafeMethods.has(method)) statuses.push(403);
  if (operation.requestBody) statuses.push(413, 415);

  const responses = { ...operation.responses };
  for (const status of statuses) responses[status] ??= problemResponseRef(status);
  for (const response of Object.values(responses)) {
    if (response.$ref) continue;
    const standard = isV1 ? headerRefs(...commonHeaders) : headerRefs('X-Request-Id');
    response.headers = { ...standard, ...response.headers };
  }
  operation.responses = Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => Number(a) - Number(b)),
  );
}

export function describeApi(app: OpenAPIHono<AppEnv>, info: { title: string; version: string }) {
  registerComponents(app);
  const document = app.getOpenAPI31Document({ openapi: '3.1.0', info });
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (methods.has(method)) addMiddlewareResponses(path, method, operation as Operation);
    }
  }
  return document;
}
