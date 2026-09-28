import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Logger } from '@ledgerflow/logger';
import { type Database } from './database';

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const MIGRATION_FILE_PATTERN = /^(\d{4,})_([a-z0-9_]+)\.sql$/;

/** Namespaced advisory lock id, so two pods starting together cannot migrate concurrently. */
const MIGRATION_LOCK_ID = 4_919_273_004;

export function loadMigrations(directory: string): Migration[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const migrations = files.map((file) => {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (match === null) {
      throw new MigrationError(
        `Migration "${file}" must be named <version>_<name>.sql, for example 0001_create_accounts.sql.`,
      );
    }

    const [, version, name] = match;
    const sql = readFileSync(join(directory, file), 'utf8');

    return {
      version: version!,
      name: name!,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });

  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new MigrationError(`Duplicate migration version ${migration.version}.`);
    }
    versions.add(migration.version);
  }

  return migrations;
}

/**
 * Forward-only versioned migrations (specification §39).
 *
 * Applied migrations are immutable: editing a file that already ran changes its checksum and the
 * runner refuses to start, because the database would no longer match what the file says.
 * A correction is a new migration, the same reasoning as ledger reversals (ADR-003).
 */
export class Migrator {
  constructor(
    private readonly database: Database,
    private readonly logger: Logger,
  ) {}

  async applyAll(migrations: readonly Migration[]): Promise<string[]> {
    return this.database.withConnection(async (executor) => {
      // The lock is taken before the bookkeeping table is created: two pods racing on
      // CREATE TABLE IF NOT EXISTS collide in the system catalogue, not just on the data.
      await executor.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

      try {
        await this.ensureMigrationTable();
        const applied = await this.loadApplied();
        this.assertUnchanged(migrations, applied);

        const appliedVersions = new Set(applied.map((item) => item.version));
        const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));

        for (const migration of pending) {
          await this.apply(migration);
        }

        return pending.map((migration) => migration.version);
      } finally {
        await executor.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      }
    });
  }

  async status(
    migrations: readonly Migration[],
  ): Promise<{ applied: AppliedMigration[]; pending: Migration[] }> {
    await this.ensureMigrationTable();
    const applied = await this.loadApplied();
    const appliedVersions = new Set(applied.map((item) => item.version));

    return {
      applied,
      pending: migrations.filter((migration) => !appliedVersions.has(migration.version)),
    };
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version      text PRIMARY KEY,
        name         text NOT NULL,
        checksum     text NOT NULL,
        applied_at   timestamptz NOT NULL DEFAULT now(),
        execution_ms integer NOT NULL
      )
    `);
  }

  private async loadApplied(): Promise<AppliedMigration[]> {
    const result = await this.database.query<{
      version: string;
      name: string;
      checksum: string;
      applied_at: Date;
    }>('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');

    return result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
  }

  private assertUnchanged(
    migrations: readonly Migration[],
    applied: readonly AppliedMigration[],
  ): void {
    for (const record of applied) {
      const migration = migrations.find((candidate) => candidate.version === record.version);

      if (migration === undefined) {
        throw new MigrationError(
          `Migration ${record.version} (${record.name}) is recorded in the database but missing from disk.`,
        );
      }

      if (migration.checksum !== record.checksum) {
        throw new MigrationError(
          `Migration ${record.version} (${record.name}) has changed since it was applied. ` +
            'Applied migrations are immutable — add a new migration instead.',
        );
      }
    }
  }

  private async apply(migration: Migration): Promise<void> {
    const startedAt = Date.now();

    // Each migration is its own transaction: a failure leaves earlier migrations applied and
    // this one fully rolled back, so a rerun resumes from a known point.
    await this.database.withTransaction(
      async (tx) => {
        await tx.query(migration.sql);
        await tx.query(
          `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt],
        );
      },
      { maxRetries: 0 },
    );

    this.logger.info(
      {
        event: 'database.migration.applied',
        version: migration.version,
        name: migration.name,
        durationMs: Date.now() - startedAt,
      },
      `applied migration ${migration.version}_${migration.name}`,
    );
  }
}
