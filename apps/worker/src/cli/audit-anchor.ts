#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createLogger, isLogLevel } from '@gather/core';
import { closeDb, getDb, readAuditHash, readAuditHead } from '@gather/db';

/**
 * `pnpm audit:anchor` — put the audit chain's head somewhere the database cannot reach.
 *
 *   pnpm audit:anchor --write                       # append today's head to the anchor file
 *   pnpm audit:anchor --verify                      # check every past anchor still holds
 *   pnpm audit:anchor --write --file /mnt/wo/anchors.log
 *
 * This closes the gap `SECURITY.md` has always been honest about. The chain is tamper
 * *evidence*, not tamper prevention: somebody with full write access to the database can
 * disable the trigger, rewrite history and recompute every hash, and the recomputed chain
 * verifies perfectly — because they hold every input to it.
 *
 * What they cannot recompute is a hash you wrote down somewhere else yesterday. That is all
 * an anchor is: a line saying "at 14:32 on Tuesday, event 8,412 hashed to a4f2…". Rewrite
 * history and event 8,412 hashes to something else, and the anchor no longer matches.
 *
 * **The anchor is only worth where you keep it.** A file on the same disk as the database
 * defeats the point. Useful places: append-only object storage, a WORM bucket, a git
 * repository somebody else hosts, a printout in a drawer, an email to your accountant.
 * Gather cannot check that you chose well — but it can tell you it cannot, which is why
 * this comment exists and why the CLI prints the same warning.
 */

const rawLevel = process.env.GATHER_LOG_LEVEL;
const log = createLogger({
  name: 'audit:anchor',
  level: rawLevel && isLogLevel(rawLevel) ? rawLevel : 'info',
});

const DEFAULT_FILE = process.env.GATHER_AUDIT_ANCHOR_FILE ?? './gather-audit-anchors.log';

interface Anchor {
  at: string;
  lastId: number;
  lastHash: string;
}

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** One JSON object per line: appendable, greppable, and diffable in a git history. */
function parseAnchors(path: string): Anchor[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Anchor;
      } catch {
        throw new Error(`${path} line ${index + 1} is not a Gather anchor: ${line.slice(0, 80)}`);
      }
    });
}

async function write(path: string): Promise<void> {
  const head = await readAuditHead(getDb());
  if (!head) {
    console.log('Nothing to anchor: this install has no audit events yet.');
    return;
  }

  const anchor: Anchor = {
    at: head.updatedAt.toISOString(),
    lastId: head.lastId,
    lastHash: head.lastHash,
  };
  appendFileSync(path, `${JSON.stringify(anchor)}\n`, 'utf8');

  log.info('anchored', { ...anchor });
  console.log(`
Anchored event ${anchor.lastId} → ${anchor.lastHash}
Appended to ${path}

⚠️  An anchor on the same machine as the database proves nothing — whoever could rewrite
   one could rewrite the other. Copy this file somewhere the database cannot reach:
   append-only object storage, a WORM bucket, a repository somebody else hosts, or paper.
`);
}

async function verify(path: string): Promise<void> {
  const anchors = parseAnchors(path);
  if (anchors.length === 0) {
    console.error(`No anchors in ${path}. Write one first: pnpm audit:anchor --write`);
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const failures: string[] = [];

  for (const anchor of anchors) {
    const stored = await readAuditHash(db, anchor.lastId);

    if (stored === null) {
      // The event the anchor names is gone. Deleting from `audit_event` is blocked by a
      // trigger, so this means the trigger was disabled — or the whole table replaced.
      failures.push(
        `event ${anchor.lastId} (anchored ${anchor.at}) is missing from the audit log entirely`,
      );
      continue;
    }

    if (stored !== anchor.lastHash) {
      failures.push(
        `event ${anchor.lastId} (anchored ${anchor.at}) now hashes to ${stored}, ` +
          `but was ${anchor.lastHash} when it was anchored — history has been rewritten`,
      );
    }
  }

  const head = await readAuditHead(db);
  const newest = anchors[anchors.length - 1]!;

  if (failures.length > 0) {
    console.error(`\nFAIL — ${failures.length} of ${anchors.length} anchors no longer hold:\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(
      '\nThis is the alarm the anchor exists to raise. Treat it as a compromise of the\n' +
        'database until proven otherwise: docs/incident-response.md.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (head && head.lastId < newest.lastId) {
    // Not a hash mismatch: the log is *shorter* than it was. Truncating the newest events
    // and resetting the head is the one attack the chain alone cannot see, because every
    // remaining link is still valid.
    console.error(
      `\nFAIL — the audit log has shrunk. It ends at event ${head.lastId}, but event ` +
        `${newest.lastId} was anchored on ${newest.at}.\nEvents have been removed.\n`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`
OK: ${anchors.length} anchor${anchors.length === 1 ? ' still holds' : 's still hold'}.
Oldest: event ${anchors[0]!.lastId}, anchored ${anchors[0]!.at}
Newest: event ${newest.lastId}, anchored ${newest.at}
The log now ends at event ${head?.lastId ?? 0}.
`);
}

async function main(): Promise<void> {
  const path = flagValue('--file') ?? DEFAULT_FILE;
  const doWrite = process.argv.includes('--write');
  const doVerify = process.argv.includes('--verify');

  if (doWrite === doVerify) {
    console.error(`
Usage:
  pnpm audit:anchor --write   [--file <path>]   append the current head
  pnpm audit:anchor --verify  [--file <path>]   check every past anchor still holds

Default file: ${DEFAULT_FILE} (or GATHER_AUDIT_ANCHOR_FILE)
`);
    process.exitCode = 1;
    return;
  }

  if (doWrite) await write(path);
  else await verify(path);
}

try {
  await main();
} catch (error) {
  log.error('anchor failed', { error: (error as Error).message });
  process.exitCode = 1;
} finally {
  await closeDb();
}
