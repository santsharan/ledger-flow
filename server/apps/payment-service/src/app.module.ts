import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard, TOKEN_VERIFIER, TokenVerifier } from '@ledgerflow/auth';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, DatabaseModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { OperationsController } from './operations.controller';
import { PaymentController } from './payment.controller';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { ACQUIRER, HttpAcquirerClient, HttpLedgerClient, LEDGER, type AcquirerPort, type LedgerPort } from './ports';

export const PaymentConfigSchema = BaseConfigSchema.extend({
  PAYMENT_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32),
  ACQUIRER_BASE_URL: z.string().url().optional(),
  LEDGER_BASE_URL: z.string().url().optional(),
});

export interface PaymentOverrides {
  readonly acquirer?: AcquirerPort;
  readonly ledger?: LedgerPort;
}

@Module({})
export class AppModule {
  static register(
    context: ServiceContext,
    env: NodeJS.ProcessEnv = process.env,
    overrides: PaymentOverrides = {},
  ): DynamicModule {
    const config = PaymentConfigSchema.parse({ ...env, SERVICE_NAME: 'payment-service' });

    const acquirer =
      overrides.acquirer ??
      new HttpAcquirerClient(config.ACQUIRER_BASE_URL ?? 'http://127.0.0.1:3009');
    const ledger =
      overrides.ledger ??
      new HttpLedgerClient(config.LEDGER_BASE_URL ?? 'http://127.0.0.1:3004', config.JWT_SECRET);

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'payment-service',
          config: context.config,
          logger: context.logger,
        }),
        DatabaseModule.forRoot({
          connectionString: config.PAYMENT_DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          applicationName: 'payment-service',
          logger: context.logger,
        }),
      ],
      controllers: [PaymentController, OperationsController],
      providers: [
        PaymentRepository,
        PaymentService,
        { provide: ACQUIRER, useValue: acquirer },
        { provide: LEDGER, useValue: ledger },
        { provide: TOKEN_VERIFIER, useValue: new TokenVerifier({ secret: config.JWT_SECRET }) },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
