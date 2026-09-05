import { AppShell } from '@/components/app-shell';
import { cloudEnabled, isPlatformAdmin } from '@/lib/cloud';
import { requireMembership } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Account settings require a session and a firm, but deliberately not a second factor —
 * this is where someone goes to set one up.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireMembership();
  return (
    <AppShell
      firmName={membership.firm.name}
      email={user.email}
      cloud={cloudEnabled()}
      platformAdmin={isPlatformAdmin(user.email)}
    >
      {children}
    </AppShell>
  );
}
