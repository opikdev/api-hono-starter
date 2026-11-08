import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    ownerDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withUsername('api_owner')
    .withPassword('api_owner_dev_password')
    .withDatabase('api')
    .withCopyContentToContainer([
      {
        content: readFileSync('docker/postgres/init.sql', 'utf8'),
        target: '/docker-entrypoint-initdb.d/init.sql',
      },
    ])
    .start();

  const ownerDatabaseUrl = container.getConnectionUri();
  const url = new URL(ownerDatabaseUrl);
  url.username = 'api_app';
  url.password = 'api_app_dev_password';

  execFileSync('node', ['src/db/migrate.ts'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerDatabaseUrl },
    stdio: 'inherit',
  });

  project.provide('databaseUrl', url.toString());
  project.provide('ownerDatabaseUrl', ownerDatabaseUrl);

  return async () => {
    await container.stop();
  };
}
