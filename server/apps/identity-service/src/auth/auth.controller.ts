import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  CurrentPrincipal,
  Permission,
  Public,
  RequirePermissions,
  type Principal,
} from '@ledgerflow/auth';
import {
  CreateUserRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  ZodValidationPipe,
  type CreateUserRequest,
  type LoginRequest,
  type RefreshRequest,
  type TokenResponse,
  type UserResponse,
} from '@ledgerflow/contracts';
import { UuidSchema } from '@ledgerflow/contracts';
import { ValidationError } from '@ledgerflow/errors';
import { type FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() request: FastifyRequest,
  ): Promise<TokenResponse> {
    return this.auth.login(body.email, body.password, { ipAddress: request.ip });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequestSchema)) body: RefreshRequest,
  ): Promise<TokenResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    // The deny-list entry only needs to outlive the access token it denies.
    const expiresAt = new Date(Date.now() + 3_600_000);
    await this.auth.logout(principal, expiresAt);
  }

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<UserResponse> {
    return this.auth.getUser(principal, principal.id);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @RequirePermissions(Permission.USERS_WRITE)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateUserRequestSchema)) body: CreateUserRequest,
  ): Promise<UserResponse> {
    return this.auth.createUser(principal, body);
  }

  @Get(':id')
  @RequirePermissions(Permission.USERS_READ)
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<UserResponse> {
    const parsed = UuidSchema.safeParse(id);
    if (!parsed.success) {
      throw new ValidationError('User id must be a UUID.');
    }

    return this.auth.getUser(principal, parsed.data);
  }
}
