import { z } from 'zod';

export const MERCHANT_STATUSES = [
  'MERCHANT_PENDING',
  'MERCHANT_ACTIVE',
  'MERCHANT_SUSPENDED',
  'MERCHANT_CLOSED',
] as const;

export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export const SETTLEMENT_SCHEDULES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export const CreateMerchantRequestSchema = z.object({
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  country: z.string().length(2).toUpperCase(),
  contactEmail: z.string().email().max(320),
  settlementCurrency: z.string().length(3).toUpperCase(),
  settlementSchedule: z.enum(SETTLEMENT_SCHEDULES).default('DAILY'),
  /** Fee in basis points; percentage fees are never floats (ADR-016). */
  feeBasisPoints: z.number().int().min(0).max(10_000).default(250),
  fixedFeeMinor: z.string().regex(/^\d+$/).default('0'),
});
export type CreateMerchantRequest = z.infer<typeof CreateMerchantRequestSchema>;

export const UpdateSettlementConfigSchema = z.object({
  settlementSchedule: z.enum(SETTLEMENT_SCHEDULES),
  feeBasisPoints: z.number().int().min(0).max(10_000),
  fixedFeeMinor: z.string().regex(/^\d+$/),
  holdPeriodDays: z.number().int().min(0).max(90),
  reason: z.string().min(3).max(500),
});
export type UpdateSettlementConfig = z.infer<typeof UpdateSettlementConfigSchema>;

export const MerchantStatusChangeSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type MerchantStatusChange = z.infer<typeof MerchantStatusChangeSchema>;

export interface MerchantResponse {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly contactEmail: string;
  readonly status: MerchantStatus;
  readonly settlementCurrency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SettlementConfigResponse {
  readonly merchantId: string;
  readonly settlementSchedule: string;
  readonly feeBasisPoints: number;
  readonly fixedFeeMinor: string;
  readonly holdPeriodDays: number;
  readonly currency: string;
  readonly updatedAt: string;
}
