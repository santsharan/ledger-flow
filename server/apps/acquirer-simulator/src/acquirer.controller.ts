import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Put, Res } from '@nestjs/common';
import { UnauthenticatedError, ValidationError } from '@ledgerflow/errors';
import { type FastifyReply } from 'fastify';
import { ACQUIRER_ADMIN_TOKEN } from './tokens';
import {
  ACQUIRER_MODES,
  AcquirerSimulator,
  ProviderTransportError,
  type AcquirerMode,
  type AcquirerOperation,
} from './simulator';

interface ExecuteBody {
  attemptId?: string;
  paymentId?: string;
  operation?: AcquirerOperation;
  amountMinor?: string;
  currency?: string;
}

@Controller('acquirer')
export class AcquirerController {
  constructor(
    private readonly simulator: AcquirerSimulator,
    @Inject(ACQUIRER_ADMIN_TOKEN) private readonly adminToken: string | undefined,
  ) {}

  @Post('execute')
  @HttpCode(200)
  async execute(
    @Body() body: ExecuteBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Record<string, string>> {
    if (
      body.attemptId === undefined ||
      body.paymentId === undefined ||
      body.operation === undefined ||
      body.amountMinor === undefined ||
      body.currency === undefined
    ) {
      throw new ValidationError('attemptId, paymentId, operation, amountMinor and currency are required.');
    }

    try {
      const result = await this.simulator.execute({
        attemptId: body.attemptId,
        paymentId: body.paymentId,
        operation: body.operation,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
      });
      return serialize(result);
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        void reply.status(504);
        return { outcome: 'UNKNOWN', attemptId: body.attemptId };
      }
      throw error;
    }
  }

  @Get('attempts/:id')
  lookup(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply): Record<string, string> {
    const result = this.simulator.lookup(id);
    if (result === null) {
      void reply.status(404);
      return { outcome: 'NOT_FOUND' };
    }
    return serialize(result);
  }

  /**
   * Failure-mode control. Refused unless the caller presents the internal admin token.
   * This route is not mounted behind the public gateway.
   */
  @Put('mode')
  @HttpCode(200)
  setMode(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: { mode?: string },
  ): { mode: AcquirerMode } {
    if (this.adminToken === undefined || token !== this.adminToken) {
      throw new UnauthenticatedError('Acquirer failure controls are internal.');
    }
    if (!isMode(body.mode)) {
      throw new ValidationError(`mode must be one of ${ACQUIRER_MODES.join(', ')}.`);
    }
    this.simulator.setMode(body.mode);
    return { mode: body.mode };
  }
}

function isMode(value: string | undefined): value is AcquirerMode {
  return value !== undefined && (ACQUIRER_MODES as readonly string[]).includes(value);
}

function serialize(result: {
  outcome: string;
  providerReference?: string;
  amountMinor?: bigint;
  currency?: string;
  failureCode?: string;
  failureReason?: string;
}): Record<string, string> {
  if (result.outcome === 'APPROVED') {
    return {
      outcome: 'APPROVED',
      providerReference: result.providerReference ?? '',
      amountMinor: (result.amountMinor ?? 0n).toString(),
      currency: result.currency ?? '',
    };
  }
  return {
    outcome: 'DECLINED',
    failureCode: result.failureCode ?? 'DECLINED',
    failureReason: result.failureReason ?? 'Declined.',
  };
}
