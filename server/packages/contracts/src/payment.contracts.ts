import { z } from 'zod';

export const CreatePaymentRequestSchema = z.object({
  merchantId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9]\d*$/, 'amountMinor must be a positive integer string'),
  currency: z.string().length(3).toUpperCase(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const MoneyOperationRequestSchema = z.object({
  amountMinor: z
    .string()
    .regex(/^[1-9]\d*$/, 'amountMinor must be a positive integer string')
    .optional(),
});
export type MoneyOperationRequest = z.infer<typeof MoneyOperationRequestSchema>;
