import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { MerchantController } from './merchant.controller';
import { MerchantRepository } from './merchant.repository';
import { MerchantService } from './merchant.service';

export const MerchantConfigSchema = BaseConfigSchema.extend({
  MERCHANT_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
});

/**
 * Merchant context: profile, status and settlement configuration.
 *
 * Token validation here is signature + issuer + audience + expiry only. Unlike identity-service
 * this service cannot consult the revocation list, because that table belongs to another
 * bounded context — which is why access tokens are short-lived (see limitations).
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = MerchantConfigSchema.parse({ ...env, SERVICE_NAME: 'merchant-service' });

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'merchant-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.MERCHANT_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'merchant-service',
          logger: context.logger,
        }),
      ],
      controllers: [MerchantController],
      providers: [
        MerchantRepository,
        MerchantService,
        {
          provide: TOKEN_VERIFIER,
          useValue: new TokenVerifier({ secret: config.JWT_SECRET }),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
