import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { appendAuditEvent, filesForDownload, getDb } from '@gather/db';
import { buildArchive, buildManifest, sanitize } from '@/lib/archive';
import { currentActor } from '@/lib/actor';
import { getRequest } from '@/lib/requests';
import { requireReadyUser } from '@/lib/session';

/**
 * Everything a client sent, as one zip.
 *
 * A route handler rather than a server action: this streams hundreds of megabytes, and a
 * server action's return value is a serialised payload. Authorisation is the signed-in
 * user's own session and the firm-scoped `getRequest` — no signed URL, because unlike a
 * single file download nothing needs to hand this link to a browser separately.
 *
 * `?include=all` adds the versions that were superseded when the firm sent an item back.
 * The default is the current set, because that is what "download everything" means to
 * somebody about to hand a folder to a tax preparer.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext<'/requests/[id]/download'>,
): Promise<Response> {
  const { id } = await context.params;
  const { membership } = await requireReadyUser();

  const found = await getRequest(membership.firm.id, id);
  if (!found) return new Response('Not found', { status: 404 });

  const includeSuperseded = request.nextUrl.searchParams.get('include') === 'all';
  const all = await filesForDownload(getDb(), id);
  const included = includeSuperseded ? all : all.filter((entry) => entry.current);
  const skipped = includeSuperseded ? [] : all.filter((entry) => !entry.current);

  if (included.length === 0) {
    return new Response('This request has no files to download yet.', { status: 404 });
  }

  const generatedAt = new Date();
  const rootFolder = sanitize(`${found.client.name} - ${found.request.title}`);

  // Audited before the bytes move: a firm taking a copy of a client's tax documents off
  // the system is exactly the kind of access 16 CFR 314.4(c)(8) asks to be logged, and an
  // event written only on success would miss a download that failed halfway.
  const actor = await currentActor();
  await getDb().transaction(async (tx) => {
    await appendAuditEvent(tx, {
      action: 'request.downloaded',
      actorType: 'user',
      actorId: actor.actorId,
      firmId: membership.firm.id,
      requestId: id,
      targetType: 'request',
      targetId: id,
      metadata: {
        files: included.length,
        supersededIncluded: includeSuperseded,
        bytes: included.reduce((total, entry) => total + entry.file.size, 0),
      },
      ip: actor.context.ip,
      ua: actor.context.ua,
    });
  });

  const archive = buildArchive({
    rootFolder,
    files: included,
    manifest: buildManifest({
      firmName: membership.firm.name,
      clientName: found.client.name,
      requestTitle: found.request.title,
      generatedAt,
      files: included,
      skipped,
    }),
  });

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      // No Content-Length: the archive is streamed and its size is not known until the
      // last byte. A wrong length is worse than none.
      'Content-Disposition': `attachment; filename="${rootFolder.replace(/[^\x20-\x7e]/g, '_')}.zip"; filename*=UTF-8''${encodeURIComponent(`${rootFolder}.zip`)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
