import { type DynamicModule, Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Database, DatabaseHealthIndicator, type DatabaseConfig } from '@ledgerflow/database';
import { type Logger } from '@ledgerflow/logger';
import { HEALTH_INDICATORS, type HealthIndicator } from './health/health.types';

export const DATABASE = Symbol('DATABASE');

export interface DatabaseModuleOptions extends DatabaseConfig {
  readonly logger: Logger;
}

/**
 * Provides the service's single `Database` instance and registers its readiness check.
 *
 * The pool is closed during graceful shutdown, after message consumption has stopped, so
 * in-flight transactions can commit first (failure-model.md §6).
 */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly database: Database) {}

  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    const { logger, ...databaseConfig } = options;
    const database = new Database(databaseConfig, logger);

    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE, useValue: database },
        { provide: Database, useValue: database },
        {
          provide: HEALTH_INDICATORS,
          useValue: [new DatabaseHealthIndicator(database)] satisfies HealthIndicator[],
        },
      ],
      exports: [DATABASE, Database, HEALTH_INDICATORS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
