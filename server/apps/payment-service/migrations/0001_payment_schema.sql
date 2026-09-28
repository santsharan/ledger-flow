-- Payment context: lifecycle, provider attempts and idempotency.
-- Balances are not stored here. A capture records a ledger posting request that is
-- fulfilled by a call made after this transaction commits.

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      uuid NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         char(3) NOT NULL,
  status           text NOT NULL DEFAULT 'CREATED',
  authorized_minor bigint NOT NULL DEFAULT 0 CHECK (authorized_minor >= 0),
  captured_minor   bigint NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  refunded_minor   bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  version          bigint NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_captured_within_authorized CHECK (captured_minor <= authorized_minor),
  CONSTRAINT payments_refunded_within_captured CHECK (refunded_minor <= captured_minor)
);

CREATE INDEX payments_merchant_created_idx ON payments (merchant_id, created_at DESC);
CREATE INDEX payments_status_created_idx ON payments (status, created_at DESC);

CREATE TABLE payment_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES payments (id),
  attempt_number      integer NOT NULL CHECK (attempt_number > 0),
  operation           text NOT NULL CHECK (operation IN ('AUTHORIZE', 'CAPTURE', 'REFUND')),
  provider            text NOT NULL,
  provider_reference  text,
  status              text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  currency            char(3) NOT NULL,
  failure_code        text,
  failure_reason      text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  CONSTRAINT payment_attempts_number_unique UNIQUE (payment_id, attempt_number)
);

CREATE INDEX payment_attempts_payment_idx ON payment_attempts (payment_id, attempt_number DESC);

-- One row per financial effect that must be posted to the ledger.
-- reference_type + reference_id is the ledger's idempotency key.
CREATE TABLE ledger_postings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments (id),
  attempt_id      uuid REFERENCES payment_attempts (id),
  reference_type  text NOT NULL,
  reference_id    text NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL,
  status          text NOT NULL CHECK (status IN ('PENDING', 'POSTED')),
  journal_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  posted_at       timestamptz,
  CONSTRAINT ledger_postings_reference_unique UNIQUE (reference_type, reference_id)
);

CREATE INDEX ledger_postings_payment_idx ON ledger_postings (payment_id);

CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL,
  idempotency_key text NOT NULL,
  operation       text NOT NULL,
  request_hash    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, idempotency_key)
);
