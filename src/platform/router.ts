import { OpenAPIHono } from '@hono/zod-openapi';
import type { ZodError } from 'zod';
import { ProblemError } from './problem.ts';
import type { PolicyState } from './rate-limit.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  createdAt: Date;
  sessionId: string;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    user: AuthenticatedUser;
    rateLimits: PolicyState[] | undefined;
  };
}

function toValidationProblem(error: ZodError): ProblemError {
  const errors = error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    detail: issue.message,
  }));
  return new ProblemError(
    'validation-failed',
    'The request has invalid fields. See `errors` for each one, then fix them and retry.',
    { errors },
  );
}

export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw toValidationProblem(result.error);
    },
  });
}
