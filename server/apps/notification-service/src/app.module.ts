import { type DynamicModule, Module } from '@nestjs/common';
import { CoreModule, type ServiceContext } from '@ledgerflow/service-core';

/**
 * Notification requests, simulated delivery and retries.
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'notification-service',
          config: context.config,
          logger: context.logger,
        }),
      ],
    };
  }
}
