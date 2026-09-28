import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentPrincipal, Permission, RequirePermissions, type Principal } from '@ledgerflow/auth';
import {
  OpenAccountRequestSchema,
  PostJournalRequestSchema,
  ReverseJournalRequestSchema,
  UuidSchema,
  ZodValidationPipe,
  type AccountResponse,
  type BalanceResponse,
  type JournalLineResponse,
  type JournalResponse,
  type OpenAccountRequest,
  type PostJournalRequest,
  type ReverseJournalRequest,
} from '@ledgerflow/contracts';
import { ValidationError } from '@ledgerflow/errors';
import { LedgerService } from './ledger.service';

@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('accounts')
  @RequirePermissions(Permission.LEDGER_POST)
  openAccount(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(OpenAccountRequestSchema)) body: OpenAccountRequest,
  ): Promise<AccountResponse> {
    return this.ledger.openAccount(principal, body);
  }

  @Get('accounts')
  @RequirePermissions(Permission.LEDGER_READ)
  async listAccounts(
    @CurrentPrincipal() principal: Principal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ accounts: AccountResponse[] }> {
    return {
      accounts: await this.ledger.listAccounts(principal, {
        limit: parseLimit(limit),
        offset: parseOffset(offset),
      }),
    };
  }

  @Get('journals')
  @RequirePermissions(Permission.LEDGER_READ)
  async listJournals(
    @CurrentPrincipal() principal: Principal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ journals: Awaited<ReturnType<LedgerService['listJournals']>> }> {
    return {
      journals: await this.ledger.listJournals(principal, {
        limit: parseLimit(limit),
        offset: parseOffset(offset),
      }),
    };
  }

  @Get('accounts/lookup')
  @RequirePermissions(Permission.LEDGER_READ)
  lookupAccount(
    @CurrentPrincipal() principal: Principal,
    @Query('accountCode') accountCode?: string,
    @Query('currency') currency?: string,
    @Query('merchantId') merchantId?: string,
  ): Promise<AccountResponse> {
    if (accountCode === undefined || currency === undefined) {
      throw new ValidationError('accountCode and currency are required.');
    }
    return this.ledger.lookupAccount(principal, {
      accountCode,
      currency,
      ...(merchantId === undefined ? {} : { merchantId }),
    });
  }

  @Get('accounts/:id')
  @RequirePermissions(Permission.LEDGER_READ)
  getAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<AccountResponse> {
    return this.ledger.getAccount(principal, parseUuid(id, 'Account id'));
  }

  @Get('accounts/:id/balance')
  @RequirePermissions(Permission.LEDGER_READ)
  getBalance(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<BalanceResponse> {
    return this.ledger.getBalance(principal, parseUuid(id, 'Account id'));
  }

  @Get('accounts/:id/entries')
  @RequirePermissions(Permission.LEDGER_READ)
  async listEntries(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<{ entries: JournalLineResponse[] }> {
    return {
      entries: await this.ledger.listEntries(
        principal,
        parseUuid(id, 'Account id'),
        parseLimit(limit),
      ),
    };
  }

  @Post('journals')
  @RequirePermissions(Permission.LEDGER_POST)
  postJournal(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(PostJournalRequestSchema)) body: PostJournalRequest,
  ): Promise<JournalResponse> {
    return this.ledger.postJournal(principal, body);
  }

  @Get('journals/:id')
  @RequirePermissions(Permission.LEDGER_READ)
  getJournal(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<JournalResponse> {
    return this.ledger.getJournal(principal, parseUuid(id, 'Journal id'));
  }

  @Post('journals/:id/reverse')
  @RequirePermissions(Permission.LEDGER_POST)
  reverseJournal(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReverseJournalRequestSchema)) body: ReverseJournalRequest,
  ): Promise<JournalResponse> {
    return this.ledger.reverseJournal(principal, parseUuid(id, 'Journal id'), body);
  }
}

function parseUuid(value: string, label: string): string {
  const parsed = UuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${label} must be a UUID.`);
  }
  return parsed.data;
}

function parseOffset(offset: string | undefined): number {
  if (offset === undefined || offset === '') return 0;
  const parsed = Number.parseInt(offset, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 10_000) {
    throw new ValidationError('offset must be between 0 and 10000.');
  }
  return parsed;
}

function parseLimit(limit: string | undefined): number {
  if (limit === undefined) return 50;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 200) {
    throw new ValidationError('limit must be between 1 and 200.');
  }
  return parsed;
}
