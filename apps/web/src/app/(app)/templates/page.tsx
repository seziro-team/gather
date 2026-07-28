import Link from 'next/link';
import { Alert, Badge, Card, PageHeader } from '@/components/ui';
import { requireReadyUser } from '@/lib/session';
import { listTemplates } from '@/lib/templates';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Templates · Gather' };

export default async function TemplatesPage() {
  const { membership } = await requireReadyUser();
  const templates = await listTemplates(membership.firm.id);
  const builtin = templates.filter((entry) => entry.isBuiltin);
  const own = templates.filter((entry) => !entry.isBuiltin);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description="Start a request from one of these instead of building it again every year."
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Included with Gather</h2>
        <Alert tone="info">
          Every item in these four is transcribed from published IRS, CFPB, SBA or Fannie Mae
          guidance, and links to the document it came from. Nothing here was invented — open one and
          check.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          {builtin.map((entry) => (
            <Card key={entry.id}>
              <Link
                href={`/templates/${entry.id}`}
                className="font-medium text-slate-900 hover:underline"
              >
                {entry.name}
              </Link>
              {entry.description ? (
                <p className="mt-1 text-sm text-slate-600">{entry.description}</p>
              ) : null}
              <p className="mt-3 text-xs text-slate-500">
                {entry.sections} sections · {entry.items} items
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Your templates</h2>
        {own.length === 0 ? (
          <p className="text-sm text-slate-600">
            None yet. Build a request the way you like it, then use{' '}
            <span className="font-medium">Save as template</span> on the request page.
          </p>
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {own.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/templates/${entry.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {entry.name}
                    </Link>
                    {entry.description ? (
                      <p className="truncate text-sm text-slate-500">{entry.description}</p>
                    ) : null}
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <Badge>
                      {entry.sections} sections · {entry.items} items
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
