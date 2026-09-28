import { Inject, Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import {
  hashPassword,
  hashToken,
  newRefreshToken,
  signAccessToken,
  verifyPassword,
  type PermissionValue,
  type Principal,
} from '@ledgerflow/auth';
import { type CreateUserRequest, type TokenResponse, type UserResponse } from '@ledgerflow/contracts';
import { Database } from '@ledgerflow/database';
import { BusinessConflictError, ErrorCode, ForbiddenError, NotFoundError, UnauthenticatedError } from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { getRequestContext, LOGGER } from '@ledgerflow/service-core';
import { IDENTITY_CONFIG } from '../tokens';
import { type IdentityConfig } from '../config';
import { UserRepository } from '../users/user.repository';
import { TokenRepository } from './token.repository';

export interface LoginContext {
  readonly ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: Database,
    private readonly users: UserRepository,
    private readonly tokens: TokenRepository,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async login(
    email: string,
    password: string,
    context: LoginContext = {},
  ): Promise<TokenResponse> {
    const user = await this.users.findByEmail(this.database, email);

    // The same generic failure is returned whether the user is unknown or the password is
    // wrong, so the endpoint cannot be used to enumerate accounts.
    if (user === null) {
      // Still spend the hashing cost, so response time does not reveal existence.
      await verifyPassword(password, await hashPassword('timing-equalizer'));
      throw new UnauthenticatedError('Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('This account is not active.');
    }

    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      const failures = await this.database.withTransaction(async (tx) => {
        const count = await this.users.recordFailedLogin(tx, user.id);
        if (count >= this.config.MAX_FAILED_LOGINS) {
          await this.users.lock(tx, user.id);
          await writeAudit(tx, {
            actorType: 'SYSTEM',
            actorId: 'identity-service',
            action: 'user.locked',
            resourceType: 'user',
            resourceId: user.id,
            reason: `${count} consecutive failed logins`,
            ...auditContext(),
          });
        }
        return count;
      });

      this.logger.warn(
        { event: 'auth.login.failed', userId: user.id, failedLogins: failures },
        'login failed',
      );
      throw new UnauthenticatedError('Invalid email or password.');
    }

    return this.database.withTransaction(async (tx) => {
      await this.users.recordSuccessfulLogin(tx, user.id);

      const roles = await this.users.findRoles(tx, user.id);
      const permissions = (await this.users.findPermissions(tx, user.id)) as PermissionValue[];

      const issued = await this.issueTokens(tx, {
        userId: user.id,
        merchantId: user.merchantId,
        roles,
        permissions,
      });

      await writeAudit(tx, {
        actorType: 'USER',
        actorId: user.id,
        action: 'user.login',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: context.ipAddress ?? null,
        ...auditContext(),
      });

      this.logger.info({ event: 'auth.login.succeeded', userId: user.id }, 'login succeeded');
      return issued;
    });
  }

  /**
   * Refresh with rotation: the presented token is revoked and replaced in the same transaction,
   * so a stolen refresh token stops working the moment the legitimate client uses its own.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    return this.database.withTransaction(async (tx) => {
      const record = await this.tokens.lockByHash(tx, hashToken(refreshToken));

      if (record === null || record.revokedAt !== null || record.expiresAt <= new Date()) {
        throw new UnauthenticatedError('The refresh token is invalid or expired.');
      }

      const user = await this.users.findById(tx, record.userId);
      if (user === null || user.status !== 'ACTIVE') {
        throw new UnauthenticatedError('The account is no longer active.');
      }

      const roles = await this.users.findRoles(tx, user.id);
      const permissions = (await this.users.findPermissions(tx, user.id)) as PermissionValue[];

      const issued = await this.issueTokens(tx, {
        userId: user.id,
        merchantId: user.merchantId,
        roles,
        permissions,
      });

      await this.tokens.revokeRefreshToken(tx, record.id, null);

      return issued;
    });
  }

  async logout(principal: Principal, accessTokenExpiresAt: Date): Promise<void> {
    await this.database.withTransaction(async (tx) => {
      await this.tokens.revokeAccessToken(tx, {
        tokenId: principal.tokenId,
        userId: principal.id,
        expiresAt: accessTokenExpiresAt,
        reason: 'logout',
      });
      const revoked = await this.tokens.revokeAllForUser(tx, principal.id);

      await writeAudit(tx, {
        actorType: 'USER',
        actorId: principal.id,
        action: 'user.logout',
        resourceType: 'user',
        resourceId: principal.id,
        afterState: { revokedRefreshTokens: revoked },
        ...auditContext(),
      });
    });
  }

  async isAccessTokenRevoked(tokenId: string): Promise<boolean> {
    return this.tokens.isAccessTokenRevoked(this.database, tokenId);
  }

  async createUser(actor: Principal, request: CreateUserRequest): Promise<UserResponse> {
    const passwordHash = await hashPassword(request.password);

    return this.database.withTransaction(async (tx) => {
      const existing = await this.users.findByEmail(tx, request.email);
      if (existing !== null) {
        throw new BusinessConflictError(ErrorCode.CONFLICT, 'A user with this email already exists.');
      }

      const user = await this.users.create(tx, {
        email: request.email,
        passwordHash,
        fullName: request.fullName,
        merchantId: request.merchantId ?? null,
      });

      await this.users.assignRoles(tx, user.id, request.roles, actor.id);
      const permissions = await this.users.findPermissions(tx, user.id);

      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: 'user.created',
        resourceType: 'user',
        resourceId: user.id,
        // The password hash is never part of an audit record (ADR-015).
        afterState: {
          email: user.email,
          fullName: user.fullName,
          roles: request.roles,
          merchantId: user.merchantId,
        },
        ...auditContext(),
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        roles: request.roles,
        permissions,
        merchantId: user.merchantId,
        createdAt: user.createdAt.toISOString(),
      };
    });
  }

  async getUser(actor: Principal, userId: string): Promise<UserResponse> {
    const user = await this.users.findById(this.database, userId);

    if (user === null) {
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'User not found.');
    }

    // A merchant-scoped caller may only read users belonging to its own merchant.
    if (actor.merchantId !== undefined && user.merchantId !== actor.merchantId) {
      throw new ForbiddenError('This user belongs to another merchant.');
    }

    const [roles, permissions] = await Promise.all([
      this.users.findRoles(this.database, user.id),
      this.users.findPermissions(this.database, user.id),
    ]);

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      roles,
      permissions,
      merchantId: user.merchantId,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async issueTokens(
    tx: Parameters<typeof writeAudit>[0],
    input: {
      userId: string;
      merchantId: string | null;
      roles: readonly string[];
      permissions: readonly PermissionValue[];
    },
  ): Promise<TokenResponse> {
    const accessToken = await signAccessToken(
      {
        subject: input.userId,
        actorType: 'USER',
        roles: input.roles,
        permissions: input.permissions,
        ...(input.merchantId === null ? {} : { merchantId: input.merchantId }),
        expiresInSeconds: this.config.ACCESS_TOKEN_TTL_SECONDS,
      },
      this.config.JWT_SECRET,
    );

    const refreshToken = newRefreshToken();
    await this.tokens.storeRefreshToken(tx, {
      userId: input.userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}

function auditContext(): { requestId: string | null; correlationId: string | null } {
  const context = getRequestContext();
  return {
    requestId: context?.requestId ?? null,
    correlationId: context?.correlationId ?? null,
  };
}
