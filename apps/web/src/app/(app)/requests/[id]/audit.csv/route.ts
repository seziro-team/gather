import { appendAuditEvent, auditCsv, getDb, readAuditTrail, verifyAuditRows } from '@gather/db';
import { currentActor } from '@/lib/actor';
import { getRequest } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';

/**
 * One request's audit trail, as a file somebody can check.
 *
 * plan.md §2.4 quotes a preparer being blamed for a late return who answers "I reached out
 * 6x between February and April". This is that answer, as a document: every reminder, every
 * portal open, every upload and every decision, with the hash that proves none of it was
 * edited afterwards.
 *
 * The whole firm's trail is at `/audit.csv`; this one is scoped to a single request, which
 * is the version you actually send to somebody.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: RouteContext<'/requests/[id]/audit.csv'>,
): Promise<Response> {
  const { id } = await context.params;
  const { membership } = await requireReadyUser();

  const found = await getRequest(membership.firm.id, id);
  if (!found) return new Response('Not found', { status: 404 });

  const rows = await readAuditTrail(getDb(), { firmId: membership.firm.id, requestId: id });
  const verdict = verifyAuditRows(rows);

  // Exporting the trail is itself an event. It happens after the rows are read, so the
  // export does not contain the record of its own creation — which would be circular —
  // but the next export shows that this one happened.
  const actor = await currentActor();
  await getDb().transaction(async (tx) => {
    await appendAuditEvent(tx, {
      action: 'audit.exported',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: membership.firm.id,
      requestId: id,
      targetType: 'request',
      targetId: id,
      metadata: { events: rows.length, rowsIntact: verdict.rowsIntact, scope: 'request' },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });

  const filename = `gather-audit-${id}.csv`;

  return new Response(auditCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Read by `pnpm verify:audit --csv`, and by a person deciding whether to trust the
      // file before opening it in a spreadsheet.
      'X-Gather-Audit-Events': String(rows.length),
      'X-Gather-Audit-Rows-Intact': String(verdict.rowsIntact),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
