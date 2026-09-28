-- Settlement batches freeze their inputs. Historical totals are never recomputed from
-- mutable payment rows (ADR-010).

CREATE TABLE settlement_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         uuid NOT NULL,
  settlement_date     date NOT NULL,
  currency            char(3) NOT NULL,
  status              text NOT NULL DEFAULT 'CREATED',
  fee_schedule_version text NOT NULL,
  fee_basis_points    integer NOT NULL CHECK (fee_basis_points BETWEEN 0 AND 10000),
  fixed_fee_minor     bigint NOT NULL CHECK (fixed_fee_minor >= 0),
  gross_minor         bigint,
  fees_minor          bigint,
  refunds_minor       bigint,
  chargebacks_minor   bigint,
  adjustments_minor   bigint,
  net_minor           bigint,
  version             bigint NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_batches_natural_key UNIQUE (merchant_id, settlement_date, currency)
);

CREATE INDEX settlement_batches_status_date_idx ON settlement_batches (status, settlement_date);

CREATE TABLE settlement_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES settlement_batches (id),
  item_type    text NOT NULL CHECK (item_type IN ('CAPTURE', 'REFUND', 'FEE', 'CHARGEBACK', 'ADJUSTMENT')),
  source_id    text NOT NULL,
  amount_minor bigint NOT NULL,
  currency     char(3) NOT NULL,
  CONSTRAINT settlement_items_source_unique UNIQUE (batch_id, item_type, source_id)
);

CREATE TABLE settlement_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              uuid NOT NULL UNIQUE REFERENCES settlement_batches (id),
  fee_schedule_version  text NOT NULL,
  fee_basis_points      integer NOT NULL,
  fixed_fee_minor       bigint NOT NULL,
  input_digest          text NOT NULL,
  totals                jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement_transitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES settlement_batches (id),
  previous_status  text NOT NULL,
  new_status       text NOT NULL,
  actor_id         text NOT NULL,
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX settlement_confirmed_once
  ON settlement_transitions (batch_id)
  WHERE new_status = 'CONFIRMED';
