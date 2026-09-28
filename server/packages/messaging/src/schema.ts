/**
 * Transactional outbox and consumer inbox.
 * Copied into each publishing service's migrations. The publisher and the consumer share
 * this shape so a crash between broker acknowledgement and the published_at update is safe:
 * the row is retried, and the inbox ignores the duplicate.
 */
export const MESSAGING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS outbox_events (
  id              uuid PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  event_type      text NOT NULL,
  event_version   integer NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED')),
  attempt_count   integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS inbox_events (
  event_id      uuid NOT NULL,
  consumer      text NOT NULL,
  payload_hash  text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

CREATE TABLE IF NOT EXISTS dead_letters (
  id             uuid PRIMARY KEY,
  event_id       text,
  message_id     text,
  consumer       text NOT NULL,
  error_code     text NOT NULL,
  error_message  text NOT NULL,
  attempt_count  integer NOT NULL DEFAULT 1,
  payload        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
`;
