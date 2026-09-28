import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

export const SettlementConfigSchema = BaseConfigSchema.extend({
  SETTLEMENT_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
});

@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = SettlementConfigSchema.parse({ ...env, SERVICE_NAME: 'settlement-service' });
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'settlement-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.SETTLEMENT_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'settlement-service',
          logger: context.logger,
        }),
      ],
      controllers: [SettlementController],
      providers: [
        SettlementService,
        { provide: TOKEN_VERIFIER, useValue: new TokenVerifier({ secret: config.JWT_SECRET }) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
