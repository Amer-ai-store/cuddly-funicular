-- Fixed additive schema, intentionally absent from the public Data API.
-- Applied transactionally by the service using its built-in database identity.
CREATE SCHEMA IF NOT EXISTS aman_access_v1;
REVOKE ALL ON SCHEMA aman_access_v1 FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS aman_access_v1.keys (
  id text PRIMARY KEY, digest text UNIQUE, source_id text NOT NULL,
  active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS aman_access_v1.sources (
  source_id text PRIMARY KEY, last_seen timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS aman_access_v1.events (
  source_id text NOT NULL, id text NOT NULL, occurred_at timestamptz NOT NULL,
  event jsonb NOT NULL, PRIMARY KEY (source_id,id)
);
CREATE INDEX IF NOT EXISTS aman_events_time ON aman_access_v1.events (occurred_at DESC);
ALTER TABLE aman_access_v1.keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE aman_access_v1.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE aman_access_v1.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA aman_access_v1 FROM PUBLIC, anon, authenticated;
