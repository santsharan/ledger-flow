import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '@ledgerflow/errors';
import { type FastifyRequest } from 'fastify';
import { assertPermission, type Principal, type TokenVerifier } from '../tokens';
import { type PermissionValue } from '../permissions';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export const PUBLIC_ROUTE = 'ledgerflow:public';
export const REQUIRED_PERMISSIONS = 'ledgerflow:permissions';

/** Marks a route as reachable without authentication. Used sparingly: login, health. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export const RequirePermissions = (
  ...permissions: PermissionValue[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export interface AuthenticatedRequest extends FastifyRequest {
  principal?: Principal;
}

/**
 * Authenticates the bearer token and enforces the route's required permissions.
 *
 * Routes are authenticated by default — a new endpoint is protected unless someone deliberately
 * marks it `@Public()`, which is the safer direction for the mistake to run in.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.url.split('?')[0];
    if (path === '/health/live' || path === '/health/ready') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      throw new UnauthenticatedError('A bearer access token is required.');
    }

    const principal = await this.verifier.verify(token);
    request.principal = principal;

    const required = this.reflector.getAllAndOverride<PermissionValue[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);

    for (const permission of required ?? []) {
      assertPermission(principal, permission);
    }

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}
