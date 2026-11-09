import { z } from '@hono/zod-openapi';

export const problemCatalog = {
  'validation-failed': { status: 400, title: 'Request validation failed' },
  'invalid-credentials': { status: 401, title: 'Invalid credentials' },
  unauthorized: { status: 401, title: 'Authentication required' },
  forbidden: { status: 403, title: 'Forbidden' },
  'not-found': { status: 404, title: 'Resource not found' },
  'email-taken': { status: 409, title: 'Email already registered' },
  'version-mismatch': { status: 412, title: 'Resource version mismatch' },
  'payload-too-large': { status: 413, title: 'Payload too large' },
  'unsupported-media-type': { status: 415, title: 'Unsupported media type' },
  'idempotency-key-reused': { status: 422, title: 'Idempotency key reused' },
  'precondition-required': { status: 428, title: 'Precondition required' },
  'rate-limited': { status: 429, title: 'Too many requests' },
  'internal-error': { status: 500, title: 'Internal server error' },
  'service-unavailable': { status: 503, title: 'Service unavailable' },
  timeout: { status: 504, title: 'Request timed out' },
} as const;

export type ProblemSlug = keyof typeof problemCatalog;
export type ProblemStatus = (typeof problemCatalog)[ProblemSlug]['status'];

export interface FieldError {
  field: string;
  detail: string;
}

const typePrefix = 'urn:problem:';

export const problemSchema = z
  .object({
    type: z.string().openapi({ example: `${typePrefix}not-found` }),
    title: z.string().openapi({ example: 'Resource not found' }),
    status: z.number().int().openapi({ example: 404 }),
    detail: z.string().openapi({ example: 'Note note_0190 does not exist.' }),
    instance: z.string().openapi({ example: '/v1/notes/note_0190' }),
    errors: z
      .array(z.object({ field: z.string(), detail: z.string() }))
      .optional()
      .openapi({ description: 'Present when `type` is urn:problem:validation-failed' }),
  })
  .openapi('Problem');

export type Problem = z.infer<typeof problemSchema>;

export type ProblemResponses = { [S in ProblemStatus]: { json: Problem } };

export function problemResponses(...slugs: ProblemSlug[]) {
  const responses: Record<
    number,
    {
      description: string;
      content: { 'application/problem+json': { schema: typeof problemSchema } };
    }
  > = {};
  for (const slug of slugs) {
    const { status, title } = problemCatalog[slug];
    responses[status] = {
      description: title,
      content: { 'application/problem+json': { schema: problemSchema } },
    };
  }
  return responses;
}

interface ProblemOptions {
  errors?: FieldError[];
  headers?: Record<string, string>;
  cause?: unknown;
}

export class ProblemError extends Error {
  readonly slug: ProblemSlug;
  readonly status: ProblemStatus;
  readonly title: string;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string>;

  constructor(slug: ProblemSlug, detail: string, options: ProblemOptions = {}) {
    super(detail, { cause: options.cause });
    this.slug = slug;
    this.status = problemCatalog[slug].status;
    this.title = problemCatalog[slug].title;
    this.errors = options.errors;
    this.headers = options.headers ?? {};
  }
}

export function problemResponse(error: ProblemError, instance: string): Response {
  const body = {
    type: `${typePrefix}${error.slug}`,
    title: error.title,
    status: error.status,
    detail: error.message,
    instance,
    ...(error.errors ? { errors: error.errors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: { 'Content-Type': 'application/problem+json', ...error.headers },
  });
}
