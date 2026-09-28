import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { SERVICE_NAME } from '../tokens';
import {
  HEALTH_INDICATORS,
  type HealthCheckResult,
  type HealthIndicator,
  type ReadinessResponse,
} from './health.types';
import { ServiceState } from './service-state';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(SERVICE_NAME) private readonly serviceName: string,
    private readonly state: ServiceState,
    @Optional()
    @Inject(HEALTH_INDICATORS)
    private readonly indicators: HealthIndicator[] = [],
  ) {}

  /** Liveness: is the process running and able to serve? Dependencies are not consulted. */
  @Get('live')
  live(): { status: 'up'; service: string } {
    return { status: 'up', service: this.serviceName };
  }

  /** Readiness: should this instance receive traffic right now? */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    if (this.state.isShuttingDown) {
      void reply.status(503);
      return {
        status: 'down',
        service: this.serviceName,
        checks: { shutdown: { status: 'down', detail: 'Service is shutting down.' } },
      };
    }

    const results = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, HealthCheckResult]> => {
        try {
          return [indicator.name, await indicator.check()];
        } catch (error) {
          return [
            indicator.name,
            { status: 'down', detail: error instanceof Error ? error.message : 'check failed' },
          ];
        }
      }),
    );

    const checks = Object.fromEntries(results);
    const healthy = results.every(([, result]) => result.status === 'up');

    if (!healthy) {
      void reply.status(503);
    }

    return { status: healthy ? 'up' : 'down', service: this.serviceName, checks };
  }
}
