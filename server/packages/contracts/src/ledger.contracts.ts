import { z } from 'zod';

export const AccountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY']);
export const DirectionSchema = z.enum(['DEBIT', 'CREDIT']);

export const OpenAccountRequestSchema = z.object({
  accountCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, 'accountCode must be uppercase letters, digits and underscores'),
  accountType: AccountTypeSchema,
  currency: z.string().length(3).toUpperCase(),
  merchantId: z.string().uuid().optional(),
});
export type OpenAccountRequest = z.infer<typeof OpenAccountRequestSchema>;

const positiveMinor = z
  .string()
  .regex(/^[1-9]\d*$/, 'amountMinor must be a positive integer string of minor units');

export const JournalLineSchema = z.object({
  accountId: z.string().uuid(),
  direction: DirectionSchema,
  amountMinor: positiveMinor,
  currency: z.string().length(3).toUpperCase(),
});

export const PostJournalRequestSchema = z.object({
  transactionId: z.string().min(1).max(128),
  referenceType: z.string().min(1).max(64),
  referenceId: z.string().min(1).max(128),
  currency: z.string().length(3).toUpperCase(),
  description: z.string().min(1).max(500),
  lines: z.array(JournalLineSchema).min(2).max(50),
});
export type PostJournalRequest = z.infer<typeof PostJournalRequestSchema>;

export const ReverseJournalRequestSchema = z.object({
  transactionId: z.string().min(1).max(128),
  reason: z.string().min(3).max(500),
});
export type ReverseJournalRequest = z.infer<typeof ReverseJournalRequestSchema>;

export interface AccountResponse {
  readonly id: string;
  readonly merchantId: string | null;
  readonly accountCode: string;
  readonly accountType: string;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface BalanceResponse {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountType: string;
  readonly currency: string;
  readonly debitMinor: string;
  readonly creditMinor: string;
  readonly balanceMinor: string;
}

export interface JournalLineResponse {
  readonly accountId: string;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountMinor: string;
  readonly currency: string;
  readonly sequence: number;
}

export interface JournalResponse {
  readonly id: string;
  readonly transactionId: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly currency: string;
  readonly description: string;
  readonly status: 'POSTED' | 'REVERSED';
  readonly reversesJournalId: string | null;
  readonly lines: readonly JournalLineResponse[];
  /** True when this reference was already posted and the original journal was returned. */
  readonly replayed: boolean;
}
