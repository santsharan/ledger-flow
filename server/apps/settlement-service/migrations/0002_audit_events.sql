-- Append-only audit trail, written in the same transaction as the change it records (ADR-015).

CREATE TABLE audit_events (
  audit_id       uuid PRIMARY KEY,
  actor_type     text NOT NULL CHECK (actor_type IN ('USER', 'SERVICE', 'SYSTEM')),
  actor_id       text NOT NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text NOT NULL,
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  ip_address     inet,
  request_id     text,
  correlation_id text,
  trace_id       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, created_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit_events (correlation_id);

CREATE FUNCTION audit_events_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (ADR-015)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();
