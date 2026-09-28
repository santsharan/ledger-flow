import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { workspaceAliases } from './vitest.aliases';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/*.integration.test.ts', 'packages/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.integration.setup.ts'],
    // Integration tests start real PostgreSQL/Kafka/Redis containers.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
