import { bootstrapService } from '@ledgerflow/service-core';
import { AppModule } from './app.module';

void bootstrapService({
  serviceName: 'settlement-service',
  createRootModule: (context) => AppModule.register(context),
  globalPrefix: 'api/v1',
});
