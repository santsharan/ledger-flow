CREATE TABLE reconciliation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  status      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid NOT NULL REFERENCES reconciliation_runs (id),
  result_type          text NOT NULL,
  match_reason         text,
  internal_reference   text,
  external_reference   text,
  delta_minor          bigint,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id     uuid NOT NULL UNIQUE REFERENCES reconciliation_results (id),
  case_type     text NOT NULL,
  status        text NOT NULL,
  resolution_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE TABLE case_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid NOT NULL REFERENCES reconciliation_cases (id),
  actor_id         text NOT NULL,
  action           text NOT NULL,
  previous_status  text NOT NULL,
  new_status       text NOT NULL,
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
