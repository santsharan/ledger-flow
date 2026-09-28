/**
 * Structural redaction paths (trust-boundaries.md §5).
 *
 * Redaction is by field path rather than by pattern-matching message text: a regex over a
 * rendered string is easy to bypass and expensive, while a path list is explicit and auditable.
 */
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'clientSecret',
  'privateKey',
  'cardNumber',
  'pan',
  'cvv',
  'customer.email',
  'customer.phone',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  '*.cardNumber',
  '*.cvv',
];

export const REDACTED_PLACEHOLDER = '[REDACTED]';
