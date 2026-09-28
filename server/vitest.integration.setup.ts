import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Points Testcontainers at whichever container runtime this machine uses.
 *
 * Testcontainers probes a fixed list of socket locations, which misses Colima, Rancher Desktop
 * and other non-default contexts. Asking Docker itself where its endpoint is works for all of
 * them, and keeps `pnpm test:integration` a single command on a developer laptop and on CI.
 */
function resolveDockerHost(): string | undefined {
  if (process.env.DOCKER_HOST !== undefined) {
    return process.env.DOCKER_HOST;
  }

  try {
    const endpoint = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();

    return endpoint.length > 0 ? endpoint : undefined;
  } catch {
    return undefined;
  }
}

const dockerHost = resolveDockerHost();

if (dockerHost !== undefined) {
  process.env.DOCKER_HOST = dockerHost;

  // The reaper container mounts the daemon socket from inside the VM, where it is always at
  // the default path even when the host-side socket lives somewhere else.
  if (
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE === undefined &&
    dockerHost.startsWith('unix://') &&
    !existsSync('/var/run/docker.sock')
  ) {
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = '/var/run/docker.sock';
  }
}
