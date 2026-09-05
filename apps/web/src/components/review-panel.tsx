'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { approveItemAction, rejectItemAction } from '@/app/(app)/requests/actions';
import { Alert, Badge, Button } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { DownloadButton } from '@/app/(app)/requests/[id]/share-forms';

/**
 * The firm going through a request, item by item.
 *
 * Built for the person doing it forty times in January, so the whole thing works from the
 * keyboard: `j`/`k` or the arrow keys move, `a` approves, `r` opens the note box, `Enter`
 * sends it back, `Escape` cancels. A firm that has to reach for the mouse on every item
 * will stop reviewing properly, and per-item approval is the mechanic the product turns on.
 */

export interface ReviewFileView {
  id: string;
  name: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  scanStatus: string;
  current: boolean;
  version: number;
}

export interface ReviewItemView {
  id: string;
  label: string;
  helpText: string | null;
  type: string;
  required: boolean;
  sectionTitle: string;
  status: string;
  rejectNote: string | null;
  version: number;
  answer: string | null;
  files: ReviewFileView[];
}

export interface ReviewSectionView {
  id: string;
  title: string;
  items: ReviewItemView[];
}

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  approved: { label: 'Approved', tone: 'green' },
  submitted: { label: 'Waiting on you', tone: 'amber' },
  rejected: { label: 'Sent back', tone: 'red' },
  pending: { label: 'Not sent yet', tone: 'neutral' },
};

export function ReviewPanel({
  requestId,
  sections,
  closed,
}: {
  requestId: string;
  sections: ReviewSectionView[];
  closed: boolean;
}) {
  const flat = sections.flatMap((section) => section.items);

  const [focused, setFocused] = useState(0);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = useRef(new Map<string, HTMLDivElement>());
  const noteBox = useRef<HTMLTextAreaElement>(null);

  const focus = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(flat.length - 1, index));
      setFocused(clamped);
      const id = flat[clamped]?.id;
      if (id) rows.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [flat],
  );

  const doApprove = useCallback(
    (itemId: string) => {
      setError(null);
      setNotice(null);
      startTransition(async () => {
        const result = await approveItemAction(requestId, itemId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(
          result.completed
            ? 'Approved — that was the last required item, so the request is complete and reminders have stopped.'
            : `Approved. ${result.requiredRemaining} required item${result.requiredRemaining === 1 ? '' : 's'} to go.`,
        );
      });
    },
    [requestId],
  );

  const doReject = useCallback(
    (itemId: string) => {
      setError(null);
      setNotice(null);
      startTransition(async () => {
        const result = await rejectItemAction(requestId, itemId, note);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRejecting(null);
        setNote('');
        setNotice('Sent back. The client has been emailed and that item is outstanding again.');
      });
    },
    [note, requestId],
  );

  // Keyboard flow. Deliberately inert while a note is being typed — `a` is a letter before
  // it is a shortcut — and while an input anywhere else has focus.
  useEffect(() => {
    if (closed) return;

    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (typing) {
        if (event.key === 'Escape' && rejecting) {
          setRejecting(null);
          setNote('');
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && rejecting) {
          event.preventDefault();
          doReject(rejecting);
        }
        return;
      }

      const current = flat[focused];
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          focus(focused + 1);
          break;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          focus(focused - 1);
          break;
        case 'a':
          if (current) {
            event.preventDefault();
            doApprove(current.id);
          }
          break;
        case 'r':
          if (current) {
            event.preventDefault();
            setRejecting(current.id);
            setNote('');
            // The box does not exist until the state lands.
            requestAnimationFrame(() => noteBox.current?.focus());
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closed, doApprove, doReject, flat, focus, focused, rejecting]);

  // The flat position of each item, so `j`/`k` can walk the whole request across sections.
  // Computed once rather than by incrementing a counter during render, which React's
  // compiler rightly refuses.
  const positions = new Map(flat.map((entry, position) => [entry.id, position]));

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {closed ? null : (
        <p className="text-xs text-slate-500">
          <kbd className="rounded bg-slate-100 px-1">j</kbd>/
          <kbd className="rounded bg-slate-100 px-1">k</kbd> move ·{' '}
          <kbd className="rounded bg-slate-100 px-1">a</kbd> approve ·{' '}
          <kbd className="rounded bg-slate-100 px-1">r</kbd> send back ·{' '}
          <kbd className="rounded bg-slate-100 px-1">⌘↵</kbd> confirm ·{' '}
          <kbd className="rounded bg-slate-100 px-1">esc</kbd> cancel
        </p>
      )}

      {sections.map((section) => (
        <section key={section.id} data-testid="review-section">
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {section.title}
          </h3>

          <ul className="space-y-2">
            {section.items.map((entry) => {
              const index = positions.get(entry.id) ?? 0;
              const isFocused = index === focused && !closed;
              const state = STATUS[entry.status] ?? STATUS.pending!;

              return (
                <li key={entry.id}>
                  <div
                    ref={(node) => {
                      if (node) rows.current.set(entry.id, node);
                    }}
                    data-testid="review-item"
                    data-item-id={entry.id}
                    data-status={entry.status}
                    onClick={() => focus(index)}
                    className={`rounded-lg p-3 ring-1 transition-shadow ${
                      isFocused ? 'ring-brand-500 bg-brand-50/40 ring-2' : 'bg-white ring-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words text-slate-900">
                          {entry.label}
                          {entry.required ? (
                            <span className="ml-1 text-red-600" aria-label="required">
                              *
                            </span>
                          ) : null}
                        </p>
                        {entry.answer ? (
                          <p className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-700">
                            {entry.answer}
                          </p>
                        ) : null}
                        {entry.files.length === 0 && !entry.answer ? (
                          <p className="mt-1 text-sm text-slate-400">Nothing sent yet.</p>
                        ) : null}
                      </div>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>

                    {entry.rejectNote ? (
                      <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                        <span className="font-semibold">You sent this back: </span>
                        {entry.rejectNote}
                      </p>
                    ) : null}

                    {entry.files.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {entry.files.map((file) => (
                          <li
                            key={file.id}
                            data-testid="review-file"
                            data-current={file.current ? 'yes' : 'no'}
                            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 ${
                              file.current ? 'bg-slate-50' : 'bg-slate-50/60 text-slate-400'
                            }`}
                          >
                            <span className="min-w-0 text-sm break-words">{file.name}</span>
                            <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
                            {file.current ? null : <Badge>Replaced (v{file.version})</Badge>}
                            {file.scanStatus === 'skipped' ? (
                              <span
                                className="text-xs text-slate-500"
                                title="No virus scanner is configured on this install."
                              >
                                Not scanned
                              </span>
                            ) : null}
                            <span
                              className="font-mono text-xs text-slate-300"
                              title={`sha256 ${file.sha256}`}
                            >
                              {file.sha256.slice(0, 10)}
                            </span>
                            <span className="ml-auto">
                              <DownloadButton
                                requestId={requestId}
                                fileId={file.id}
                                name={file.name}
                              />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {closed ? null : rejecting === entry.id ? (
                      <div className="mt-3">
                        <label
                          className="text-sm font-medium text-slate-700"
                          htmlFor={`note-${entry.id}`}
                        >
                          What needs fixing? The client sees this and nothing else.
                        </label>
                        <textarea
                          id={`note-${entry.id}`}
                          ref={noteBox}
                          rows={2}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="This is the 2023 copy — we need 2024."
                          className="focus:ring-brand-600 mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-300 ring-inset focus:ring-2"
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            onClick={() => doReject(entry.id)}
                            disabled={isPending || note.trim().length === 0}
                            data-testid="confirm-reject"
                          >
                            Send it back
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setRejecting(null);
                              setNote('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          onClick={() => doApprove(entry.id)}
                          disabled={isPending || entry.status === 'approved'}
                          data-testid="approve"
                        >
                          {entry.status === 'approved' ? 'Approved' : 'Approve'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setRejecting(entry.id);
                            setNote('');
                            requestAnimationFrame(() => noteBox.current?.focus());
                          }}
                          disabled={isPending}
                          data-testid="reject"
                        >
                          Send back
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
