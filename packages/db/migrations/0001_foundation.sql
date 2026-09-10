CREATE TABLE foundation_metadata (
  namespace text PRIMARY KEY CHECK (namespace ~ '^zr_[a-f0-9]{12}$'),
  seed_version text NOT NULL CHECK (seed_version = 'foundation-v1')
);
CREATE TABLE telemetry_events (
  event_id uuid PRIMARY KEY,
  namespace text NOT NULL REFERENCES foundation_metadata(namespace),
  name text NOT NULL CHECK (name IN ('foundation.ready', 'foundation.probe')),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX telemetry_events_occurred_at_idx ON telemetry_events (occurred_at);
