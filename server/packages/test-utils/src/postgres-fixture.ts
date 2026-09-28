import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface PostgresFixture {
  readonly connectionString: string;
  readonly container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL instance for integration tests.
 *
 * Integration tests run against the real database rather than a mock, because the behaviour
 * under test — constraints, row locks, deadlock detection, transaction isolation — only exists
 * in PostgreSQL (specification §64).
 */
export async function startPostgres(
  options: { image?: string; database?: string } = {},
): Promise<PostgresFixture> {
  const container = await new PostgreSqlContainer(options.image ?? 'postgres:17-alpine')
    .withDatabase(options.database ?? 'ledgerflow_test')
    .withUsername('ledgerflow_test')
    .withPassword('ledgerflow_test')
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
      '-c',
      'deadlock_timeout=200ms',
      '-c',
      'log_lock_waits=on',
      '-c',
      'max_connections=100',
    ])
    .start();

  return {
    container,
    connectionString: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
