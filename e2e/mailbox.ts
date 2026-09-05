import { execFileSync } from 'node:child_process';

/**
 * Helpers for the reminder tests: a real inbox, and a way to move time.
 *
 * The inbox is Mailpit's HTTP API (docker-compose.mail.yml). Gather reaches it over SMTP
 * and knows nothing about it — messages here arrived through a real SMTP conversation, so
 * asserting on them is asserting on what a client would actually receive.
 */

const INBOX = process.env.GATHER_MAILPIT_URL ?? 'http://127.0.0.1:8026';

export interface InboxMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  createdAt: string;
}

interface MailpitSummary {
  messages_count: number;
  messages: {
    ID: string;
    From: { Address: string };
    To: { Address: string }[];
    Subject: string;
    Created: string;
  }[];
}

export async function inboxFor(address: string): Promise<InboxMessage[]> {
  // Mailpit's search is a query language over the whole store; scoping by recipient keeps
  // parallel tests from seeing each other's mail.
  const url = `${INBOX}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=50`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Mailpit at ${INBOX} answered ${response.status}. Is docker-compose.mail.yml up?`,
    );
  }
  const payload = (await response.json()) as MailpitSummary;
  return payload.messages.map((message) => ({
    id: message.ID,
    from: message.From.Address,
    to: message.To.map((entry) => entry.Address),
    subject: message.Subject,
    createdAt: message.Created,
  }));
}

export interface FullMessage {
  subject: string;
  text: string;
  html: string;
  messageId: string;
}

export async function readMessage(id: string): Promise<FullMessage> {
  const response = await fetch(`${INBOX}/api/v1/message/${id}`);
  if (!response.ok) throw new Error(`Mailpit returned ${response.status} for message ${id}`);
  const payload = (await response.json()) as {
    Subject: string;
    Text: string;
    HTML: string;
    MessageID: string;
  };
  return {
    subject: payload.Subject,
    text: payload.Text,
    html: payload.HTML,
    messageId: payload.MessageID,
  };
}

/** Wait until `address` has at least `count` messages, or fail saying what it did have. */
export async function waitForMail(
  address: string,
  count: number,
  timeoutMs = 90_000,
): Promise<InboxMessage[]> {
  const deadline = Date.now() + timeoutMs;
  let seen: InboxMessage[] = [];
  while (Date.now() < deadline) {
    seen = await inboxFor(address);
    if (seen.length >= count) return seen;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Expected ${count} message(s) for ${address} within ${timeoutMs}ms, saw ${seen.length}: ` +
      seen.map((message) => message.subject).join(' | '),
  );
}

/** Assert that nothing more arrives. Used to prove reminders actually stop. */
export async function expectNoMoreMail(
  address: string,
  currentCount: number,
  windowMs: number,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const seen = await inboxFor(address);
    if (seen.length > currentCount) {
      throw new Error(
        `A reminder was sent after it should have stopped: ${seen.length} messages, expected ` +
          `no more than ${currentCount}. Latest: ${seen[0]?.subject}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Run one SQL statement against the install under test.
 *
 * Used to move a schedule's `next_run_at` into the past — the one thing a test cannot do
 * by waiting, because the shortest cadence Gather offers is a day. Nothing else about the
 * send is simulated: the worker's scan, the claim, the SMTP conversation and the message
 * in the inbox are all the real thing.
 */
export function sql(statement: string): string {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'gather', '-t', '-A', '-c', statement],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname },
  ).trim();
}

/**
 * The first row of a result.
 *
 * `psql` prints the command tag ("INSERT 0 1") after the returned rows even with `-t`, so
 * a RETURNING clause read whole picks it up too.
 */
function firstRow(statement: string): string {
  return sql(statement).split('\n')[0]!.trim();
}

/** Pretend the schedule for this request came due a minute ago. */
export function makeReminderDue(requestId: string): void {
  const updated = firstRow(
    `update reminder_schedule set next_run_at = now() - interval '1 minute'
     where request_id = '${requestId}' and active returning id`,
  );
  if (!updated) throw new Error(`No active reminder schedule for request ${requestId}`);
}

export function scheduleRow(requestId: string): { active: boolean; sentCount: number } {
  const row = firstRow(
    `select active, sent_count from reminder_schedule where request_id = '${requestId}'`,
  );
  const [active, sentCount] = row.split('|');
  return { active: active === 't', sentCount: Number(sentCount) };
}

export function reminderLogCount(requestId: string): number {
  return Number(firstRow(`select count(*) from reminder_log where request_id = '${requestId}'`));
}

/**
 * Simulate a worker that claimed a reminder and then died before sending it.
 *
 * This is the exact crash the send-once guarantee exists for, and it is the only one
 * worth testing: the claim row is written *before* the message is handed to a mail
 * driver, so a process killed in that window leaves a row and no email. When it restarts
 * it recomputes the same key — `schedule:<id>:<sent_count>` — and must refuse.
 *
 * Re-arming a schedule after a *successful* send is a different thing entirely: sent_count
 * has moved, the key is different, and the next reminder is genuinely due.
 */
export function simulateCrashedClaim(requestId: string): string {
  const key = firstRow(
    `insert into reminder_log (request_id, schedule_id, to_address, status, idempotency_key)
     select s.request_id, s.id, c.email, 'queued',
            'schedule:' || s.id || ':' || s.sent_count
       from reminder_schedule s
       join request r on r.id = s.request_id
       join client c on c.id = r.client_id
      where s.request_id = '${requestId}'
     returning idempotency_key`,
  );
  if (!key) throw new Error(`No reminder schedule for request ${requestId}`);
  return key;
}

/** The provider message id Gather recorded for a request's most recent reminder. */
export function lastProviderMessageId(requestId: string): string {
  const id = firstRow(
    `select provider_message_id from reminder_log
      where request_id = '${requestId}' and provider_message_id is not null
      order by sent_at desc limit 1`,
  );
  if (!id) throw new Error(`No sent reminder for request ${requestId}`);
  return id;
}

export function reminderStatus(requestId: string): string {
  return firstRow(
    `select status from reminder_log where request_id = '${requestId}' order by sent_at desc limit 1`,
  );
}

export function auditActions(requestId: string): string[] {
  return sql(`select action from audit_event where request_id = '${requestId}' order by id`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
