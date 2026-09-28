import { Injectable } from '@nestjs/common';
import { type Executor } from '@ledgerflow/database';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED';
  readonly merchantId: string | null;
  readonly failedLogins: number;
  readonly createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED';
  merchant_id: string | null;
  failed_logins: number;
  created_at: Date;
}

@Injectable()
export class UserRepository {
  async findByEmail(executor: Executor, email: string): Promise<UserRecord | null> {
    const result = await executor.query<UserRow>(
      `SELECT id, email, password_hash, full_name, status, merchant_id, failed_logins, created_at
       FROM users WHERE lower(email) = lower($1)`,
      [email],
    );

    return result.rows[0] === undefined ? null : toRecord(result.rows[0]);
  }

  async findById(executor: Executor, id: string): Promise<UserRecord | null> {
    const result = await executor.query<UserRow>(
      `SELECT id, email, password_hash, full_name, status, merchant_id, failed_logins, created_at
       FROM users WHERE id = $1`,
      [id],
    );

    return result.rows[0] === undefined ? null : toRecord(result.rows[0]);
  }

  async create(
    executor: Executor,
    input: {
      email: string;
      passwordHash: string;
      fullName: string;
      merchantId: string | null;
    },
  ): Promise<UserRecord> {
    const result = await executor.query<UserRow>(
      `INSERT INTO users (email, password_hash, full_name, merchant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, password_hash, full_name, status, merchant_id, failed_logins, created_at`,
      [input.email, input.passwordHash, input.fullName, input.merchantId],
    );

    return toRecord(result.rows[0]!);
  }

  async assignRoles(
    executor: Executor,
    userId: string,
    roles: readonly string[],
    grantedBy: string,
  ): Promise<void> {
    for (const role of roles) {
      await executor.query(
        `INSERT INTO user_roles (user_id, role_name, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, role_name) DO NOTHING`,
        [userId, role, grantedBy],
      );
    }
  }

  async findRoles(executor: Executor, userId: string): Promise<string[]> {
    const result = await executor.query<{ role_name: string }>(
      'SELECT role_name FROM user_roles WHERE user_id = $1 ORDER BY role_name',
      [userId],
    );

    return result.rows.map((row) => row.role_name);
  }

  /**
   * Permissions are resolved from the database rather than from a hardcoded map, so a grant
   * change takes effect without a deployment and is auditable with SQL.
   */
  async findPermissions(executor: Executor, userId: string): Promise<string[]> {
    const result = await executor.query<{ permission_name: string }>(
      `SELECT DISTINCT rp.permission_name
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_name = ur.role_name
       WHERE ur.user_id = $1
       ORDER BY rp.permission_name`,
      [userId],
    );

    return result.rows.map((row) => row.permission_name);
  }

  async recordSuccessfulLogin(executor: Executor, userId: string): Promise<void> {
    await executor.query(
      `UPDATE users SET failed_logins = 0, last_login_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId],
    );
  }

  /** Returns the new failure count so the caller can decide whether to lock the account. */
  async recordFailedLogin(executor: Executor, userId: string): Promise<number> {
    const result = await executor.query<{ failed_logins: number }>(
      `UPDATE users SET failed_logins = failed_logins + 1, updated_at = now()
       WHERE id = $1
       RETURNING failed_logins`,
      [userId],
    );

    return result.rows[0]?.failed_logins ?? 0;
  }

  async lock(executor: Executor, userId: string): Promise<void> {
    await executor.query(
      `UPDATE users SET status = 'LOCKED', updated_at = now() WHERE id = $1`,
      [userId],
    );
  }
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    status: row.status,
    merchantId: row.merchant_id,
    failedLogins: row.failed_logins,
    createdAt: row.created_at,
  };
}
