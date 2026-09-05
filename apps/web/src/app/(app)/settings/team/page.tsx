import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@gather/core';
import { TeamPanel } from '@/components/team-panel';
import { Alert, Card, PageHeader } from '@/components/ui';
import { actorCan } from '@/lib/cloud';
import { requireReadyUser } from '@/lib/session';
import { readTeam } from '@/lib/team';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team · Gather' };

export default async function TeamPage() {
  const { user, membership } = await requireReadyUser();
  const team = await readTeam(membership.firm.id);
  const canManage = actorCan(membership, 'team:manage');
  const canManageOwners = actorCan(membership, 'team:manage-owners');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={`Who can see ${membership.firm.name}'s clients and their documents.`}
      />

      {canManage ? null : (
        <Alert tone="info" title="You can see the team but not change it">
          Only an owner or an admin can invite people or change what they can do.
        </Alert>
      )}

      {team.mailConfigured || !canManage ? null : (
        <Alert tone="warning" title="No email is configured">
          Invitations still work — Gather shows you the link to send yourself. Set{' '}
          <code>MAIL_DRIVER</code> in your <code>.env</code> to have them emailed.
        </Alert>
      )}

      <Card>
        <TeamPanel
          team={{
            members: team.members.map((member) => ({
              userId: member.userId,
              name: member.name,
              email: member.email,
              role: member.role,
              twoFactorEnabled: member.twoFactorEnabled,
              joinedAt: member.joinedAt.toISOString(),
              isSelf: member.userId === user.id,
            })),
            invites: team.invites,
            seatsUsed: team.seatsUsed,
            seatLimit: team.seatLimit,
            canInvite: team.canInvite,
            seatReason: team.seatReason ?? null,
          }}
          canManage={canManage}
          canManageOwners={canManageOwners}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">What each role can do</h2>
        <dl className="space-y-3">
          {(['owner', 'admin', 'member'] as const).map((role) => (
            <div key={role}>
              <dt className="text-sm font-medium text-slate-900">{ROLE_LABELS[role]}</dt>
              <dd className="text-sm text-slate-600">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
