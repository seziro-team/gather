import { z } from 'zod';
import { addZonedDays, atZonedTime, isValidTimezone, zonedParts } from './timezone.js';

/**
 * When a reminder goes out, and when it stops.
 *
 * Everything here is a pure function of the schedule and the clock. The worker asks
 * "what next?", writes the answer to `reminder_schedule.next_run_at`, and does no date
 * arithmetic of its own — so the behaviour that decides whether a client gets nagged at
 * 3 a.m. is testable without a database, a queue or an SMTP server.
 *
 * Three shapes, because they are the three things firms actually asked for in the threads
 * in plan.md §2.4, and no more:
 *
 *  - **interval** — every N days until it is done. The default, and what most people mean.
 *  - **escalating** — a fixed ladder measured from the day the request was sent, e.g.
 *    3, 7, 14, 21 days. Gets louder as a deadline approaches and then stops on its own.
 *  - **weekdays** — on chosen days of the week. For a firm whose clients are a business
 *    that only opens post on a Monday.
 */

const HOUR = z.number().int().min(0).max(23);

export const timeOfDaySchema = z.object({
  hour: HOUR,
  minute: z.number().int().min(0).max(59),
});

/**
 * A window during which nothing is sent, in the client's local time.
 *
 * `start` is inclusive and `end` exclusive, and the window may wrap midnight — 21 to 8 is
 * "the evening and the night", which is the only way anybody ever configures this.
 */
export const quietHoursSchema = z.object({ start: HOUR, end: HOUR });

export const cadenceSchema = z
  .object({
    kind: z.enum(['interval', 'escalating', 'weekdays']),

    /** `interval`: days between one reminder and the next. */
    everyDays: z.number().int().min(1).max(365).optional(),

    /**
     * `escalating`: days after the request was sent, ascending. The schedule ends when the
     * ladder runs out, which is the point of it — an escalating cadence that looped forever
     * would just be a slow interval.
     */
    steps: z.array(z.number().int().min(0).max(365)).min(1).max(12).optional(),

    /** `weekdays`: 0 = Sunday … 6 = Saturday. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),

    sendAt: timeOfDaySchema,

    /**
     * The client's timezone, not the firm's. A London firm chasing a client in Sydney is
     * the case this exists for.
     */
    timezone: z.string().refine(isValidTimezone, { message: 'is not a known IANA timezone' }),

    quietHours: quietHoursSchema.nullish(),

    /** Stop after this many reminders regardless of cadence. `null` means keep going. */
    maxCount: z.number().int().min(1).max(100).nullish(),
  })
  .superRefine((value, ctx) => {
    const required = {
      interval: 'everyDays',
      escalating: 'steps',
      weekdays: 'weekdays',
    } as const;

    const key = required[value.kind];
    if (value[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `is required for a ${value.kind} cadence`,
      });
    }

    if (value.kind === 'escalating' && value.steps) {
      const ascending = value.steps.every((day, i) => i === 0 || day > value.steps![i - 1]!);
      if (!ascending) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps'],
          message: 'must be in ascending order — each step is days since the request was sent',
        });
      }
    }

    if (value.kind === 'weekdays' && value.weekdays) {
      if (new Set(value.weekdays).size !== value.weekdays.length) {
        ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'lists the same day twice' });
      }
    }

    if (value.quietHours && value.quietHours.start === value.quietHours.end) {
      ctx.addIssue({
        code: 'custom',
        path: ['quietHours'],
        message:
          'starts and ends at the same hour, which would silence every reminder forever. ' +
          'Leave it unset instead.',
      });
    }
  });

export type Cadence = z.infer<typeof cadenceSchema>;
export type TimeOfDay = z.infer<typeof timeOfDaySchema>;
export type QuietHours = z.infer<typeof quietHoursSchema>;

export interface ScheduleState {
  /** When the request was sent — the origin an escalating ladder is measured from. */
  startedAt: Date;
  /** The last reminder actually sent, or `null` if none has been. */
  lastSentAt: Date | null;
  sentCount: number;
}

export function parseCadence(input: unknown): Cadence {
  return cadenceSchema.parse(input);
}

/** Is `at` inside the quiet window, judged by the clock where the client lives? */
export function inQuietHours(at: Date, cadence: Cadence): boolean {
  const quiet = cadence.quietHours;
  if (!quiet) return false;

  const { hour } = zonedParts(at, cadence.timezone);
  // A window that wraps midnight (21→8) is two ranges; one that does not (1→5) is one.
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

/** Push an instant out of the quiet window, to the moment it ends. */
function afterQuietHours(at: Date, cadence: Cadence): Date {
  if (!inQuietHours(at, cadence)) return at;
  const quiet = cadence.quietHours!;

  const parts = zonedParts(at, cadence.timezone);
  // A wrapping window that we are in during the small hours ends today; one we are in
  // during the evening ends tomorrow morning.
  const endsTomorrow = quiet.start >= quiet.end && parts.hour >= quiet.start;
  const day = endsTomorrow ? addZonedDays(at, cadence.timezone, 1) : at;

  return atZonedTime(day, cadence.timezone, { hour: quiet.end, minute: 0 });
}

/**
 * When the next reminder should go out, or `null` if there should not be another one.
 *
 * `now` is a parameter rather than a call to the clock so that the behaviour is a pure
 * function — the tests move time around instead of waiting for it.
 */
export function nextRunAt(cadence: Cadence, state: ScheduleState, now: Date): Date | null {
  if (cadence.maxCount != null && state.sentCount >= cadence.maxCount) return null;

  const zone = cadence.timezone;
  const target = firstCandidate(cadence, state);
  if (target === null) return null;

  // Already in the future: that is the answer, once quiet hours have had their say.
  if (target > now) return afterQuietHours(target, cadence);

  // Overdue — the worker was down, or the schedule was paused and resumed. Send it at the
  // next opportunity rather than at the time it should have gone out, and *do not* fire
  // one per missed slot: `sentCount` only moves when something is actually sent, so the
  // one that follows is computed from this send and the backlog collapses to a single
  // reminder. That is the behaviour a client wants after a Gather outage.
  if (cadence.kind !== 'weekdays') return afterQuietHours(now, cadence);

  // For a weekday cadence, "the next opportunity" has to be a day the firm chose.
  const days = cadence.weekdays!;
  let day = atZonedTime(now, zone, cadence.sendAt);
  for (let guard = 0; guard <= 8; guard += 1) {
    if (day > now && days.includes(zonedParts(day, zone).weekday)) {
      return afterQuietHours(day, cadence);
    }
    day = addZonedDays(day, zone, 1);
  }
  return null;
}

/** The instant this cadence points at, before overdue handling and quiet hours. */
function firstCandidate(cadence: Cadence, state: ScheduleState): Date | null {
  const zone = cadence.timezone;
  const time = cadence.sendAt;

  if (cadence.kind === 'escalating') {
    const step = cadence.steps![state.sentCount];
    // The ladder is finished. That is the whole point of an escalating cadence.
    if (step === undefined) return null;
    return atZonedTime(addZonedDays(state.startedAt, zone, step), zone, time);
  }

  if (cadence.kind === 'interval') {
    const from = state.lastSentAt ?? state.startedAt;
    // Before the first reminder, the interval counts from the day the request was sent —
    // so "every 3 days" means the client hears again three days after they were asked,
    // not three days after some scheduler noticed.
    return atZonedTime(addZonedDays(from, zone, cadence.everyDays!), zone, time);
  }

  const from = state.lastSentAt ?? state.startedAt;
  const days = cadence.weekdays!;
  let day = atZonedTime(from, zone, time);
  for (let i = 0; i <= 7; i += 1) {
    if (days.includes(zonedParts(day, zone).weekday) && day > from) return day;
    day = addZonedDays(day, zone, 1);
  }
  return null;
}

/** A sentence a person can check at a glance, for the schedule editor and the request page. */
export function describeCadence(cadence: Cadence): string {
  const time = `${String(cadence.sendAt.hour).padStart(2, '0')}:${String(cadence.sendAt.minute).padStart(2, '0')}`;
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let shape: string;
  if (cadence.kind === 'interval') {
    shape = cadence.everyDays === 1 ? 'Every day' : `Every ${cadence.everyDays} days`;
  } else if (cadence.kind === 'escalating') {
    const steps = cadence.steps!;
    const list = steps.slice(0, -1).join(', ');
    shape = `${steps.length} reminders, ${steps.length > 1 ? `${list} and ${steps.at(-1)}` : String(steps[0])} days after sending`;
  } else {
    const chosen = [...cadence.weekdays!].sort().map((day) => names[day]);
    const list =
      chosen.length > 1 ? `${chosen.slice(0, -1).join(', ')} and ${chosen.at(-1)}` : chosen[0];
    shape = `Every ${list}`;
  }

  const parts = [`${shape} at ${time} ${cadence.timezone.replace(/_/g, ' ')}`];
  if (cadence.quietHours) {
    parts.push(
      `nothing between ${String(cadence.quietHours.start).padStart(2, '0')}:00 and ${String(cadence.quietHours.end).padStart(2, '0')}:00`,
    );
  }
  if (cadence.maxCount != null && cadence.kind !== 'escalating') {
    parts.push(`at most ${cadence.maxCount}`);
  }
  parts.push('stopping as soon as everything is in');

  return `${parts.join(', ')}.`;
}

/** What a new schedule looks like before anyone edits it. */
export function defaultCadence(timezone: string): Cadence {
  return {
    kind: 'interval',
    everyDays: 3,
    sendAt: { hour: 9, minute: 0 },
    timezone,
    // Nine in the morning cannot land in the night, but "send now" can, and a firm that
    // moves the send time should not have to think about this separately.
    quietHours: { start: 21, end: 8 },
    maxCount: 8,
  };
}
