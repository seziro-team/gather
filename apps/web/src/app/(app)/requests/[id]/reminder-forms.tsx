'use client';

import { useState, useTransition } from 'react';
import { defaultCadence, type Cadence } from '@gather/core';
import { Alert, Badge, Button } from '@/components/ui';
import type { ReminderLogView, ScheduleView } from '@/lib/reminders';
import { completeRequestAction, saveScheduleAction, sendReminderNowAction } from '../actions';

/**
 * The reminder schedule, as a firm sets it up.
 *
 * The whole design goal is that somebody can tell what this will do to their client before
 * it does it. So the form is small, the sentence under it is generated from the same
 * `describeCadence` the audit log records, and the next send time is shown as a real date
 * rather than left to be discovered three days later.
 */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Zones a small firm's clients are actually in, plus whatever is already configured. */
const COMMON_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
];

const inputClass =
  'rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-300 ' +
  'ring-inset focus:ring-2 focus:ring-brand-600';

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  delivered: 'green',
  sent: 'green',
  queued: 'neutral',
  delayed: 'amber',
  deferred: 'amber',
  bounced: 'red',
  complained: 'red',
  failed: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  delayed: 'Delayed by the receiving server',
  deferred: 'Will retry',
  bounced: 'Bounced — the address rejected it',
  complained: 'Marked as spam by the recipient',
  failed: 'Failed',
};

export function ReminderSchedule({
  requestId,
  schedule,
  mailConfigured,
  firmTimezone,
  outstanding,
  requiredMissing,
  canComplete,
  log,
}: {
  requestId: string;
  schedule: ScheduleView | null;
  mailConfigured: boolean;
  firmTimezone: string;
  outstanding: string[];
  requiredMissing: number;
  canComplete: boolean;
  log: ReminderLogView[];
}) {
  const [cadence, setCadence] = useState<Cadence>(
    () => schedule?.cadence ?? defaultCadence(firmTimezone),
  );
  const [active, setActive] = useState(schedule?.active ?? false);
  const [nextRunAt, setNextRunAt] = useState(schedule?.nextRunAt ?? null);
  const [description, setDescription] = useState(schedule?.description ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(patch: Partial<Cadence>) {
    setCadence((current) => ({ ...current, ...patch }) as Cadence);
  }

  function save(nextActive: boolean) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveScheduleAction(requestId, cadence, nextActive);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setActive(nextActive);
      setNextRunAt(result.nextRunAt);
      setDescription(result.description);
      setNotice(
        nextActive
          ? result.nextRunAt
            ? `Saved. The next reminder goes out ${formatWhen(result.nextRunAt)}.`
            : 'Saved, but this schedule has nothing left to send.'
          : 'Reminders paused. Nothing further will be sent until you turn them back on.',
      );
    });
  }

  function sendNow() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sendReminderNowAction(requestId);
      if (result.ok) setNotice('Reminder sent. It appears in the log below.');
      else setError(result.error);
    });
  }

  function complete() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await completeRequestAction(requestId);
      if (result.ok) {
        setActive(false);
        setNextRunAt(null);
        setNotice('Marked complete. Reminders have stopped.');
      } else {
        setError(result.error);
      }
    });
  }

  const zones = [...new Set([cadence.timezone, ...COMMON_ZONES])];

  return (
    <div className="space-y-4">
      {!mailConfigured ? (
        <Alert tone="warning" title="No email is configured">
          Gather cannot send anything until <code>MAIL_DRIVER</code> is set to <code>resend</code>{' '}
          or <code>smtp</code> in your <code>.env</code>. Run <code>pnpm check:email</code> after
          you set it — it checks your SPF, DKIM and DMARC records and sends a real test message.
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={active ? 'green' : 'neutral'} data-testid="reminder-state">
          {active ? 'Reminders on' : 'Reminders off'}
        </Badge>
        {schedule ? (
          <span className="text-sm text-slate-600">
            {schedule.sentCount} sent
            {nextRunAt ? ` · next ${formatWhen(nextRunAt)}` : ''}
          </span>
        ) : null}
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={isPending}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">How often</span>
          <select
            className={inputClass}
            aria-label="How often"
            value={cadence.kind}
            onChange={(event) => {
              const kind = event.target.value as Cadence['kind'];
              // Each shape needs its own field present, so switching supplies a sane one
              // rather than producing a cadence the schema will refuse.
              update({
                kind,
                everyDays: kind === 'interval' ? (cadence.everyDays ?? 3) : undefined,
                steps: kind === 'escalating' ? (cadence.steps ?? [3, 7, 14, 21]) : undefined,
                weekdays: kind === 'weekdays' ? (cadence.weekdays ?? [1]) : undefined,
              });
            }}
          >
            <option value="interval">Every few days</option>
            <option value="escalating">Escalating, then stop</option>
            <option value="weekdays">On chosen weekdays</option>
          </select>
        </label>

        {cadence.kind === 'interval' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Days between reminders</span>
            <input
              type="number"
              min={1}
              max={365}
              className={inputClass}
              aria-label="Days between reminders"
              value={cadence.everyDays ?? 3}
              onChange={(event) => update({ everyDays: Number(event.target.value) || 1 })}
            />
          </label>
        ) : null}

        {cadence.kind === 'escalating' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Days after sending</span>
            <input
              type="text"
              inputMode="numeric"
              className={inputClass}
              aria-label="Days after sending"
              value={(cadence.steps ?? []).join(', ')}
              onChange={(event) =>
                update({
                  steps: event.target.value
                    .split(/[,\s]+/)
                    .map((part) => Number(part.trim()))
                    .filter((day) => Number.isFinite(day) && day >= 0),
                })
              }
            />
            <span className="text-xs text-slate-500">
              e.g. 3, 7, 14, 21 — four reminders, then it stops on its own.
            </span>
          </label>
        ) : null}

        {cadence.kind === 'weekdays' ? (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="font-medium text-slate-700">Which days</legend>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_NAMES.map((name, day) => {
                const chosen = (cadence.weekdays ?? []).includes(day);
                return (
                  <label
                    key={name}
                    className={`cursor-pointer rounded-md px-2.5 py-2 text-sm ring-1 ring-inset ${
                      chosen
                        ? 'bg-brand-50 text-brand-900 ring-brand-500'
                        : 'bg-white text-slate-700 ring-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={chosen}
                      onChange={(event) => {
                        const days = new Set(cadence.weekdays ?? []);
                        if (event.target.checked) days.add(day);
                        else days.delete(day);
                        update({ weekdays: [...days].sort() });
                      }}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Send at</span>
          <input
            type="time"
            className={inputClass}
            aria-label="Send at"
            value={`${String(cadence.sendAt.hour).padStart(2, '0')}:${String(cadence.sendAt.minute).padStart(2, '0')}`}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(':').map(Number);
              update({ sendAt: { hour: hour ?? 9, minute: minute ?? 0 } });
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Client’s timezone</span>
          <select
            className={inputClass}
            aria-label="Client’s timezone"
            value={cadence.timezone}
            onChange={(event) => update({ timezone: event.target.value })}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            The time above is read on their clock, not yours.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Never send between</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={23}
              className={`${inputClass} w-20`}
              aria-label="Quiet hours start"
              value={cadence.quietHours?.start ?? ''}
              placeholder="21"
              onChange={(event) =>
                update({
                  quietHours: event.target.value
                    ? { start: Number(event.target.value), end: cadence.quietHours?.end ?? 8 }
                    : null,
                })
              }
            />
            <span className="text-sm text-slate-500">and</span>
            <input
              type="number"
              min={0}
              max={23}
              className={`${inputClass} w-20`}
              aria-label="Quiet hours end"
              value={cadence.quietHours?.end ?? ''}
              placeholder="8"
              onChange={(event) =>
                update({
                  quietHours: event.target.value
                    ? { start: cadence.quietHours?.start ?? 21, end: Number(event.target.value) }
                    : null,
                })
              }
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Stop after (optional)</span>
          <input
            type="number"
            min={1}
            max={100}
            className={inputClass}
            aria-label="Stop after"
            placeholder="no limit"
            value={cadence.maxCount ?? ''}
            onChange={(event) =>
              update({ maxCount: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
      </fieldset>

      {description ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" data-testid="cadence-text">
          {description}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => save(true)}
          disabled={isPending}
          data-testid="save-schedule"
        >
          {isPending ? 'Saving…' : active ? 'Save schedule' : 'Turn reminders on'}
        </Button>
        {active ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => save(false)}
            disabled={isPending}
          >
            Pause
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={sendNow}
          disabled={isPending || !mailConfigured || requiredMissing === 0}
          data-testid="send-now"
        >
          Send one now
        </Button>
        {canComplete ? (
          <Button
            type="button"
            variant="secondary"
            onClick={complete}
            disabled={isPending}
            data-testid="mark-complete"
          >
            Mark complete
          </Button>
        ) : null}
      </div>

      {requiredMissing === 0 ? (
        <p className="text-sm text-slate-600">
          Everything required is in, so there is nothing to remind anyone about. Reminders stop on
          their own the moment that happens.
        </p>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-700">
            What the next reminder will list ({outstanding.length})
          </summary>
          <ul className="mt-2 list-disc pl-5 text-slate-600" data-testid="reminder-outstanding">
            {outstanding.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Reminder log</h3>
        {log.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing sent yet.</p>
        ) : (
          <ul
            className="divide-y divide-slate-100 border-t border-slate-100"
            data-testid="reminder-log"
          >
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <Badge tone={STATUS_TONE[entry.status] ?? 'neutral'}>
                  {STATUS_LABEL[entry.status] ?? entry.status}
                </Badge>
                <span className="text-sm text-slate-700">{entry.to}</span>
                <span className="text-sm text-slate-500">{formatWhen(entry.sentAt)}</span>
                {entry.providerMessageId ? (
                  <span
                    className="font-mono text-xs text-slate-300"
                    title={entry.providerMessageId}
                  >
                    {entry.providerMessageId.slice(0, 18)}
                  </span>
                ) : null}
                {entry.error ? (
                  <span className="basis-full text-xs text-red-700">{entry.error}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
