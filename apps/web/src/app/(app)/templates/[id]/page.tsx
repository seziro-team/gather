import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countItems } from '@gather/core';
import { StructureOutline } from '@/components/structure';
import { Alert, Badge, Button, Card, linkButton, PageHeader } from '@/components/ui';
import { requireReadyUser } from '@/lib/session';
import { getTemplate } from '@/lib/templates';
import { deleteTemplateAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Template · Gather' };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { membership } = await requireReadyUser();
  const { id } = await params;
  const found = await getTemplate(membership.firm.id, id);
  if (!found) notFound();

  const { row, body } = found;
  const cited = body.sections.flatMap((section) =>
    section.items.filter((item) => item.sources.length > 0),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.name}
        description={row.description}
        actions={
          <Link href={`/requests/new?templateId=${row.id}`} className={linkButton()}>
            Use this template
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {row.isBuiltin ? <Badge tone="brand">Included with Gather</Badge> : <Badge>Yours</Badge>}
        <Badge>
          {body.sections.length} sections · {countItems(body)} items
        </Badge>
        <code className="text-xs text-slate-500">{row.key}</code>
      </div>

      {row.isBuiltin ? (
        <Alert tone="info" title="Every item below cites its source">
          {cited} of {countItems(body)} items link to the published guidance they came from. The
          full list, with quotes, is in <code>templates/SOURCES.md</code> in the repository. These
          are collection checklists, not tax or lending advice — check the source before you rely on
          an item, and edit your copy freely.
        </Alert>
      ) : null}

      <Card>
        <StructureOutline body={body} showSources={row.isBuiltin} />
      </Card>

      {row.isBuiltin ? null : (
        <Card>
          <h2 className="text-base font-semibold text-slate-900">Delete this template</h2>
          <p className="mt-1 mb-4 text-sm text-slate-600">
            Requests already built from it are unaffected — they were copied, not linked.
          </p>
          <form action={deleteTemplateAction}>
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" variant="danger">
              Delete template
            </Button>
          </form>
        </Card>
      )}

      <p className="text-sm">
        <Link href="/templates" className="text-brand-700 underline">
          Back to templates
        </Link>
      </p>
    </div>
  );
}
