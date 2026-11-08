import { type DestinationStream, pino } from 'pino';

export function createLogger(level: string, destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: ['authorization', 'password', 'token', '*.authorization', '*.password', '*.token'],
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
