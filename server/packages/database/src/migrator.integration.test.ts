import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentLogger, startPostgres, type PostgresFixture } from '@ledgerflow/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './database';
import { loadMigrations, MigrationError, Migrator } from './migrator';

let fixture: PostgresFixture;
let database: Database;
let migrator: Migrator;

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_migrations_test' });
  database = new Database({ connectionString: fixture.connectionString }, silentLogger());
  migrator = new Migrator(database, silentLogger());
}, 180_000);

afterAll(async () => {
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  await database.query('DROP TABLE IF EXISTS schema_migrations, widgets, gadgets');
});

function migrationDirectory(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerflow-migrations-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(directory, name), contents);
  }
  return directory;
}

describe('loadMigrations', () => {
  it('loads and orders migrations by version', () => {
    const directory = migrationDirectory({
      '0002_create_gadgets.sql': 'CREATE TABLE gadgets (id int);',
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int);',
    });

    const migrations = loadMigrations(directory);

    expect(migrations.map((migration) => migration.version)).toEqual(['0001', '0002']);
    expect(migrations[0]!.name).toBe('create_widgets');
    expect(migrations[0]!.checksum).toHaveLength(64);
  });

  it('rejects a badly named migration', () => {
    const directory = migrationDirectory({ 'create-widgets.sql': 'SELECT 1;' });

    expect(() => loadMigrations(directory)).toThrow(MigrationError);
  });
});

describe('Migrator', () => {
  it('applies pending migrations in order', async () => {
    const directory = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
      '0002_create_gadgets.sql': 'CREATE TABLE gadgets (id int PRIMARY KEY);',
    });

    const applied = await migrator.applyAll(loadMigrations(directory));

    expect(applied).toEqual(['0001', '0002']);

    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('widgets', 'gadgets')
       ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(['gadgets', 'widgets']);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const directory = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
    });
    const migrations = loadMigrations(directory);

    await migrator.applyAll(migrations);
    const second = await migrator.applyAll(migrations);

    expect(second).toEqual([]);
  });

  it('applies only the new migration when one is added', async () => {
    const first = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
    });
    await migrator.applyAll(loadMigrations(first));

    const second = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
      '0002_create_gadgets.sql': 'CREATE TABLE gadgets (id int PRIMARY KEY);',
    });

    await expect(migrator.applyAll(loadMigrations(second))).resolves.toEqual(['0002']);
  });

  it('refuses to run when an applied migration was edited', async () => {
    const original = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
    });
    await migrator.applyAll(loadMigrations(original));

    const edited = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY, name text);',
    });

    await expect(migrator.applyAll(loadMigrations(edited))).rejects.toThrow(MigrationError);
  });

  it('refuses to run when an applied migration disappeared from disk', async () => {
    const original = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
    });
    await migrator.applyAll(loadMigrations(original));

    await expect(migrator.applyAll([])).rejects.toThrow(MigrationError);
  });

  it('rolls back a failing migration entirely', async () => {
    const directory = migrationDirectory({
      '0001_bad.sql': `CREATE TABLE widgets (id int PRIMARY KEY);
                       CREATE TABLE widgets (id int PRIMARY KEY);`,
    });

    await expect(migrator.applyAll(loadMigrations(directory))).rejects.toThrow();

    const tables = await database.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'widgets'`,
    );
    expect(tables.rowCount).toBe(0);

    const recorded = await database.query('SELECT version FROM schema_migrations');
    expect(recorded.rowCount).toBe(0);
  });

  it('serializes concurrent migrators with an advisory lock', async () => {
    const directory = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
      '0002_create_gadgets.sql': 'CREATE TABLE gadgets (id int PRIMARY KEY);',
    });
    const migrations = loadMigrations(directory);

    // Two pods starting at the same moment: exactly one applies each migration.
    const [first, second] = await Promise.all([
      migrator.applyAll(migrations),
      new Migrator(database, silentLogger()).applyAll(migrations),
    ]);

    expect([...first, ...second].sort()).toEqual(['0001', '0002']);
  });

  it('reports applied and pending migrations', async () => {
    const directory = migrationDirectory({
      '0001_create_widgets.sql': 'CREATE TABLE widgets (id int PRIMARY KEY);',
      '0002_create_gadgets.sql': 'CREATE TABLE gadgets (id int PRIMARY KEY);',
    });
    const migrations = loadMigrations(directory);

    await migrator.applyAll([migrations[0]!]);
    const status = await migrator.status(migrations);

    expect(status.applied.map((item) => item.version)).toEqual(['0001']);
    expect(status.pending.map((item) => item.version)).toEqual(['0002']);
  });
});
