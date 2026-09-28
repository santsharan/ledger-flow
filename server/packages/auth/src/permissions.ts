/**
 * Authorization is permission-based, never role-based (trust-boundaries.md §3).
 *
 * Code asks "may this principal capture a payment", not "is this principal a MERCHANT_ADMIN".
 * Roles are only bundles of permissions, so adding a role never silently grants capability.
 */
export const Permission = {
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_CREATE: 'payments.create',
  PAYMENTS_CAPTURE: 'payments.capture',
  PAYMENTS_REFUND: 'payments.refund',
  PAYMENTS_CANCEL: 'payments.cancel',

  LEDGER_READ: 'ledger.read',
  LEDGER_POST: 'ledger.post',

  MERCHANTS_READ: 'merchants.read',
  MERCHANTS_WRITE: 'merchants.write',

  SETTLEMENTS_READ: 'settlements.read',
  SETTLEMENTS_APPROVE: 'settlements.approve',

  RECONCILIATION_READ: 'reconciliation.read',
  RECONCILIATION_RESOLVE: 'reconciliation.resolve',

  RISK_READ: 'risk.read',
  RISK_OVERRIDE: 'risk.override',

  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',

  ADMIN_OPERATIONS: 'admin.operations',
  ADMIN_REPLAY: 'admin.replay',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly PermissionValue[] = Object.values(Permission);

export const Role = {
  CUSTOMER: 'CUSTOMER',
  MERCHANT_ADMIN: 'MERCHANT_ADMIN',
  MERCHANT_OPERATOR: 'MERCHANT_OPERATOR',
  FINANCE_OPERATOR: 'FINANCE_OPERATOR',
  RISK_ANALYST: 'RISK_ANALYST',
  RECONCILIATION_OPERATOR: 'RECONCILIATION_OPERATOR',
  SUPPORT: 'SUPPORT',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  SERVICE: 'SERVICE',
} as const;

export type RoleValue = (typeof Role)[keyof typeof Role];

/**
 * Merchant-scoped roles are additionally constrained by a tenancy check inside each service:
 * holding `payments.read` does not grant access to another merchant's payments.
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleValue, readonly PermissionValue[]>> = {
  CUSTOMER: [],
  MERCHANT_ADMIN: [
    Permission.PAYMENTS_READ,
    Permission.PAYMENTS_CREATE,
    Permission.PAYMENTS_CAPTURE,
    Permission.PAYMENTS_REFUND,
    Permission.PAYMENTS_CANCEL,
    Permission.MERCHANTS_READ,
    Permission.MERCHANTS_WRITE,
    Permission.SETTLEMENTS_READ,
    Permission.LEDGER_READ,
  ],
  MERCHANT_OPERATOR: [
    Permission.PAYMENTS_READ,
    Permission.PAYMENTS_CREATE,
    Permission.PAYMENTS_CAPTURE,
    Permission.PAYMENTS_REFUND,
    Permission.MERCHANTS_READ,
  ],
  FINANCE_OPERATOR: [
    Permission.LEDGER_READ,
    Permission.SETTLEMENTS_READ,
    Permission.SETTLEMENTS_APPROVE,
    Permission.MERCHANTS_READ,
    Permission.PAYMENTS_READ,
  ],
  RISK_ANALYST: [Permission.RISK_READ, Permission.RISK_OVERRIDE, Permission.PAYMENTS_READ],
  RECONCILIATION_OPERATOR: [
    Permission.RECONCILIATION_READ,
    Permission.RECONCILIATION_RESOLVE,
    Permission.PAYMENTS_READ,
    Permission.LEDGER_READ,
    Permission.SETTLEMENTS_READ,
  ],
  SUPPORT: [
    Permission.PAYMENTS_READ,
    Permission.MERCHANTS_READ,
    Permission.RECONCILIATION_READ,
    Permission.SETTLEMENTS_READ,
  ],
  PLATFORM_ADMIN: [
    Permission.ADMIN_OPERATIONS,
    Permission.ADMIN_REPLAY,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.PAYMENTS_READ,
    Permission.LEDGER_READ,
    Permission.MERCHANTS_READ,
    Permission.SETTLEMENTS_READ,
    Permission.RECONCILIATION_READ,
    Permission.RISK_READ,
  ],
  // Service identities receive narrow scopes per service, granted explicitly at token issue.
  SERVICE: [],
};

export function permissionsForRoles(roles: readonly string[]): PermissionValue[] {
  const permissions = new Set<PermissionValue>();

  for (const role of roles) {
    const rolePermissions = ROLE_PERMISSIONS[role as RoleValue];
    if (rolePermissions === undefined) continue;
    for (const permission of rolePermissions) {
      permissions.add(permission);
    }
  }

  return [...permissions].sort();
}

export function isKnownRole(role: string): role is RoleValue {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}
