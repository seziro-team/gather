import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { findRequestFile, getDb, request as requestTable } from '@gather/db';
import {
  checkFileDownload,
  downloadable,
  fileResponse,
  firmScope,
  openFile,
  refusedBecause,
} from '@/lib/files';
import { requireReadyUser } from '@/lib/session';
import { limit, tooManyRequests } from '@/lib/throttle';

/**
 * The firm downloading what a client sent in.
 *
 * The same file, the same headers and the same signature check as the portal route — only
 * the question of who is asking is different. A signed-in user reaches a file through their
 * firm's ownership of the request it belongs to, so one firm's link is meaningless to
 * another and a file id on its own is worth nothing.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/file/[id]'>,
): Promise<Response> {
  const { id } = await context.params;
  const { membership } = await requireReadyUser();

  const limited = await limit('file.download', membership.firm.id);
  if (!limited.ok) return tooManyRequests(limited, 'file.download');

  if (!checkFileDownload(id, firmScope(membership.firm.id), request.nextUrl.searchParams)) {
    return new Response('That download link has expired. Reload the page and try again.', {
      status: 403,
    });
  }

  const requestId = request.nextUrl.searchParams.get('request') ?? '';
  const owned = await getDb()
    .select({ id: requestTable.id })
    .from(requestTable)
    .where(and(eq(requestTable.id, requestId), eq(requestTable.firmId, membership.firm.id)))
    .limit(1);
  if (owned.length === 0) return new Response('Not found', { status: 404 });

  const found = await findRequestFile(getDb(), requestId, id);
  if (!found) return new Response('Not found', { status: 404 });

  // A quarantined file is refused to the firm too. "The firm asked for it" is not a reason
  // to hand somebody a file a scanner has identified as malware.
  if (!downloadable(found.file)) {
    return new Response(refusedBecause(found.file), { status: 403 });
  }

  return fileResponse(await openFile(found.file), found.file);
}
