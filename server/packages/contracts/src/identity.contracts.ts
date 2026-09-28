import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(16).max(256),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const CreateUserRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
  fullName: z.string().min(1).max(200),
  roles: z.array(z.string().min(1).max(64)).min(1),
  merchantId: z.string().uuid().optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
}

export interface UserResponse {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly merchantId: string | null;
  readonly createdAt: string;
}
