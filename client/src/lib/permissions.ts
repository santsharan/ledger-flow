export const Permission = {
  PAYMENTS_READ: "payments.read",
  PAYMENTS_CREATE: "payments.create",
  PAYMENTS_CAPTURE: "payments.capture",
  PAYMENTS_REFUND: "payments.refund",
  PAYMENTS_CANCEL: "payments.cancel",
  LEDGER_READ: "ledger.read",
  LEDGER_POST: "ledger.post",
  MERCHANTS_READ: "merchants.read",
  MERCHANTS_WRITE: "merchants.write",
  SETTLEMENTS_READ: "settlements.read",
  SETTLEMENTS_APPROVE: "settlements.approve",
  RECONCILIATION_READ: "reconciliation.read",
  RECONCILIATION_RESOLVE: "reconciliation.resolve",
  RISK_READ: "risk.read",
  RISK_OVERRIDE: "risk.override",
  USERS_READ: "users.read",
  USERS_WRITE: "users.write",
  ADMIN_OPERATIONS: "admin.operations",
  ADMIN_REPLAY: "admin.replay",
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];

export function can(permissions: readonly string[], required: string): boolean {
  return permissions.includes(required);
}

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly permission: PermissionName | null;
}

export const NAV: readonly NavItem[] = [
  { href: "/", label: "Dashboard", permission: null },
  { href: "/payments", label: "Payments", permission: Permission.PAYMENTS_READ },
  { href: "/ledger", label: "Ledger", permission: Permission.LEDGER_READ },
  { href: "/settlements", label: "Settlements", permission: Permission.SETTLEMENTS_READ },
  { href: "/reconciliation", label: "Reconciliation", permission: Permission.RECONCILIATION_READ },
  { href: "/risk", label: "Risk", permission: Permission.RISK_READ },
  { href: "/audit", label: "Audit", permission: Permission.PAYMENTS_READ },
  { href: "/operations", label: "Operations", permission: Permission.ADMIN_OPERATIONS },
  { href: "/merchants", label: "Merchants", permission: Permission.MERCHANTS_READ },
  { href: "/admin", label: "Admin", permission: Permission.USERS_READ },
];

export function visibleNav(permissions: readonly string[]): NavItem[] {
  return NAV.filter((item) => item.permission === null || can(permissions, item.permission));
}
