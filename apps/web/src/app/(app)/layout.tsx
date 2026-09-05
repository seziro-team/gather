import { AppShell } from '@/components/app-shell';
import { cloudEnabled, isPlatformAdmin } from '@/lib/cloud';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Everything under here shows firm data, so the full gate applies: session, firm, MFA. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireReadyUser();
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
