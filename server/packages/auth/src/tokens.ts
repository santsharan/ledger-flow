import { createHash, randomUUID } from 'node:crypto';
import { errors as joseErrors, jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';
import { ErrorCode, ForbiddenError, UnauthenticatedError } from '@ledgerflow/errors';
import { type PermissionValue } from './permissions';

export const TOKEN_ISSUER = 'https://ledgerflow.local/identity';
export const ACCESS_TOKEN_AUDIENCE = 'ledgerflow-api';
export const SERVICE_TOKEN_AUDIENCE = 'ledgerflow-internal';

export type ActorType = 'USER' | 'SERVICE';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly actorType: ActorType;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionValue[];
  /** Present for merchant-scoped principals; drives the tenancy check inside each service. */
  readonly merchantId?: string;
  readonly jti: string;
  readonly iss: string;
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
}

/** The authenticated caller, as every service sees it. */
export interface Principal {
  readonly id: string;
  readonly actorType: ActorType;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionValue[];
  readonly merchantId?: string;
  readonly tokenId: string;
}

export interface SignAccessTokenInput {
  readonly subject: string;
  readonly actorType: ActorType;
  readonly roles: readonly string[];
  readonly permissions: readonly PermissionValue[];
  readonly merchantId?: string;
  readonly expiresInSeconds: number;
  readonly audience?: string;
}

export interface TokenVerifierConfig {
  /**
   * Local/dev: a shared symmetric secret issued by identity-service.
   * Azure: `jwksUri` points at Entra ID and the secret is not used at all (ADR-011).
   */
  readonly secret?: string;
  readonly jwksUri?: string;
  readonly issuer?: string;
  readonly audience?: string;
  /** Consulted on every verification so a logout takes effect immediately. */
  readonly isRevoked?: (tokenId: string) => Promise<boolean>;
}

export async function signAccessToken(input: SignAccessTokenInput, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenId = randomUUID();

  const builder = new SignJWT({
    actorType: input.actorType,
    roles: [...input.roles],
    permissions: [...input.permissions],
    ...(input.merchantId === undefined ? {} : { merchantId: input.merchantId }),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.subject)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(input.audience ?? ACCESS_TOKEN_AUDIENCE)
    .setJti(tokenId)
    .setIssuedAt(now)
    .setExpirationTime(now + input.expiresInSeconds);

  return builder.sign(new TextEncoder().encode(secret));
}

/**
 * Validates issuer, audience, expiry, signature and revocation.
 *
 * Every one of those is load-bearing: skipping the audience check would let an internal service
 * token be replayed against the public API (trust-boundaries.md §2).
 */
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  private readonly secretKey: Uint8Array | undefined;

  constructor(private readonly config: TokenVerifierConfig) {
    if (config.jwksUri !== undefined) {
      this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
      this.secretKey = undefined;
    } else if (config.secret !== undefined) {
      this.secretKey = new TextEncoder().encode(config.secret);
      this.jwks = undefined;
    } else {
      throw new Error('TokenVerifier requires either a secret or a JWKS URI.');
    }
  }

  async verify(token: string): Promise<Principal> {
    let payload: Record<string, unknown>;

    try {
      const options = {
        issuer: this.config.issuer ?? TOKEN_ISSUER,
        audience: this.config.audience ?? ACCESS_TOKEN_AUDIENCE,
      };

      const result =
        this.jwks === undefined
          ? await jwtVerify(token, this.secretKey!, options)
          : await jwtVerify(token, this.jwks, options);

      payload = result.payload;
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new UnauthenticatedError('The access token has expired.');
      }
      throw new UnauthenticatedError('The access token is invalid.');
    }

    const tokenId = typeof payload.jti === 'string' ? payload.jti : undefined;
    const subject = typeof payload.sub === 'string' ? payload.sub : undefined;

    if (tokenId === undefined || subject === undefined) {
      throw new UnauthenticatedError('The access token is missing required claims.');
    }

    if (this.config.isRevoked !== undefined && (await this.config.isRevoked(tokenId))) {
      throw new UnauthenticatedError('The access token has been revoked.');
    }

    return {
      id: subject,
      actorType: payload.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
      roles: toStringArray(payload.roles),
      permissions: toStringArray(payload.permissions) as PermissionValue[],
      ...(typeof payload.merchantId === 'string' ? { merchantId: payload.merchantId } : {}),
      tokenId,
    };
  }
}

export function assertPermission(principal: Principal, required: PermissionValue): void {
  if (!principal.permissions.includes(required)) {
    throw new ForbiddenError(`Permission "${required}" is required.`, { required });
  }
}

/**
 * A merchant-scoped principal may only touch its own merchant's resources.
 *
 * This check lives in each service, not only at the gateway: an internal caller that skipped the
 * gateway must not be able to read another tenant's data (trust-boundaries.md §6).
 */
export function assertMerchantAccess(principal: Principal, merchantId: string): void {
  if (principal.merchantId === undefined) {
    return; // Platform-scoped principal; permission checks alone govern access.
  }

  if (principal.merchantId !== merchantId) {
    throw new ForbiddenError('This resource belongs to another merchant.', {
      code: ErrorCode.FORBIDDEN,
    });
  }
}

/** Refresh tokens are stored as hashes, so a database leak does not yield usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): string {
  return `rt_${randomUUID()}${randomUUID().replace(/-/g, '')}`;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
