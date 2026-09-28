-- Roles and permissions from trust-boundaries.md §3.
-- Seeded as data so an operator can inspect the grant model with SQL.

INSERT INTO permissions (name, description) VALUES
  ('payments.read', 'Read payments'),
  ('payments.create', 'Create payments'),
  ('payments.capture', 'Capture authorized payments'),
  ('payments.refund', 'Refund captured payments'),
  ('payments.cancel', 'Cancel authorizations'),
  ('ledger.read', 'Read accounts, journals and entries'),
  ('ledger.post', 'Post journals (service identities only)'),
  ('merchants.read', 'Read merchant profiles'),
  ('merchants.write', 'Create and modify merchants'),
  ('settlements.read', 'Read settlement batches'),
  ('settlements.approve', 'Approve settlement batches'),
  ('reconciliation.read', 'Read reconciliation runs and cases'),
  ('reconciliation.resolve', 'Resolve reconciliation cases'),
  ('risk.read', 'Read risk evaluations'),
  ('risk.override', 'Override risk decisions'),
  ('users.read', 'Read users'),
  ('users.write', 'Create and modify users'),
  ('admin.operations', 'Operational endpoints'),
  ('admin.replay', 'Approve dead-letter replay');

INSERT INTO roles (name, description) VALUES
  ('CUSTOMER', 'End payer; no direct platform access'),
  ('MERCHANT_ADMIN', 'Owns a merchant account'),
  ('MERCHANT_OPERATOR', 'Day-to-day merchant staff'),
  ('FINANCE_OPERATOR', 'Platform finance staff'),
  ('RISK_ANALYST', 'Platform risk staff'),
  ('RECONCILIATION_OPERATOR', 'Platform reconciliation staff'),
  ('SUPPORT', 'Read-only investigation'),
  ('PLATFORM_ADMIN', 'Platform engineering'),
  ('SERVICE', 'Machine identity with explicitly granted scopes');

INSERT INTO role_permissions (role_name, permission_name) VALUES
  ('MERCHANT_ADMIN', 'payments.read'),
  ('MERCHANT_ADMIN', 'payments.create'),
  ('MERCHANT_ADMIN', 'payments.capture'),
  ('MERCHANT_ADMIN', 'payments.refund'),
  ('MERCHANT_ADMIN', 'payments.cancel'),
  ('MERCHANT_ADMIN', 'merchants.read'),
  ('MERCHANT_ADMIN', 'merchants.write'),
  ('MERCHANT_ADMIN', 'settlements.read'),
  ('MERCHANT_ADMIN', 'ledger.read'),

  ('MERCHANT_OPERATOR', 'payments.read'),
  ('MERCHANT_OPERATOR', 'payments.create'),
  ('MERCHANT_OPERATOR', 'payments.capture'),
  ('MERCHANT_OPERATOR', 'payments.refund'),
  ('MERCHANT_OPERATOR', 'merchants.read'),

  ('FINANCE_OPERATOR', 'ledger.read'),
  ('FINANCE_OPERATOR', 'settlements.read'),
  ('FINANCE_OPERATOR', 'settlements.approve'),
  ('FINANCE_OPERATOR', 'merchants.read'),
  ('FINANCE_OPERATOR', 'payments.read'),

  ('RISK_ANALYST', 'risk.read'),
  ('RISK_ANALYST', 'risk.override'),
  ('RISK_ANALYST', 'payments.read'),

  ('RECONCILIATION_OPERATOR', 'reconciliation.read'),
  ('RECONCILIATION_OPERATOR', 'reconciliation.resolve'),
  ('RECONCILIATION_OPERATOR', 'payments.read'),
  ('RECONCILIATION_OPERATOR', 'ledger.read'),
  ('RECONCILIATION_OPERATOR', 'settlements.read'),

  ('SUPPORT', 'payments.read'),
  ('SUPPORT', 'merchants.read'),
  ('SUPPORT', 'reconciliation.read'),
  ('SUPPORT', 'settlements.read'),

  ('PLATFORM_ADMIN', 'admin.operations'),
  ('PLATFORM_ADMIN', 'admin.replay'),
  ('PLATFORM_ADMIN', 'users.read'),
  ('PLATFORM_ADMIN', 'users.write'),
  ('PLATFORM_ADMIN', 'payments.read'),
  ('PLATFORM_ADMIN', 'ledger.read'),
  ('PLATFORM_ADMIN', 'merchants.read'),
  ('PLATFORM_ADMIN', 'settlements.read'),
  ('PLATFORM_ADMIN', 'reconciliation.read'),
  ('PLATFORM_ADMIN', 'risk.read');
