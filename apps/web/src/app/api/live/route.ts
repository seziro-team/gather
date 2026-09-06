/**
 * Liveness. Is this process able to answer at all?
 *
 * Deliberately checks **nothing**. That is the whole point of the distinction:
 *
 * - `/api/live` — liveness. Answers unless the process is wedged. An orchestrator uses it
 *   to decide whether to *restart* the container.
 * - `/api/health` — readiness. Checks the database and the schema. An orchestrator uses it
 *   to decide whether to *send traffic*, and Docker's healthcheck waits on it.
 *
 * Conflating them is a well-known way to turn a database blip into a restart storm: every
 * replica fails its check at once, every replica is killed, and none of them comes back
 * any faster because the database is still down. Gather has to be able to sit and wait.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response('alive\n', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
