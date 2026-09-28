import { type DynamicModule, Module } from '@nestjs/common';
import { CoreModule, type ServiceContext } from '@ledgerflow/service-core';

/**
 * Edge routing, authentication and rate limiting for LedgerFlow APIs.
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: 'api-gateway',
          config: context.config,
          logger: context.logger,
        }),
      ],
    };
  }
}
