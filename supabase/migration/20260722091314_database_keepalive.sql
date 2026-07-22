BEGIN;

CREATE TABLE IF NOT EXISTS steel.keepalive (
  run_id TEXT NOT NULL,
  sequence SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  random_data TEXT NOT NULL,
  CONSTRAINT keepalive_sequence_check CHECK (sequence BETWEEN 1 AND 5),
  CONSTRAINT keepalive_pkey PRIMARY KEY (run_id, sequence)
);

ALTER TABLE steel.keepalive DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE steel.keepalive FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prod_app') THEN
    GRANT USAGE ON SCHEMA steel TO prod_app;
    GRANT SELECT, INSERT, DELETE ON TABLE steel.keepalive TO prod_app;
  END IF;
END $$;

COMMIT;
