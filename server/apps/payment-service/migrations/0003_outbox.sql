-- Outbox rows commit with the payment change. The publisher is a separate process (ADR-006).

CREATE TABLE outbox_events (
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

CREATE INDEX outbox_events_pending_idx ON outbox_events (status, next_attempt_at, created_at);
