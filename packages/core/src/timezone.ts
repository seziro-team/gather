/**
 * Wall-clock time in somebody else's timezone.
 *
 * Reminders are the one part of Gather where getting a timezone wrong is visible to a
 * client rather than to an operator: "9am" has to mean nine in the morning where the person
 * reading the email lives, on both sides of a daylight-saving change, or the product looks
 * broken in exactly the way that makes people turn reminders off.
 *
 * `Intl` already knows every zone and every historical rule, and ships with Node. A date
 * library would be a dependency carrying a copy of the same IANA database, so this uses
 * `Intl` directly — about forty lines, and no data to keep current.
 */

export class InvalidTimezone extends Error {
  constructor(readonly timezone: string) {
    super(`"${timezone}" is not a timezone this system recognises.`);
    this.name = 'InvalidTimezone';
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  /** 1–31. */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      });
    } catch {
      throw new InvalidTimezone(timezone);
    }
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** What the clock on the wall says, in `timezone`, at instant `at`. */
export function zonedParts(at: Date, timezone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timezone).formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour12: false` still renders midnight as 24 in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday ?? '')),
  };
}

/** How far ahead of UTC `timezone` was at instant `at`, in milliseconds. */
export function offsetMs(at: Date, timezone: string): number {
  const parts = zonedParts(at, timezone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Milliseconds are not in the formatted parts, so they have to be added back before
  // the subtraction — otherwise every offset is out by up to 999 ms.
  return asIfUtc - (at.getTime() - at.getMilliseconds());
}

/**
 * The instant at which the clock in `timezone` reads the given wall-clock time.
 *
 * Two passes, because the offset depends on the instant and the instant depends on the
 * offset. The first guess uses the offset at the naive-UTC interpretation; if the corrected
 * instant falls on the other side of a daylight-saving transition, the second pass fixes it.
 *
 * The awkward cases resolve the way a person would expect:
 *  - A time that does not exist (the hour skipped in spring) lands just after the jump.
 *  - A time that happens twice (the hour repeated in autumn) resolves to the first of them.
 */
export function zonedTimeToUtc(
  timezone: string,
  wall: { year: number; month: number; day: number; hour: number; minute: number },
): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

  const firstOffset = offsetMs(new Date(naive), timezone);
  const first = new Date(naive - firstOffset);

  const secondOffset = offsetMs(first, timezone);
  // The overwhelmingly common case: one pass converged, because no transition is nearby.
  if (secondOffset === firstOffset) return first;

  const second = new Date(naive - secondOffset);

  // Near a transition, one of the two candidates reads back as the time that was asked
  // for. Prefer the earlier one, so a repeated hour resolves to its first occurrence.
  const secondMatches = readsAs(second, timezone, wall);
  const firstMatches = readsAs(first, timezone, wall);
  if (secondMatches && firstMatches) return second < first ? second : first;
  if (secondMatches) return second;
  if (firstMatches) return first;

  // Neither reads back: this wall-clock time was skipped by a spring-forward and never
  // happened. Shift forward past the gap rather than backwards into yesterday evening —
  // the same choice Temporal's `compatible` disambiguation makes, and the one that keeps
  // "09:00" from becoming "08:00" on one day a year.
  return first > second ? first : second;
}

function readsAs(
  at: Date,
  timezone: string,
  wall: { year: number; month: number; day: number; hour: number; minute: number },
): boolean {
  const parts = zonedParts(at, timezone);
  return (
    parts.year === wall.year &&
    parts.month === wall.month &&
    parts.day === wall.day &&
    parts.hour === wall.hour &&
    parts.minute === wall.minute
  );
}

/** The same wall-clock date, `days` later, resolved in `timezone`. */
export function addZonedDays(at: Date, timezone: string, days: number): Date {
  const parts = zonedParts(at, timezone);
  return zonedTimeToUtc(timezone, {
    year: parts.year,
    month: parts.month,
    // Date.UTC normalises overflow, so day + 40 is simply forty days later.
    day: parts.day + days,
    hour: parts.hour,
    minute: parts.minute,
  });
}

/** `at` moved to a given wall-clock time on the same local day. */
export function atZonedTime(
  at: Date,
  timezone: string,
  time: { hour: number; minute: number },
): Date {
  const parts = zonedParts(at, timezone);
  return zonedTimeToUtc(timezone, {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
  });
}
