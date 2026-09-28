-- Merchant context: profile, status, settlement configuration and ledger account references.
-- Holds no balances: those belong to the ledger (bounded-contexts.md).

CREATE TABLE merchants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name          text NOT NULL,
  display_name        text NOT NULL,
  country             char(2) NOT NULL,
  contact_email       text NOT NULL,
  status              text NOT NULL DEFAULT 'MERCHANT_PENDING'
                        CHECK (status IN ('MERCHANT_PENDING', 'MERCHANT_ACTIVE',
                                          'MERCHANT_SUSPENDED', 'MERCHANT_CLOSED')),
  settlement_currency char(3) NOT NULL,
  -- Optimistic version, incremented on every status change.
  version             bigint NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX merchants_legal_name_country_unique
  ON merchants (lower(legal_name), country);
CREATE INDEX merchants_status_idx ON merchants (status, created_at DESC);

CREATE TABLE merchant_settlement_config (
  merchant_id         uuid PRIMARY KEY REFERENCES merchants (id) ON DELETE RESTRICT,
  settlement_schedule text NOT NULL DEFAULT 'DAILY'
                        CHECK (settlement_schedule IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  -- Fees are basis points and integer minor units; never a float (ADR-016).
  fee_basis_points    integer NOT NULL DEFAULT 250
                        CHECK (fee_basis_points BETWEEN 0 AND 10000),
  fixed_fee_minor     bigint NOT NULL DEFAULT 0 CHECK (fixed_fee_minor >= 0),
  hold_period_days    integer NOT NULL DEFAULT 0 CHECK (hold_period_days BETWEEN 0 AND 90),
  currency            char(3) NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Every status transition is recorded with actor and reason; there is no silent status update.
CREATE TABLE merchant_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    uuid NOT NULL REFERENCES merchants (id) ON DELETE RESTRICT,
  previous_status text NOT NULL,
  new_status     text NOT NULL,
  reason         text NOT NULL,
  actor_id       text NOT NULL,
  actor_type     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merchant_status_history_merchant_idx
  ON merchant_status_history (merchant_id, created_at DESC);

-- References to accounts owned by the ledger service. This table stores identifiers only;
-- it never stores balances, and the merchant service never queries the ledger database.
CREATE TABLE merchant_ledger_accounts (
  merchant_id  uuid NOT NULL REFERENCES merchants (id) ON DELETE RESTRICT,
  account_code text NOT NULL,
  currency     char(3) NOT NULL,
  account_id   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, account_code, currency)
);
