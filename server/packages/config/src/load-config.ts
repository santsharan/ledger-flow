import { type z } from 'zod';

export class ConfigurationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates process environment against a schema.
 *
 * Throws with the offending variable names — never with their values, since environment
 * variables routinely hold secrets and this error is printed to logs on a failed boot.
 */
export function loadConfig<TSchema extends z.ZodType>(
  schema: TSchema,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });

    throw new ConfigurationError(
      `Invalid configuration: ${issues.length} problem(s) found.`,
      issues,
    );
  }

  return result.data as z.infer<TSchema>;
}
