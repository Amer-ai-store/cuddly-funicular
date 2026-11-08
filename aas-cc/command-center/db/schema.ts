import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// One owner-private organization, with optimistic concurrency on its document.
export const appState = sqliteTable('aas_app_state', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const repositoryCache = sqliteTable('aas_repository_cache', {
  id: text('id').primaryKey(),
  document: text('document'),
  checkedAt: integer('checked_at').notNull().default(0),
  attemptedAt: integer('attempted_at').notNull().default(0),
  error: text('error')
});

// Independent conversations and local bridge queues never hold organization writes.
export const controlRecords = sqliteTable('aas_control_records', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull()
});
