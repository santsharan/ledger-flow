-- One logical database per bounded context, each with its own owner role
-- (docs/architecture/bounded-contexts.md).
--
-- Ownership is enforced by grants rather than convention: the payment role physically cannot
-- read the ledger database, so a cross-context query fails in development instead of in review.
--
-- Local passwords only. Production credentials come from Key Vault (ADR-011).

\set ON_ERROR_STOP on

CREATE ROLE identity_app       WITH LOGIN PASSWORD 'identity_local_password';
CREATE ROLE merchant_app       WITH LOGIN PASSWORD 'merchant_local_password';
CREATE ROLE payment_app        WITH LOGIN PASSWORD 'payment_local_password';
CREATE ROLE ledger_app         WITH LOGIN PASSWORD 'ledger_local_password';
CREATE ROLE settlement_app     WITH LOGIN PASSWORD 'settlement_local_password';
CREATE ROLE reconciliation_app WITH LOGIN PASSWORD 'reconciliation_local_password';
CREATE ROLE risk_app           WITH LOGIN PASSWORD 'risk_local_password';
CREATE ROLE notification_app   WITH LOGIN PASSWORD 'notification_local_password';

CREATE DATABASE ledgerflow_identity       OWNER identity_app;
CREATE DATABASE ledgerflow_merchant       OWNER merchant_app;
CREATE DATABASE ledgerflow_payment        OWNER payment_app;
CREATE DATABASE ledgerflow_ledger         OWNER ledger_app;
CREATE DATABASE ledgerflow_settlement     OWNER settlement_app;
CREATE DATABASE ledgerflow_reconciliation OWNER reconciliation_app;
CREATE DATABASE ledgerflow_risk           OWNER risk_app;
CREATE DATABASE ledgerflow_notification   OWNER notification_app;

-- No service may connect to a database it does not own.
REVOKE CONNECT ON DATABASE ledgerflow_identity       FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_merchant       FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_payment        FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_ledger         FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_settlement     FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_reconciliation FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_risk           FROM PUBLIC;
REVOKE CONNECT ON DATABASE ledgerflow_notification   FROM PUBLIC;

GRANT CONNECT ON DATABASE ledgerflow_identity       TO identity_app;
GRANT CONNECT ON DATABASE ledgerflow_merchant       TO merchant_app;
GRANT CONNECT ON DATABASE ledgerflow_payment        TO payment_app;
GRANT CONNECT ON DATABASE ledgerflow_ledger         TO ledger_app;
GRANT CONNECT ON DATABASE ledgerflow_settlement     TO settlement_app;
GRANT CONNECT ON DATABASE ledgerflow_reconciliation TO reconciliation_app;
GRANT CONNECT ON DATABASE ledgerflow_risk           TO risk_app;
GRANT CONNECT ON DATABASE ledgerflow_notification   TO notification_app;
