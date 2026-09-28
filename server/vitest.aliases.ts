import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Maps `@ledgerflow/<pkg>` to the package source so tests run against sources rather than
 * build output. Mirrors the `paths` mapping in the root tsconfig.
 */
export function workspaceAliases(): Record<string, string> {
  // Vitest resolves its config relative to the workspace root, which is also the cwd.
  const packagesDir = resolve(process.cwd(), 'packages');
  const aliases: Record<string, string> = {};

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    aliases[`@ledgerflow/${entry.name}`] = join(packagesDir, entry.name, 'src', 'index.ts');
  }

  return aliases;
}
