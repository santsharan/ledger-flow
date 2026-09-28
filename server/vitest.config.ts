import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { workspaceAliases } from './vitest.aliases';

export default defineConfig({
  // NestJS relies on decorator metadata; esbuild does not emit it, so SWC compiles the tests.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: workspaceAliases(),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['apps/**/src/**', 'packages/**/src/**'],
    },
  },
});
