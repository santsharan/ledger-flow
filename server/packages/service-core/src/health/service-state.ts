import { Injectable } from '@nestjs/common';

/**
 * Tracks whether this instance should accept new work.
 *
 * On SIGTERM the instance becomes not-ready before anything is torn down, so the load balancer
 * stops sending requests while in-flight work finishes (failure-model.md §6).
 */
@Injectable()
export class ServiceState {
  private shuttingDown = false;

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
