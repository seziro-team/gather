'use client';

import { useCallback, useId, useRef, useState, useTransition } from 'react';
import { downloadLinkAction, removeFileAction } from '@/app/portal/[id]/actions';
import { formatBytes } from '@/lib/format';
import type { PortalFileView } from '@/lib/portal-data';

/**
 * The file item, as a client sees it on a phone.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: `fetch` cannot report how much of a
 * request body has gone out, and a person uploading a 30 MB scan over a phone connection
 * needs to see that something is happening. This is the one place in Gather where the older
 * API is the better one.
 *
 * The file input carries no `capture` attribute on purpose. With it, iOS opens the camera
 * and nothing else; without it, the client gets the choice of camera, photo library or
 * files — and most of them already photographed the document last week.
 */

interface InFlight {
  name: string;
  percent: number;
}

async function upload(
  requestId: string,
  itemId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<PortalFileView> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/portal/${requestId}/upload?item=${encodeURIComponent(itemId)}`);
    // Percent-encoded because a header may only carry ASCII, and real filenames do not.
    request.setRequestHeader('x-gather-filename', encodeURIComponent(file.name));
    request.setRequestHeader('content-type', 'application/octet-stream');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });

    request.addEventListener('load', () => {
      let payload: { file?: PortalFileView; error?: string } = {};
      try {
        payload = JSON.parse(request.responseText) as typeof payload;
      } catch {
        payload = {};
      }
      if (request.status === 201 && payload.file) resolve(payload.file);
      else reject(new Error(payload.error ?? `Upload failed (${request.status}).`));
    });

    request.addEventListener('error', () =>
      reject(new Error('The connection dropped. Check your signal and try again.')),
    );
    request.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    request.send(file);
  });
}

export function FileUpload({
  requestId,
  itemId,
  label,
  accept,
  maxFiles,
  files,
  onChange,
  disabled,
}: {
  requestId: string;
  itemId: string;
  label: string;
  accept?: readonly string[];
  maxFiles?: number;
  files: PortalFileView[];
  onChange: (next: PortalFileView[]) => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inFlight, setInFlight] = useState<InFlight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  const remaining = (maxFiles ?? 20) - files.length;
  const full = remaining <= 0;

  const send = useCallback(
    async (chosen: File[]) => {
      setError(null);
      // One at a time: a phone uploading four scans in parallel finishes no sooner and
      // gives the person watching four bars that all crawl.
      let current = files;
      for (const file of chosen.slice(0, Math.max(0, remaining))) {
        setInFlight({ name: file.name, percent: 0 });
        try {
          const stored = await upload(requestId, itemId, file, (percent) =>
            setInFlight({ name: file.name, percent }),
          );
          current = [...current, stored];
          onChange(current);
        } catch (failure) {
          setError((failure as Error).message);
          break;
        }
      }
      setInFlight(null);
    },
    [files, itemId, onChange, remaining, requestId],
  );

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled || full) return;
    void send([...event.dataTransfer.files]);
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])];
    // Reset first, so choosing the same file twice in a row still fires a change.
    event.target.value = '';
    if (chosen.length > 0) void send(chosen);
  }

  function remove(fileId: string) {
    startTransition(async () => {
      const result = await removeFileAction(requestId, fileId);
      if (result.ok) onChange(files.filter((entry) => entry.id !== fileId));
      else setError(result.error);
    });
  }

  function download(fileId: string) {
    startTransition(async () => {
      const result = await downloadLinkAction(requestId, fileId);
      if (result.ok) window.location.href = result.url;
      else setError(result.error);
    });
  }

  const busy = inFlight !== null;

  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="space-y-2" data-testid="uploaded-files">
          {files.map((file) => (
            <li
              key={file.id}
              data-testid="uploaded-file"
              data-file-id={file.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200"
            >
              <span className="min-w-0 flex-1 basis-full text-sm font-medium break-words text-slate-900 sm:basis-auto">
                {file.name}
              </span>
              <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => download(file.id)}
                  disabled={isPending}
                  className="text-brand-700 min-h-11 px-2 text-sm font-medium underline"
                >
                  Download
                </button>
                {disabled ? null : (
                  <button
                    type="button"
                    onClick={() => remove(file.id)}
                    disabled={isPending}
                    aria-label={`Remove ${file.name}`}
                    className="min-h-11 px-2 text-sm font-medium text-red-700 underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? (
        <div
          className="rounded-lg bg-white p-3 ring-1 ring-slate-200"
          data-testid="upload-progress"
        >
          <p className="truncate text-sm text-slate-700">{inFlight.name}</p>
          <div
            role="progressbar"
            aria-valuenow={inFlight.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${inFlight.name}`}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
          >
            <div
              className="bg-brand-600 h-full transition-[width] duration-150"
              style={{ width: `${inFlight.percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">{inFlight.percent}%</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {disabled || full ? (
        full && !disabled ? (
          <p className="text-sm text-slate-500">
            That is the most this item takes. Remove one to add another.
          </p>
        ) : null
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white'
          }`}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple={remaining > 1}
            accept={accept && accept.length > 0 ? accept.join(',') : undefined}
            onChange={onPick}
            disabled={busy}
            className="sr-only"
            aria-label={`Add a file for ${label}`}
          />
          <label
            htmlFor={inputId}
            className="bg-brand-700 hover:bg-brand-800 inline-flex min-h-11 cursor-pointer items-center rounded-md px-4 py-2.5 text-base font-medium text-white"
          >
            {busy ? 'Uploading…' : files.length > 0 ? 'Add another' : 'Choose a file or photo'}
          </label>
          <p className="mt-2 text-sm text-slate-500">
            Take a photo, pick one from your camera roll, or drop a file here.
          </p>
          {accept && accept.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">Accepts {accept.join(', ')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
