import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const foundationMetadata = pgTable('foundation_metadata', {
  namespace: text('namespace').primaryKey(), seedVersion: text('seed_version').notNull(),
});
export const telemetryEvents = pgTable('telemetry_events', {
  eventId: uuid('event_id').primaryKey(), namespace: text('namespace').notNull().references(() => foundationMetadata.namespace),
  name: text('name').notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
