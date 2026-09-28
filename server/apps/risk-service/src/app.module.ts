import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

const RiskConfigSchema = BaseConfigSchema.extend({
  RISK_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
});

@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = RiskConfigSchema.parse({ ...env, SERVICE_NAME: 'risk-service' });
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'risk-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.RISK_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'risk-service',
          logger: context.logger,
        }),
      ],
      controllers: [RiskController],
      providers: [
        RiskService,
        { provide: TOKEN_VERIFIER, useValue: new TokenVerifier({ secret: config.JWT_SECRET }) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
