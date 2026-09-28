import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import { type Principal } from '@ledgerflow/auth';
import { Database } from '@ledgerflow/database';
import { ErrorCode, NotFoundError } from '@ledgerflow/errors';
import { assertCaseTransition, type CaseStatus } from './domain/case-state';
import {
  matchStatements,
  parseCsvStatement,
  parseJsonStatement,
  type ExternalTransaction,
  type InternalTransaction,
  type MatchResult,
} from './domain/match';

export interface RunView {
  readonly runId: string;
  readonly results: readonly {
    readonly id: string;
    readonly resultType: string;
    readonly matchReason: string | null;
    readonly internalReference: string | null;
    readonly externalReference: string | null;
    readonly deltaMinor: string | null;
    readonly caseId: string | null;
  }[];
}

@Injectable()
export class ReconciliationService {
  constructor(private readonly database: Database) {}

  /**
   * Imports a statement and matches it. Non-matches become cases.
   * This never writes to the payment or ledger databases.
   */
  async run(input: {
    format: 'CSV' | 'JSON';
    statement: unknown;
    internal: readonly InternalTransaction[];
    provider: string;
  }): Promise<RunView> {
    const external: ExternalTransaction[] =
      input.format === 'CSV'
        ? parseCsvStatement(String(input.statement))
        : parseJsonStatement(input.statement);
    const digest = statementDigest(input.provider, input.format, external);
    const prior = await this.database.query<{ run_id: string }>(
      `SELECT run_id FROM statement_imports WHERE provider = $1 AND file_digest = $2`,
      [input.provider, digest],
    );
    const priorRunId = prior.rows[0]?.run_id;
    if (priorRunId !== undefined) {
      return this.loadRun(priorRunId);
    }

    const matches = matchStatements(input.internal, external);

    return this.database.withTransaction(async (tx) => {
      const run = await tx.query<{ id: string }>(
        `INSERT INTO reconciliation_runs (provider, status) VALUES ($1, 'COMPLETED') RETURNING id`,
        [input.provider],
      );
      const runId = run.rows[0]!.id;
      const imported = await tx.query<{ id: string }>(
        `INSERT INTO statement_imports (run_id, provider, format, row_count, file_digest)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [runId, input.provider, input.format, external.length, digest],
      );
      for (const row of external) {
        await tx.query(
          `INSERT INTO external_transactions (
             import_id, provider, external_reference, payment_reference, amount_minor, currency,
             settlement_date, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            imported.rows[0]!.id,
            input.provider,
            row.externalReference,
            row.paymentReference,
            row.amountMinor.toString(),
            row.currency,
            row.settlementDate,
            row.status,
          ],
        );
      }
      const results = [];

      for (const match of matches) {
        const stored = await tx.query<{ id: string }>(
          `INSERT INTO reconciliation_results (
             run_id, result_type, match_reason, internal_reference, external_reference, delta_minor
           ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            runId,
            match.resultType,
            match.matchReason,
            match.internalReference,
            match.externalReference,
            match.deltaMinor === null ? null : match.deltaMinor.toString(),
          ],
        );
        const resultId = stored.rows[0]!.id;
        let caseId: string | null = null;
        if (match.resultType !== 'MATCHED') {
          const opened = await tx.query<{ id: string }>(
            `INSERT INTO reconciliation_cases (result_id, case_type, status) VALUES ($1, $2, 'OPEN') RETURNING id`,
            [resultId, match.resultType],
          );
          caseId = opened.rows[0]!.id;
        }
        results.push(toResult(resultId, match, caseId));
      }

      return { runId, results };
    });
  }

  async resolve(
    actor: Principal,
    caseId: string,
    to: CaseStatus,
    reason: string,
  ): Promise<{ status: CaseStatus }> {
    return this.database.withTransaction(async (tx) => {
      const current = await tx.query<{ status: CaseStatus }>(
        'SELECT status FROM reconciliation_cases WHERE id = $1 FOR UPDATE',
        [caseId],
      );
      const row = current.rows[0];
      if (row === undefined)
        throw new NotFoundError(ErrorCode.RECONCILIATION_CASE_NOT_FOUND, 'Case not found.');
      assertCaseTransition(row.status, to, reason);

      await tx.query(
        `UPDATE reconciliation_cases
         SET status = $2, resolution_reason = $3, resolved_at = CASE WHEN $2 IN ('RESOLVED', 'IGNORED_WITH_REASON') THEN now() ELSE resolved_at END
         WHERE id = $1`,
        [caseId, to, reason],
      );
      await tx.query(
        `INSERT INTO case_actions (case_id, actor_id, action, previous_status, new_status, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [caseId, actor.id, `case.${to.toLowerCase()}`, row.status, to, reason],
      );
      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: `reconciliation.case.${to.toLowerCase()}`,
        resourceType: 'reconciliation_case',
        resourceId: caseId,
        beforeState: { status: row.status },
        afterState: { status: to },
        reason,
      });
      return { status: to };
    });
  }

  private async loadRun(runId: string): Promise<RunView> {
    const rows = await this.database.query<{
      id: string;
      result_type: string;
      match_reason: string | null;
      internal_reference: string | null;
      external_reference: string | null;
      delta_minor: string | null;
      case_id: string | null;
    }>(
      `SELECT r.id, r.result_type, r.match_reason, r.internal_reference, r.external_reference,
              r.delta_minor::text AS delta_minor, c.id AS case_id
       FROM reconciliation_results r
       LEFT JOIN reconciliation_cases c ON c.result_id = r.id
       WHERE r.run_id = $1
       ORDER BY r.created_at`,
      [runId],
    );

    return {
      runId,
      results: rows.rows.map((row) => ({
        id: row.id,
        resultType: row.result_type,
        matchReason: row.match_reason,
        internalReference: row.internal_reference,
        externalReference: row.external_reference,
        deltaMinor: row.delta_minor,
        caseId: row.case_id,
      })),
    };
  }

  async listCases(): Promise<
    {
      id: string;
      status: string;
      caseType: string;
      resultType: string;
      deltaMinor: string | null;
    }[]
  > {
    const rows = await this.database.query<{
      id: string;
      status: string;
      case_type: string;
      result_type: string;
      delta_minor: string | null;
    }>(
      `SELECT c.id, c.status, c.case_type, r.result_type, r.delta_minor::text AS delta_minor
       FROM reconciliation_cases c
       JOIN reconciliation_results r ON r.id = c.result_id
       ORDER BY c.created_at DESC`,
    );
    return rows.rows.map((row) => ({
      id: row.id,
      status: row.status,
      caseType: row.case_type,
      resultType: row.result_type,
      deltaMinor: row.delta_minor,
    }));
  }

  async getCase(caseId: string): Promise<{
    id: string;
    status: string;
    caseType: string;
    actions: { actorId: string; previousStatus: string; newStatus: string; reason: string }[];
  }> {
    const current = await this.database.query<{ id: string; status: string; case_type: string }>(
      'SELECT id, status, case_type FROM reconciliation_cases WHERE id = $1',
      [caseId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      throw new NotFoundError(ErrorCode.RECONCILIATION_CASE_NOT_FOUND, 'Case not found.');
    }
    const actions = await this.database.query<{
      actor_id: string;
      previous_status: string;
      new_status: string;
      reason: string;
    }>(
      `SELECT actor_id, previous_status, new_status, reason
       FROM case_actions WHERE case_id = $1 ORDER BY created_at`,
      [caseId],
    );
    return {
      id: row.id,
      status: row.status,
      caseType: row.case_type,
      actions: actions.rows.map((action) => ({
        actorId: action.actor_id,
        previousStatus: action.previous_status,
        newStatus: action.new_status,
        reason: action.reason,
      })),
    };
  }
}

function statementDigest(
  provider: string,
  format: string,
  rows: readonly ExternalTransaction[],
): string {
  const lines = rows
    .map(
      (row) =>
        `${row.externalReference}|${row.paymentReference ?? ''}|${row.amountMinor.toString()}|${row.currency}|${row.settlementDate}|${row.status}`,
    )
    .sort();
  return createHash('sha256').update(`${provider}\n${format}\n${lines.join('\n')}`).digest('hex');
}

function toResult(
  id: string,
  match: MatchResult,
  caseId: string | null,
): RunView['results'][number] {
  return {
    id,
    resultType: match.resultType,
    matchReason: match.matchReason,
    internalReference: match.internalReference,
    externalReference: match.externalReference,
    deltaMinor: match.deltaMinor === null ? null : match.deltaMinor.toString(),
    caseId,
  };
}
