'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ResponseValueError } from '@gather/core';
import { downloadQuery, portalScope, removeStoredObject, signFileDownload } from '@/lib/files';
import { currentPortal, portalPath } from '@/lib/portal';
import {
  PortalItemNotFound,
  removePortalFile,
  savePortalAnswer,
  submitPortal,
} from '@/lib/portal-data';
import type { DownloadLinkResult, PortalActionResult, SaveAnswerResult } from './results';

/**
 * Everything the client's page can ask the server to do.
 *
 * All four start by resolving the portal session for the request id in the URL. The
 * session is what authorises the change; the id is only how the session is looked up. A
 * caller who invents a request id finds no session for it.
 */

const uuid = z.uuid();

const CLOSED = 'This request has been completed, so it can no longer be changed.';

function isClosed(status: string): boolean {
  return status === 'complete' || status === 'archived';
}

export async function saveAnswerAction(
  requestId: string,
  itemId: string,
  value: unknown,
): Promise<SaveAnswerResult> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(itemId).success) {
    return { ok: false, error: 'That item could not be identified.' };
  }

  const portal = await currentPortal(requestId);
  if (!portal) {
    return { ok: false, error: 'Your link has expired. Open the latest email and try again.' };
  }
  if (isClosed(portal.request.status)) return { ok: false, error: CLOSED };

  try {
    const saved = await savePortalAnswer(portal, itemId, value);
    return { ok: true, value: saved.value };
  } catch (error) {
    if (error instanceof ResponseValueError || error instanceof PortalItemNotFound) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function removeFileAction(
  requestId: string,
  fileId: string,
): Promise<PortalActionResult> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(fileId).success) {
    return { ok: false, error: 'That file could not be identified.' };
  }

  const portal = await currentPortal(requestId);
  if (!portal) {
    return { ok: false, error: 'Your link has expired. Open the latest email and try again.' };
  }
  if (isClosed(portal.request.status)) return { ok: false, error: CLOSED };

  const removed = await removePortalFile(portal, fileId);
  if (!removed) return { ok: false, error: 'That file is not part of this request.' };

  // The row is gone and audited either way; a bucket that refuses the delete should not
  // leave the client staring at a file the database no longer has.
  await removeStoredObject(removed.storageDriver, removed.storageKey).catch(() => undefined);

  revalidatePath(portalPath(requestId));
  return { ok: true };
}

export async function submitPortalAction(requestId: string): Promise<PortalActionResult> {
  if (!uuid.safeParse(requestId).success) {
    return { ok: false, error: 'That request could not be identified.' };
  }

  const portal = await currentPortal(requestId);
  if (!portal) {
    return { ok: false, error: 'Your link has expired. Open the latest email and try again.' };
  }
  if (isClosed(portal.request.status)) return { ok: false, error: CLOSED };

  try {
    await submitPortal(portal);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath(portalPath(requestId));
  return { ok: true };
}

/**
 * Mint a download link at the moment it is clicked.
 *
 * Links last five minutes (plan.md §6). Rendering one into the page would mean it had
 * already been alive for however long the client left the tab open, so the signature is
 * made when they ask for the file rather than when the page is built.
 */
export async function downloadLinkAction(
  requestId: string,
  fileId: string,
): Promise<DownloadLinkResult> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(fileId).success) {
    return { ok: false, error: 'That file could not be identified.' };
  }

  const portal = await currentPortal(requestId);
  if (!portal) {
    return { ok: false, error: 'Your link has expired. Open the latest email and try again.' };
  }

  const signed = signFileDownload(fileId, portalScope(portal.request.id));
  return {
    ok: true,
    url: `${portalPath(portal.request.id)}/file/${fileId}?${downloadQuery(signed)}`,
  };
}
