import { bootstrapService } from '@ledgerflow/service-core';
import { AppModule } from './app.module';

void bootstrapService({
  serviceName: 'notification-service',
  createRootModule: (context) => AppModule.register(context),
  globalPrefix: 'api/v1',
});
