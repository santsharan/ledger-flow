import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { Database } from '@ledgerflow/database';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { AuthController, UsersController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { TokenRepository } from './auth/token.repository';
import { IdentityConfigSchema, type IdentityConfig } from './config';
import { IDENTITY_CONFIG } from './tokens';
import { UserRepository } from './users/user.repository';

/**
 * Identity context: users, roles, permissions, tokens and revocation.
 * Owns no merchant, payment or ledger data (bounded-contexts.md).
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = IdentityConfigSchema.parse({ ...env, SERVICE_NAME: 'identity-service' });

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'identity-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.IDENTITY_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'identity-service',
          logger: context.logger,
        }),
      ],
      controllers: [AuthController, UsersController],
      providers: [
        { provide: IDENTITY_CONFIG, useValue: config satisfies IdentityConfig },
        UserRepository,
        TokenRepository,
        AuthService,
        {
          // Revocation is checked on every request, so logging out takes effect immediately
          // rather than at the end of the access token's lifetime.
          provide: TOKEN_VERIFIER,
          useFactory: (database: Database, tokens: TokenRepository): TokenVerifier =>
            new TokenVerifier({
              secret: config.JWT_SECRET,
              isRevoked: (tokenId) => tokens.isAccessTokenRevoked(database, tokenId),
            }),
          inject: [Database, TokenRepository],
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
