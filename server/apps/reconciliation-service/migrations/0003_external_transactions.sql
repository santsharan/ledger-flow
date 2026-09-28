-- Normalized statement rows. Matching reads these, not the raw file (ADR-009).

CREATE TABLE statement_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES reconciliation_runs (id),
  provider    text NOT NULL,
  format      text NOT NULL CHECK (format IN ('CSV', 'JSON')),
  row_count   integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE external_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id           uuid NOT NULL REFERENCES statement_imports (id),
  provider            text NOT NULL,
  external_reference  text NOT NULL,
  payment_reference   text,
  amount_minor        bigint NOT NULL,
  currency            char(3) NOT NULL,
  settlement_date     date NOT NULL,
  status              text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX external_transactions_reference_idx
  ON external_transactions (provider, external_reference);
