import { appendAuditEvent, auditCsv, getDb, readAuditTrail, verifyAuditRows } from '@gather/db';
import { currentActor } from '@/lib/actor';
import { requireReadyUser } from '@/lib/session';

/**
 * The firm's whole audit trail, as CSV.
 *
 * Optionally bounded by `?from=` and `?to=` (ISO dates), which is what a firm producing
 * records for one tax year wants. Unbounded, this is the complete chain from the very
 * first event, and `verifyAuditRows` can then prove not just that no row was altered but
 * that none is missing.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function GET(request: Request): Promise<Response> {
  const { membership } = await requireReadyUser();
  const params = new URL(request.url).searchParams;

  const from = parseDate(params.get('from'));
  const to = parseDate(params.get('to'));

  const rows = await readAuditTrail(getDb(), { firmId: membership.firm.id, from, to });
  const verdict = verifyAuditRows(rows);

  const actor = await currentActor();
  await getDb().transaction(async (tx) => {
    await appendAuditEvent(tx, {
      action: 'audit.exported',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: membership.firm.id,
      targetType: 'firm',
      targetId: membership.firm.id,
      metadata: {
        events: rows.length,
        rowsIntact: verdict.rowsIntact,
        chainLinked: verdict.chainLinked,
        scope: 'firm',
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(auditCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gather-audit-${stamp}.csv"`,
      'X-Gather-Audit-Events': String(rows.length),
      'X-Gather-Audit-Rows-Intact': String(verdict.rowsIntact),
      'X-Gather-Audit-Chain-Linked': String(verdict.chainLinked),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
