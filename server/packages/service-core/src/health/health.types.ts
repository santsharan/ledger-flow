export type HealthStatus = 'up' | 'down';

export interface HealthCheckResult {
  readonly status: HealthStatus;
  readonly detail?: string;
}

/**
 * A dependency whose availability determines whether this pod should receive traffic.
 * Liveness deliberately does not consult these: a database outage should stop traffic,
 * not trigger a pod restart loop (failure-model.md F1).
 */
export interface HealthIndicator {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');

export interface ReadinessResponse {
  readonly status: HealthStatus;
  readonly service: string;
  readonly checks: Record<string, HealthCheckResult>;
}
