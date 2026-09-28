-- Extensions each context needs, installed per database while connected as its owner.
--   pgcrypto      — gen_random_uuid() for primary keys
--   pg_stat_statements is enabled at server level in Azure; locally the query log suffices.

\set ON_ERROR_STOP on

\connect ledgerflow_identity
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_merchant
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_payment
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_ledger
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_settlement
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_reconciliation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_risk
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect ledgerflow_notification
CREATE EXTENSION IF NOT EXISTS pgcrypto;
