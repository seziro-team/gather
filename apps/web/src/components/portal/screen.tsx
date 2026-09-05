'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PortalView } from '@/lib/portal-data';
import { PortalChecklist } from './checklist';

/**
 * Holds the one piece of state that changes the whole page: whether the client has told
 * the firm they are finished. Everything else lives in the checklist.
 */
export function PortalScreen({
  requestId,
  view,
  status,
}: {
  requestId: string;
  view: PortalView;
  status: string;
}) {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(status === 'submitted');
  const closed = status === 'complete' || status === 'archived';

  return (
    <>
      {submitted ? (
        <div
          role="status"
          data-testid="portal-submitted"
          className="mb-6 rounded-xl bg-emerald-50 p-4 text-emerald-900 ring-1 ring-emerald-200"
        >
          <p className="font-semibold">Sent — thank you.</p>
          <p className="mt-1 text-sm">
            Your accountant has everything on this list. You can still change an answer or add a
            file from this link if you need to; they will see the update.
          </p>
        </div>
      ) : null}

      {closed ? (
        <div className="mb-6 rounded-xl bg-slate-100 p-4 text-slate-700 ring-1 ring-slate-200">
          <p className="font-semibold">This request is closed.</p>
          <p className="mt-1 text-sm">
            Everything below is what you sent. Get in touch with your accountant if something needs
            to change.
          </p>
        </div>
      ) : null}

      <PortalChecklist
        requestId={requestId}
        view={view}
        readOnly={closed}
        onSubmitted={() => {
          setSubmitted(true);
          // The server decides the request's real status; this pulls it back down rather
          // than trusting the optimistic flag beyond the banner.
          router.refresh();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </>
  );
}
