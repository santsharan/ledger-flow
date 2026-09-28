import { BaseConfigSchema } from '@ledgerflow/config';
import { z } from 'zod';

export const IdentityConfigSchema = BaseConfigSchema.extend({
  IDENTITY_DATABASE_URL: z.string().url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),

  /**
   * Local/dev signing secret. In Azure, tokens are issued by Microsoft Entra ID and validated
   * against its JWKS, so no shared secret exists (ADR-011).
   */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  /** Consecutive failures before an account is locked (abuse mitigation). */
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
});

export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
