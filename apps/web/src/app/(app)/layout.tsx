import { AppShell } from '@/components/app-shell';
import { requireReadyUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Everything under here shows firm data, so the full gate applies: session, firm, MFA. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, membership } = await requireReadyUser();
  return (
    <AppShell firmName={membership.firm.name} email={user.email}>
      {children}
    </AppShell>
  );
}
