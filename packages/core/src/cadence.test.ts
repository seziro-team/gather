import { describe, expect, it } from 'vitest';
import {
  cadenceSchema,
  defaultCadence,
  describeCadence,
  inQuietHours,
  nextRunAt,
  type Cadence,
} from './cadence.js';
import { offsetMs, zonedParts, zonedTimeToUtc } from './timezone.js';

/**
 * The reminder engine's arithmetic, with no database, queue or SMTP server involved.
 *
 * Everything a client sees about *when* they are nagged is decided here, so this is where
 * the awkward cases belong: daylight saving in both directions, a window that wraps
 * midnight, a worker that was down for a week, and a firm in London chasing a client in
 * Sydney.
 */

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const SYDNEY = 'Australia/Sydney';

/** A wall-clock time in a zone, as an instant. Reads better than a UTC literal. */
function local(timezone: string, text: string): Date {
  const [date, time = '00:00'] = text.split(' ');
  const [year, month, day] = date!.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return zonedTimeToUtc(timezone, {
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    minute: minute ?? 0,
  });
}

function wall(at: Date, timezone: string): string {
  const p = zonedParts(at, timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const base: Cadence = {
  kind: 'interval',
  everyDays: 3,
  sendAt: { hour: 9, minute: 0 },
  timezone: LONDON,
  quietHours: null,
  maxCount: null,
};

describe('timezone arithmetic', () => {
  it('round-trips a wall-clock time through an instant', () => {
    const at = local(NEW_YORK, '2026-03-14 09:30');
    expect(wall(at, NEW_YORK)).toBe('2026-03-14 09:30');
  });

  it('knows the offset changes across a daylight-saving boundary', () => {
    // The US springs forward on 2026-03-08; the UK not until 2026-03-29.
    expect(offsetMs(local(NEW_YORK, '2026-03-01 12:00'), NEW_YORK)).toBe(-5 * 3_600_000);
    expect(offsetMs(local(NEW_YORK, '2026-03-15 12:00'), NEW_YORK)).toBe(-4 * 3_600_000);
    expect(offsetMs(local(SYDNEY, '2026-07-01 12:00'), SYDNEY)).toBe(10 * 3_600_000);
    expect(offsetMs(local(SYDNEY, '2026-01-01 12:00'), SYDNEY)).toBe(11 * 3_600_000);
  });

  it('resolves a wall-clock time that does not exist to just after the jump', () => {
    // 02:30 on 2026-03-08 never happens in New York — the clock goes 01:59 → 03:00.
    const at = zonedTimeToUtc(NEW_YORK, {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
    });
    expect(wall(at, NEW_YORK)).toBe('2026-03-08 03:30');
  });
});

describe('interval cadence', () => {
  it('counts the first reminder from the day the request was sent', () => {
    const startedAt = local(LONDON, '2026-06-01 14:20');
    const next = nextRunAt(base, { startedAt, lastSentAt: null, sentCount: 0 }, startedAt);

    // Three days later at nine, not three days after some scheduler noticed.
    expect(wall(next!, LONDON)).toBe('2026-06-04 09:00');
  });

  it('counts later reminders from the last one actually sent', () => {
    const startedAt = local(LONDON, '2026-06-01 14:20');
    const lastSentAt = local(LONDON, '2026-06-04 09:00');
    const next = nextRunAt(base, { startedAt, lastSentAt, sentCount: 1 }, lastSentAt);

    expect(wall(next!, LONDON)).toBe('2026-06-07 09:00');
  });

  it('keeps nine in the morning at nine across a daylight-saving change', () => {
    // The UK springs forward on 2026-03-29. A reminder either side must read 09:00.
    const cadence: Cadence = { ...base, everyDays: 2, timezone: LONDON };
    const startedAt = local(LONDON, '2026-03-26 09:00');

    const first = nextRunAt(cadence, { startedAt, lastSentAt: null, sentCount: 0 }, startedAt)!;
    expect(wall(first, LONDON)).toBe('2026-03-28 09:00');

    const second = nextRunAt(cadence, { startedAt, lastSentAt: first, sentCount: 1 }, first)!;
    expect(wall(second, LONDON)).toBe('2026-03-30 09:00');

    // …and the gap in real time is 23 hours short of two days, which is the point.
    expect(second.getTime() - first.getTime()).toBe(2 * 86_400_000 - 3_600_000);
  });

  it('stops at maxCount', () => {
    const cadence: Cadence = { ...base, maxCount: 2 };
    const startedAt = local(LONDON, '2026-06-01 09:00');
    const state = { startedAt, lastSentAt: startedAt, sentCount: 2 };
    expect(nextRunAt(cadence, state, startedAt)).toBeNull();
  });

  it('collapses a backlog into one reminder rather than a burst', () => {
    const startedAt = local(LONDON, '2026-06-01 09:00');
    // The worker has been down for a fortnight; five reminders were "due".
    const now = local(LONDON, '2026-06-15 11:17');
    const next = nextRunAt(base, { startedAt, lastSentAt: null, sentCount: 0 }, now)!;

    // One, now — not five backdated ones, and not a day's wait either.
    expect(next.getTime()).toBe(now.getTime());
  });
});

describe('escalating cadence', () => {
  const escalating: Cadence = {
    kind: 'escalating',
    steps: [3, 7, 14, 21],
    sendAt: { hour: 9, minute: 0 },
    timezone: NEW_YORK,
    quietHours: null,
    maxCount: null,
  };

  it('measures every step from the day the request was sent', () => {
    const startedAt = local(NEW_YORK, '2026-09-01 16:45');
    const expected = [
      '2026-09-04 09:00',
      '2026-09-08 09:00',
      '2026-09-15 09:00',
      '2026-09-22 09:00',
    ];

    for (const [sentCount, when] of expected.entries()) {
      const next = nextRunAt(
        escalating,
        { startedAt, lastSentAt: sentCount === 0 ? null : startedAt, sentCount },
        startedAt,
      );
      expect(wall(next!, NEW_YORK), `step ${sentCount}`).toBe(when);
    }
  });

  it('ends when the ladder runs out', () => {
    const startedAt = local(NEW_YORK, '2026-09-01 16:45');
    const state = { startedAt, lastSentAt: startedAt, sentCount: 4 };
    expect(nextRunAt(escalating, state, startedAt)).toBeNull();
  });

  it('refuses steps that are not ascending', () => {
    const result = cadenceSchema.safeParse({ ...escalating, steps: [3, 14, 7] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/ascending/);
  });
});

describe('weekday cadence', () => {
  const mondays: Cadence = {
    kind: 'weekdays',
    weekdays: [1],
    sendAt: { hour: 8, minute: 30 },
    timezone: LONDON,
    quietHours: null,
    maxCount: null,
  };

  it('picks the next chosen day', () => {
    // 2026-06-03 is a Wednesday.
    const startedAt = local(LONDON, '2026-06-03 15:00');
    const next = nextRunAt(mondays, { startedAt, lastSentAt: null, sentCount: 0 }, startedAt)!;
    expect(wall(next, LONDON)).toBe('2026-06-08 08:30');
    expect(zonedParts(next, LONDON).weekday).toBe(1);
  });

  it('never lands on a day the firm did not choose, even when overdue', () => {
    const startedAt = local(LONDON, '2026-06-03 15:00');
    // Two weeks late, and today is a Thursday.
    const now = local(LONDON, '2026-06-18 12:00');
    const next = nextRunAt(mondays, { startedAt, lastSentAt: null, sentCount: 0 }, now)!;
    expect(zonedParts(next, LONDON).weekday).toBe(1);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('quiet hours', () => {
  const quiet: Cadence = { ...base, timezone: SYDNEY, quietHours: { start: 21, end: 8 } };

  it('recognises a window that wraps midnight', () => {
    expect(inQuietHours(local(SYDNEY, '2026-06-01 22:30'), quiet)).toBe(true);
    expect(inQuietHours(local(SYDNEY, '2026-06-01 03:00'), quiet)).toBe(true);
    expect(inQuietHours(local(SYDNEY, '2026-06-01 08:00'), quiet)).toBe(false);
    expect(inQuietHours(local(SYDNEY, '2026-06-01 20:59'), quiet)).toBe(false);
  });

  it('moves an evening send to the following morning', () => {
    const startedAt = local(SYDNEY, '2026-06-01 09:00');
    // Overdue at 11pm local: without quiet hours this would go out immediately.
    const now = local(SYDNEY, '2026-06-10 23:10');
    const next = nextRunAt(quiet, { startedAt, lastSentAt: null, sentCount: 0 }, now)!;
    expect(wall(next, SYDNEY)).toBe('2026-06-11 08:00');
  });

  it('moves an early-hours send to later the same morning', () => {
    const startedAt = local(SYDNEY, '2026-06-01 09:00');
    const now = local(SYDNEY, '2026-06-10 04:15');
    const next = nextRunAt(quiet, { startedAt, lastSentAt: null, sentCount: 0 }, now)!;
    expect(wall(next, SYDNEY)).toBe('2026-06-10 08:00');
  });

  it('refuses a window that would silence everything forever', () => {
    const result = cadenceSchema.safeParse({ ...base, quietHours: { start: 9, end: 9 } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/silence every reminder/);
  });
});

describe('a London firm chasing a client in Sydney', () => {
  it('sends at nine in Sydney, not nine in London', () => {
    const cadence: Cadence = { ...base, timezone: SYDNEY, everyDays: 1 };
    const startedAt = local(LONDON, '2026-06-01 17:00');
    const next = nextRunAt(cadence, { startedAt, lastSentAt: null, sentCount: 0 }, startedAt)!;

    expect(zonedParts(next, SYDNEY).hour).toBe(9);
    // Which is the small hours in London — and that is correct.
    expect(zonedParts(next, LONDON).hour).toBe(0);
  });
});

describe('description', () => {
  it('says what a schedule will do in one sentence', () => {
    expect(describeCadence(defaultCadence(LONDON))).toBe(
      'Every 3 days at 09:00 Europe/London, nothing between 21:00 and 08:00, at most 8, ' +
        'stopping as soon as everything is in.',
    );
    expect(
      describeCadence({
        kind: 'escalating',
        steps: [3, 7, 14],
        sendAt: { hour: 8, minute: 30 },
        timezone: NEW_YORK,
        quietHours: null,
        maxCount: null,
      }),
    ).toBe(
      '3 reminders, 3, 7 and 14 days after sending at 08:30 America/New York, ' +
        'stopping as soon as everything is in.',
    );
    expect(
      describeCadence({
        kind: 'weekdays',
        weekdays: [1, 4],
        sendAt: { hour: 10, minute: 0 },
        timezone: LONDON,
        quietHours: null,
        maxCount: null,
      }),
    ).toBe(
      'Every Monday and Thursday at 10:00 Europe/London, stopping as soon as everything is in.',
    );
  });
});

describe('validation', () => {
  it('requires the field its kind depends on', () => {
    expect(cadenceSchema.safeParse({ ...base, everyDays: undefined }).success).toBe(false);
    expect(
      cadenceSchema.safeParse({ ...base, kind: 'weekdays', everyDays: undefined }).success,
    ).toBe(false);
  });

  it('refuses a timezone the system does not know', () => {
    const result = cadenceSchema.safeParse({ ...base, timezone: 'Mars/Olympus_Mons' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/IANA/);
  });

  it('accepts every shipped default', () => {
    for (const zone of [LONDON, NEW_YORK, SYDNEY, 'UTC']) {
      expect(cadenceSchema.safeParse(defaultCadence(zone)).success).toBe(true);
    }
  });
});
