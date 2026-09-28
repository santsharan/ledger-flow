import { type Database } from './database';

export interface DatabaseHealthResult {
  readonly status: 'up' | 'down';
  readonly detail?: string;
}

/**
 * Readiness check for the pool. Implements the `HealthIndicator` shape from `service-core`
 * without importing it, so the database package stays free of HTTP concerns.
 */
export class DatabaseHealthIndicator {
  readonly name = 'postgres';

  constructor(private readonly database: Database) {}

  async check(): Promise<DatabaseHealthResult> {
    try {
      const alive = await this.database.ping();
      const stats = this.database.stats;

      if (!alive) {
        return { status: 'down', detail: 'ping returned an unexpected result' };
      }

      // A saturated pool with queued acquirers means this instance cannot serve requests
      // reliably, even though the database itself is up (failure-model.md F2).
      if (stats.waiting > 0 && stats.idle === 0 && stats.total >= stats.max) {
        return { status: 'down', detail: `connection pool saturated (${stats.waiting} waiting)` };
      }

      return { status: 'up' };
    } catch (error) {
      return { status: 'down', detail: error instanceof Error ? error.message : 'unknown error' };
    }
  }
}
