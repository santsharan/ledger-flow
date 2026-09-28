import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ServiceState } from './service-state';

@Global()
@Module({
  controllers: [HealthController],
  providers: [ServiceState],
  exports: [ServiceState],
})
export class HealthModule {}
