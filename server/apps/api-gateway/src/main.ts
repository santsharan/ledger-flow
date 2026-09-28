import { bootstrapService } from '@ledgerflow/service-core';
import { AppModule } from './app.module';

void bootstrapService({
  serviceName: 'api-gateway',
  createRootModule: (context) => AppModule.register(context),
  globalPrefix: 'api/v1',
});
