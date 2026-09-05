import { describeValue, ITEM_TYPE_LABELS } from '@gather/core';
import { DownloadButton } from '@/app/(app)/requests/[id]/share-forms';
import { formatBytes } from '@/lib/format';
import { Badge } from '@/components/ui';
import type { PortalView } from '@/lib/portal-data';

/**
 * The firm's view of a request: what was asked for, and what has come back.
 *
 * One list rather than two. A checklist beside a separate list of responses means reading
 * a 25-item organizer twice to work out what is missing, which is the exact job the firm is
 * paying attention to.
 */

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting',
  submitted: 'Received',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function RequestChecklist({ requestId, view }: { requestId: string; view: PortalView }) {
  if (view.sections.length === 0) {
    return <p className="text-sm text-slate-600">This request has no sections yet.</p>;
  }

  return (
    <div className="space-y-6">
      {view.sections.map((section, sectionIndex) => (
        <section key={section.id}>
          <h3 className="text-base font-semibold text-slate-900">
            {sectionIndex + 1}. {section.title}
          </h3>
          {section.description ? (
            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
          ) : null}

          {section.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No items in this section.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {section.items.map((entry, itemIndex) => (
                <li key={entry.item.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-slate-400">
                      {sectionIndex + 1}.{itemIndex + 1}
                    </span>
                    <span className="text-sm font-medium break-words text-slate-900">
                      {entry.item.label}
                    </span>
                    <Badge>{ITEM_TYPE_LABELS[entry.item.type]}</Badge>
                    {entry.item.required ? <Badge tone="brand">Required</Badge> : null}
                    <Badge tone={entry.answered ? 'green' : 'neutral'}>
                      {entry.answered ? (STATUS_LABELS[entry.status] ?? 'Received') : 'Waiting'}
                    </Badge>
                  </div>

                  {entry.item.helpText ? (
                    <p className="mt-1 text-sm text-slate-600">{entry.item.helpText}</p>
                  ) : null}

                  {entry.files.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {entry.files.map((file) => (
                        <li
                          key={file.id}
                          data-testid="firm-file"
                          data-file-id={file.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2"
                        >
                          <span className="min-w-0 text-sm break-words text-slate-800">
                            {file.name}
                          </span>
                          <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
                          {file.scanStatus === 'skipped' ? (
                            <span
                              className="text-xs text-slate-500"
                              title="No virus scanner is configured on this install. Turn on the antivirus profile to have uploads scanned."
                            >
                              Not scanned
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">{file.scanStatus}</span>
                          )}
                          <span
                            className="font-mono text-xs text-slate-300"
                            title={`sha256 ${file.sha256}`}
                          >
                            {file.sha256.slice(0, 10)}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
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

                  {entry.item.type !== 'file' && entry.answered ? (
                    <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-slate-800">
                      {describeValue(entry.item, entry.value)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
