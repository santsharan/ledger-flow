import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';

let started = false;

/**
 * Starts tracing when OTEL_ENABLED=true.
 * HTTP, PostgreSQL, and outbound calls are auto-instrumented. Secrets are not attached:
 * the instrumentations record operation names, not statement parameters or headers we redact.
 */
export function startTelemetry(serviceName: string): void {
  if (started || process.env.OTEL_ENABLED !== 'true') {
    return;
  }
  started = true;

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });
  sdk.start();

  const shutdown = (): void => {
    void sdk.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
