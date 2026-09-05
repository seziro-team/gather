import type { NextRequest } from 'next/server';
import { findRequestFile, getDb } from '@gather/db';
import { checkFileDownload, fileResponse, openFile, portalScope } from '@/lib/files';
import { currentPortal } from '@/lib/portal';

/**
 * A client downloading something they uploaded.
 *
 * Three separate things have to hold, and the order matters:
 *
 *  1. A live portal session for **this** request.
 *  2. A signature that was minted for this file, in this request's scope, minutes ago.
 *  3. The file actually belonging to this request — checked in the query, via
 *     file → response → item → section → request.
 *
 * Point 3 is plan.md §9's acceptance ⑤. A session for request A asking for request B's
 * file gets a 404 and no hint that the id exists, because the join simply finds nothing.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: RouteContext<'/portal/[id]/file/[fileId]'>,
): Promise<Response> {
  const { id, fileId } = await context.params;

  const portal = await currentPortal(id);
  if (!portal) return new Response('Link expired', { status: 401 });

  if (!checkFileDownload(fileId, portalScope(portal.request.id), request.nextUrl.searchParams)) {
    return new Response('That download link has expired. Reload the page and try again.', {
      status: 403,
    });
  }

  const owned = await findRequestFile(getDb(), portal.request.id, fileId);
  if (!owned) return new Response('Not found', { status: 404 });

  return fileResponse(await openFile(owned.file), owned.file);
}
