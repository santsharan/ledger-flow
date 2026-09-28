import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { LedgerController } from './ledger.controller';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';

export const LedgerConfigSchema = BaseConfigSchema.extend({
  LEDGER_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
});

/**
 * Ledger context: chart of accounts, journals and immutable double-entry postings.
 * This service is the only writer of financial movement.
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = LedgerConfigSchema.parse({ ...env, SERVICE_NAME: 'ledger-service' });

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'ledger-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.LEDGER_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'ledger-service',
          logger: context.logger,
        }),
      ],
      controllers: [LedgerController],
      providers: [
        LedgerRepository,
        LedgerService,
        {
          provide: TOKEN_VERIFIER,
          useValue: new TokenVerifier({ secret: config.JWT_SECRET }),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
