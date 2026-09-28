import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

export const ReconciliationConfigSchema = BaseConfigSchema.extend({
  RECONCILIATION_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
});

@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = ReconciliationConfigSchema.parse({
      ...env,
      SERVICE_NAME: 'reconciliation-service',
    });
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'reconciliation-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.RECONCILIATION_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'reconciliation-service',
          logger: context.logger,
        }),
      ],
      controllers: [ReconciliationController],
      providers: [
        ReconciliationService,
        { provide: TOKEN_VERIFIER, useValue: new TokenVerifier({ secret: config.JWT_SECRET }) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
