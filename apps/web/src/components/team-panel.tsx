'use client';

import { useState, useTransition } from 'react';
import { FIRM_ROLES, ROLE_LABELS, type FirmRole } from '@gather/core';
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from '@/app/(app)/settings/actions';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';

/**
 * The team list, and the controls that change it.
 *
 * Every mutation goes through a server action that re-checks the permission — the `canManage`
 * prop only decides what is drawn. A member who edits the DOM to reveal the remove button
 * gets a refusal from the server, not a removed colleague.
 */

export interface TeamMemberView {
  userId: string;
  name: string;
  email: string;
  role: FirmRole;
  twoFactorEnabled: boolean;
  joinedAt: string;
  isSelf: boolean;
}

export interface TeamView {
  members: TeamMemberView[];
  invites: { id: string; email: string; role: FirmRole; expiresAt: string }[];
  seatsUsed: number;
  seatLimit: number | null;
  canInvite: boolean;
  seatReason: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function TeamPanel({
  team,
  canManage,
  canManageOwners,
}: {
  team: TeamView;
  canManage: boolean;
  canManageOwners: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<{ url: string; emailed: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? 'That did not work.');
    });
  }

  function onInvite(form: FormData) {
    const email = String(form.get('email') ?? '');
    const role = String(form.get('role') ?? 'member');
    setError(null);
    setInviteUrl(null);
    startTransition(async () => {
      const result = await inviteMemberAction(email, role);
      if (result.ok) setInviteUrl({ url: result.url, emailed: result.emailed });
      else setError(result.error);
    });
  }

  /** Owners may only be changed by an owner, so those rows lose their controls for admins. */
  function mayEdit(member: TeamMemberView): boolean {
    if (!canManage) return false;
    if (member.role === 'owner' && !canManageOwners) return false;
    return true;
  }

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {team.members.length} {team.members.length === 1 ? 'person' : 'people'}
        </h2>
        <p className="text-sm text-slate-500">
          {team.seatLimit === null
            ? 'No seat limit on a self-hosted install.'
            : `${team.seatsUsed} of ${team.seatLimit} seats used.`}
        </p>
      </div>

      <ul className="divide-y divide-slate-200 border-y border-slate-200">
        {team.members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {member.name}
                {member.isSelf ? <span className="text-slate-500"> (you)</span> : null}
              </p>
              <p className="truncate text-sm text-slate-500">{member.email}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Joined {formatDate(member.joinedAt)}</span>
                {member.twoFactorEnabled ? null : <Badge tone="amber">Two-factor not set up</Badge>}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {mayEdit(member) ? (
                <Select
                  aria-label={`Role for ${member.email}`}
                  defaultValue={member.role}
                  disabled={pending}
                  className="w-auto py-1.5 text-sm"
                  onChange={(event) =>
                    run(() => changeRoleAction(member.userId, event.target.value))
                  }
                >
                  {FIRM_ROLES.filter((role) => role !== 'owner' || canManageOwners).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>
                  {ROLE_LABELS[member.role]}
                </Badge>
              )}

              {mayEdit(member) && !member.isSelf ? (
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-sm"
                  disabled={pending}
                  onClick={() => run(() => removeMemberAction(member.userId))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {team.invites.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Invitations waiting</h3>
          <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
            {team.invites.map((pendingInvite) => (
              <li
                key={pendingInvite.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm text-slate-900">{pendingInvite.email}</p>
                  <p className="text-xs text-slate-500">
                    {ROLE_LABELS[pendingInvite.role]} · expires{' '}
                    {formatDate(pendingInvite.expiresAt)}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                    disabled={pending}
                    onClick={() => run(() => revokeInviteAction(pendingInvite.id))}
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form action={onInvite} className="space-y-3 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Invite somebody</h3>

          {team.canInvite ? null : (
            <Alert tone="warning">{team.seatReason ?? 'This plan has no seats left.'}</Alert>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <label htmlFor="invite-email" className="text-sm font-medium text-slate-900">
                Their email
              </label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="colleague@firm.com"
                className="mt-1"
                disabled={!team.canInvite || pending}
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="text-sm font-medium text-slate-900">
                Role
              </label>
              <Select
                id="invite-role"
                name="role"
                defaultValue="member"
                className="mt-1 w-auto"
                disabled={!team.canInvite || pending}
              >
                {FIRM_ROLES.filter((role) => role !== 'owner' || canManageOwners).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={!team.canInvite || pending}>
              {pending ? 'Working…' : 'Send invitation'}
            </Button>
          </div>
        </form>
      ) : null}

      {inviteUrl ? (
        <Alert tone="success" title={inviteUrl.emailed ? 'Invitation sent' : 'Invitation created'}>
          <p>
            {inviteUrl.emailed
              ? 'They have been emailed this link. It also works if you send it yourself:'
              : 'No email is configured, so send them this link yourself:'}
          </p>
          <code
            data-testid="invite-url"
            className="mt-2 block overflow-x-auto rounded bg-white/70 p-2 font-mono text-xs break-all"
          >
            {inviteUrl.url}
          </code>
        </Alert>
      ) : null}
    </div>
  );
}
