import { Injectable } from '@nestjs/common';
import { type Executor } from '@ledgerflow/database';

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

@Injectable()
export class TokenRepository {
  async storeRefreshToken(
    executor: Executor,
    input: { userId: string; tokenHash: string; expiresAt: Date },
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [input.userId, input.tokenHash, input.expiresAt],
    );

    return result.rows[0]!.id;
  }

  /**
   * Looks up a refresh token by hash and locks the row.
   *
   * The lock is what makes refresh-token rotation safe under concurrency: two simultaneous
   * refreshes with the same token cannot both mint a new pair.
   */
  async lockByHash(executor: Executor, tokenHash: string): Promise<RefreshTokenRecord | null> {
    const result = await executor.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );

    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, userId: row.user_id, expiresAt: row.expires_at, revokedAt: row.revoked_at };
  }

  async revokeRefreshToken(
    executor: Executor,
    id: string,
    replacedBy: string | null,
  ): Promise<void> {
    await executor.query(
      'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
      [id, replacedBy],
    );
  }

  async revokeAllForUser(executor: Executor, userId: string): Promise<number> {
    const result = await executor.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );

    return result.rowCount;
  }

  async revokeAccessToken(
    executor: Executor,
    input: { tokenId: string; userId: string; expiresAt: Date; reason: string },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO revoked_access_tokens (token_id, user_id, expires_at, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_id) DO NOTHING`,
      [input.tokenId, input.userId, input.expiresAt, input.reason],
    );
  }

  async isAccessTokenRevoked(executor: Executor, tokenId: string): Promise<boolean> {
    const result = await executor.query(
      'SELECT 1 FROM revoked_access_tokens WHERE token_id = $1',
      [tokenId],
    );

    return result.rowCount > 0;
  }

  /** Expired entries are pruned: the deny-list only needs to outlive the tokens it denies. */
  async pruneExpired(executor: Executor): Promise<number> {
    const revoked = await executor.query(
      'DELETE FROM revoked_access_tokens WHERE expires_at < now()',
    );
    await executor.query(
      `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '30 days'`,
    );

    return revoked.rowCount;
  }
}
