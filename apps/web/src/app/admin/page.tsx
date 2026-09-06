import { PLAN_DEFINITIONS, parsePage } from '@gather/core';
import { Pager } from '@/components/pager';
import { Badge, Card } from '@/components/ui';
import { readAdminOverview } from '@/lib/admin';
import { applicablePlan } from '@/lib/cloud';
import { formatBytes } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Platform admin · Gather' };

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  active: 'green',
  trialing: 'green',
  past_due: 'amber',
  canceled: 'red',
  unpaid: 'red',
  none: 'neutral',
};

function ago(date: Date | null): string {
  if (!date) return 'never';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return date.toISOString().slice(0, 10);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page, 50);
  const { firms, totals } = await readAdminOverview(page);

  const stats = [
    { label: 'Firms', value: totals.firms.toLocaleString() },
    { label: 'People', value: totals.users.toLocaleString() },
    { label: 'Requests', value: totals.requests.toLocaleString() },
    { label: 'Files stored', value: totals.files.toLocaleString() },
    { label: 'Storage', value: formatBytes(totals.storageBytes) },
    { label: 'Paying', value: totals.paying.toLocaleString() },
    { label: 'Payment failed', value: totals.pastDue.toLocaleString() },
    { label: 'Bounces (7d)', value: totals.bouncesLast7Days.toLocaleString() },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Platform admin</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every firm on this install. Read-only — changing a firm’s documents needs somebody in that
          firm, and every visit to this page is written to the audit log.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {stat.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Firm
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Plan
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                People
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Clients
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Requests
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Storage
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Last used
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {firms.rows.map((firm) => (
              <tr key={firm.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{firm.name}</p>
                  <p className="font-mono text-xs text-slate-400">{firm.id}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-slate-700">
                      {PLAN_DEFINITIONS[applicablePlan(firm.effectivePlan)].name}
                    </span>
                    {firm.status === 'none' ? null : (
                      <Badge tone={STATUS_TONE[firm.status] ?? 'neutral'}>{firm.status}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">{firm.members}</td>
                <td className="px-4 py-3 text-slate-700">{firm.clients}</td>
                <td className="px-4 py-3 text-slate-700">
                  {firm.requests}
                  {firm.openRequests > 0 ? (
                    <span className="text-slate-500"> ({firm.openRequests} open)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {formatBytes(firm.storageBytes)}
                  <span className="text-slate-500"> · {firm.files} files</span>
                </td>
                <td className="px-4 py-3 text-slate-700">{ago(firm.lastActivityAt)}</td>
              </tr>
            ))}
            {firms.total === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No firms yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="px-4 pb-4">
          <Pager page={firms} basePath="/admin" unit="firm" />
        </div>
      </Card>
    </div>
  );
}
