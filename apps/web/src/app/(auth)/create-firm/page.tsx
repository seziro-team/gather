import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Alert, Card, Field, Input } from '@/components/ui';
import { getMembership } from '@/lib/firm';
import { requireUser } from '@/lib/session';
import { createFirmAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Name your firm · Gather' };

/**
 * Recovery path: an account exists but has no firm. That happens if firm creation failed
 * partway through sign-up, and later when someone is invited to an install. Without this
 * page such an account would be permanently stuck at the dashboard guard.
 */
export default async function CreateFirmPage() {
  const user = await requireUser();
  if (await getMembership(user.id)) redirect('/dashboard');

  return (
    <Card>
      <h1 className="text-xl font-semibold text-slate-900">Name your firm</h1>
      <div className="mt-4 mb-6">
        <Alert tone="info">
          Your account exists but isn’t attached to a firm yet. Give it a name and you’re in.
        </Alert>
      </div>

      <ActionForm action={createFirmAction} submitLabel="Create firm" pendingLabel="Creating…">
        <Field label="Firm name" hint="Clients see this on every request you send.">
          <Input name="firmName" autoComplete="organization" required autoFocus />
        </Field>
      </ActionForm>
    </Card>
  );
}
