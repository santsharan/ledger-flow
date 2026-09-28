import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ValidationError } from '@ledgerflow/errors';
import { z, type ZodType } from 'zod';

/**
 * Validates a request body/query/param against a Zod schema.
 *
 * Every boundary is validated (specification §33) and the parsed value — not the raw input —
 * is what reaches the handler, so unknown fields cannot ride along into a repository.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ValidationError('The request failed validation.', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }

    return result.data as z.infer<TSchema>;
  }
}

/** Amounts cross the wire as integer minor-unit strings (ADR-016). */
export const MoneySchema = z.object({
  amountMinor: z
    .string()
    .regex(/^-?\d+$/, 'amountMinor must be an integer string of minor units'),
  currency: z.string().length(3).toUpperCase(),
});

export type MoneyDto = z.infer<typeof MoneySchema>;

export const UuidSchema = z.string().uuid();

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency-Key must be URL-safe');
