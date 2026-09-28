import { join } from 'node:path';
import { runMigrations } from '@ledgerflow/database';

const connectionString = process.env.RISK_DATABASE_URL;

if (connectionString === undefined) {
  process.stderr.write('RISK_DATABASE_URL is required.\n');
  process.exit(1);
}

void runMigrations({
  connectionString,
  // Migrations live beside the source and are copied into the image, so the deployment job
  // runs exactly the files that shipped with the service version.
  directory: join(__dirname, '..', 'migrations'),
  serviceName: 'risk-service',
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
