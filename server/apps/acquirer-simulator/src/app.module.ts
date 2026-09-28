import { type DynamicModule, Module } from '@nestjs/common';
import { BaseConfigSchema } from '@ledgerflow/config';
import { CoreModule, type ServiceContext } from '@ledgerflow/service-core';
import { z } from 'zod';
import { AcquirerController } from './acquirer.controller';
import { AcquirerSimulator } from './simulator';
import { ACQUIRER_ADMIN_TOKEN } from './tokens';

const AcquirerConfigSchema = BaseConfigSchema.extend({
  ACQUIRER_MODE: z
    .enum([
      'SUCCESS',
      'TIMEOUT',
      'TRANSIENT_FAILURE',
      'PERMANENT_FAILURE',
      'DUPLICATE_RESPONSE',
      'DELAYED_SUCCESS',
      'WRONG_AMOUNT',
      'WRONG_CURRENCY',
      'MISSING_SETTLEMENT',
      'DUPLICATE_SETTLEMENT',
    ])
    .default('SUCCESS'),
  ACQUIRER_ADMIN_TOKEN: z.string().min(16).optional(),
});

@Module({})
export class AppModule {
  static register(context: ServiceContext, env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = AcquirerConfigSchema.parse({ ...env, SERVICE_NAME: 'acquirer-simulator' });
    const simulator = new AcquirerSimulator(config.ACQUIRER_MODE);

    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'acquirer-simulator',
          config: context.config,
          logger: context.logger,
        }),
      ],
      controllers: [AcquirerController],
      providers: [
        { provide: AcquirerSimulator, useValue: simulator },
        { provide: ACQUIRER_ADMIN_TOKEN, useValue: config.ACQUIRER_ADMIN_TOKEN },
      ],
    };
  }
}
