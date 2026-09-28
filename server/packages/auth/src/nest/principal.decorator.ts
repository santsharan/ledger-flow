import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '@ledgerflow/errors';
import { type Principal } from '../tokens';
import { type AuthenticatedRequest } from './auth.guard';

/** Injects the authenticated caller. Throws if the route somehow bypassed the guard. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.principal === undefined) {
      throw new UnauthenticatedError();
    }

    return request.principal;
  },
);
