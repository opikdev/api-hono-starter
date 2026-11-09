import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const id = uuid('id').notNull().default(sql`uuidv7()`);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id,
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_users', columns: [table.id] }),
    unique('uq_users_email').on(table.email),
    check('chk_users_email_lowercase', sql`${table.email} = lower(${table.email})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id,
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_sessions', columns: [table.id] }),
    foreignKey({
      name: 'fk_sessions_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_sessions_token_hash').on(table.tokenHash),
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id,
    userId: uuid('user_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_notes', columns: [table.id] }),
    foreignKey({
      name: 'fk_notes_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    index('idx_notes_user_id_id').on(table.userId, table.id.desc()),
    check('chk_notes_title_length', sql`char_length(${table.title}) between 1 and 200`),
    check('chk_notes_body_length', sql`char_length(${table.body}) <= 10000`),
    check('chk_notes_version_positive', sql`${table.version} > 0`),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id,
    userId: uuid('user_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseBody: jsonb('response_body').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_idempotency_keys', columns: [table.id] }),
    foreignKey({
      name: 'fk_idempotency_keys_user_id',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uq_idempotency_keys_user_id_key').on(table.userId, table.key),
    index('idx_idempotency_keys_expires_at').on(table.expiresAt),
  ],
);

export const rateLimits = pgTable(
  'rate_limits',
  {
    id,
    key: text('key').notNull(),
    count: integer('count').notNull().default(1),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'pk_rate_limits', columns: [table.id] }),
    unique('uq_rate_limits_key').on(table.key),
    index('idx_rate_limits_reset_at').on(table.resetAt),
  ],
);
