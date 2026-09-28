import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type BaseConfig } from '@ledgerflow/config';
import { type Logger } from '@ledgerflow/logger';
import { HealthModule } from './health/health.module';
import { LOGGER, SERVICE_CONFIG, SERVICE_NAME } from './tokens';

export interface CoreModuleOptions {
  readonly serviceName: string;
  readonly config: BaseConfig;
  readonly logger: Logger;
}

/**
 * Wires the pieces every service needs: its name, validated configuration, logger and
 * health endpoints. Business modules import nothing from here beyond the tokens.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      imports: [HealthModule],
      providers: [
        { provide: SERVICE_NAME, useValue: options.serviceName },
        { provide: SERVICE_CONFIG, useValue: options.config },
        { provide: LOGGER, useValue: options.logger },
      ],
      exports: [SERVICE_NAME, SERVICE_CONFIG, LOGGER, HealthModule],
    };
  }
}
