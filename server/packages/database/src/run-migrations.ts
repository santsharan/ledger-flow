import { createLogger, type Logger } from '@ledgerflow/logger';
import { Database } from './database';
import { loadMigrations, Migrator } from './migrator';

export interface RunMigrationsOptions {
  readonly connectionString: string;
  readonly directory: string;
  readonly serviceName: string;
  readonly logger?: Logger;
}

/**
 * Applies a service's migrations and exits.
 *
 * Migrations run as a deliberate step — a deployment job in Kubernetes, `make migrate` locally —
 * never as a side effect of a service starting up (specification §39). Several replicas starting
 * at once must not each decide to mutate the schema.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const logger =
    options.logger ??
    createLogger({ service: options.serviceName, environment: 'local', level: 'info' });

  const database = new Database(
    { connectionString: options.connectionString, maxConnections: 2, statementTimeoutMs: 120_000 },
    logger,
  );

  try {
    const migrations = loadMigrations(options.directory);
    const applied = await new Migrator(database, logger).applyAll(migrations);

    logger.info(
      {
        event: 'database.migrations.completed',
        service: options.serviceName,
        applied: applied.length,
        total: migrations.length,
      },
      applied.length === 0 ? 'schema already up to date' : `applied ${applied.length} migration(s)`,
    );

    return applied;
  } finally {
    await database.close();
  }
}
