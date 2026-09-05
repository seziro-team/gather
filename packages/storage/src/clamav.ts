import { connect } from 'node:net';
import type { Readable } from 'node:stream';

/**
 * Talking to clamd.
 *
 * The wire protocol, from ClamAV's own documentation (`man clamd`, and
 * https://docs.clamav.net/manual/Usage/Scanning.html), verified against clamav/clamav:1.5
 * on 2026-09-05:
 *
 *   zINSTREAM\0            command, NUL-terminated ("z" prefix = NUL-terminated reply too)
 *   <uint32be length><chunk>   repeated; length is big-endian, max CHUNK below
 *   <uint32be 0>           zero-length chunk ends the stream
 *   ← "stream: OK\0"  or  "stream: <Signature> FOUND\0"  or  "… ERROR\0"
 *
 * Written directly rather than taken from a `clamscan` wrapper package: this is sixty
 * lines of socket handling, and a dependency that shells out to a binary we do not ship
 * would be a strictly worse thing to put on the path of every uploaded tax document.
 *
 * plan.md §4.3: ClamAV wants 3–4 GiB of RAM, which is more than the rest of Gather
 * combined, so it is an opt-in compose profile. With it off, files are honestly marked
 * `skipped` — never silently treated as clean.
 */

/** clamd's default `StreamMaxLength` is 25 MB; chunks well under it keep memory flat. */
const CHUNK = 64 * 1024;

export type ScanVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; reason: string };

export interface ClamAvOptions {
  host: string;
  port: number;
  /** How long to wait for clamd overall. A scan of a 100 MB file is not instant. */
  timeoutMs?: number;
}

export class ClamAv {
  readonly name = 'clamav';

  constructor(private readonly options: ClamAvOptions) {}

  /**
   * One NUL-terminated command, one reply.
   *
   * A fresh connection per command, which is what clamd expects: it closes the socket
   * after answering anything that is not INSTREAM.
   */
  private command(message: string): Promise<string> {
    const { host, port } = this.options;
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      let reply = '';

      socket.setTimeout(10_000, () => {
        socket.destroy();
        reject(new Error('clamd did not answer'));
      });
      socket.on('error', reject);
      socket.on('connect', () => socket.write(message));
      socket.on('data', (chunk) => {
        reply += chunk.toString('utf8');
        if (reply.includes('\0')) {
          socket.destroy();
          resolve(reply.replace(/\0/g, ''));
        }
      });
      socket.on('close', () => resolve(reply.replace(/\0/g, '')));
    });
  }

  /** `PING` → `PONG`. Used by the health endpoint to say whether scanning is actually up. */
  async ping(): Promise<boolean> {
    try {
      const reply = await this.command('zPING\0');
      return reply.trim() === 'PONG';
    } catch {
      return false;
    }
  }

  /** clamd's version and signature-database date, for the UI to show what "clean" meant. */
  async version(): Promise<string | null> {
    try {
      return (await this.command('zVERSION\0')).trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Scan a stream.
   *
   * The caller owns the stream and gets it back consumed — so an upload is scanned from a
   * tee of the same bytes that are being stored, not from a second read of the file.
   */
  async scan(source: Readable): Promise<ScanVerdict> {
    return new Promise((resolve) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const timeout = this.options.timeoutMs ?? 120_000;
      let settled = false;
      let reply = '';

      const done = (verdict: ScanVerdict) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        source.destroy();
        resolve(verdict);
      };

      socket.setTimeout(timeout, () =>
        done({ status: 'error', reason: `clamd did not answer within ${timeout}ms` }),
      );
      socket.on('error', (error) =>
        done({ status: 'error', reason: `could not reach clamd: ${error.message}` }),
      );
      socket.on('data', (chunk) => {
        reply += chunk.toString('utf8');
        if (reply.includes('\0')) done(interpret(reply));
      });
      socket.on('close', () => {
        if (!settled) done(interpret(reply));
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');

        source.on('error', (error: Error) =>
          done({ status: 'error', reason: `could not read the upload: ${error.message}` }),
        );

        source.on('data', (data: Buffer | string) => {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          for (let offset = 0; offset < buffer.length; offset += CHUNK) {
            const slice = buffer.subarray(offset, offset + CHUNK);
            const header = Buffer.allocUnsafe(4);
            header.writeUInt32BE(slice.length, 0);
            // Back-pressure: pause the source when the socket's buffer fills, so a slow
            // clamd cannot make a large upload accumulate in this process's memory.
            if (!socket.write(Buffer.concat([header, slice]))) {
              source.pause();
              socket.once('drain', () => source.resume());
            }
          }
        });

        source.on('end', () => {
          const terminator = Buffer.allocUnsafe(4);
          terminator.writeUInt32BE(0, 0);
          socket.write(terminator);
        });
      });
    });
  }
}

/**
 * clamd's answer, in the three shapes it comes in.
 *
 * `INSTREAM size limit exceeded` is called out because it is the one an operator will
 * actually hit — clamd's `StreamMaxLength` defaults to 25 MB and Gather's upload ceiling
 * defaults to 100 MB, so a large scan fails with a message that means nothing unless
 * somebody explains it.
 */
function interpret(reply: string): ScanVerdict {
  const text = reply.replace(/\0/g, '').trim();

  if (text.endsWith('OK') && !text.includes('FOUND')) return { status: 'clean' };

  const found = /^stream:\s*(.+?)\s+FOUND$/i.exec(text);
  if (found) return { status: 'infected', signature: found[1]! };

  if (/size limit exceeded/i.test(text)) {
    return {
      status: 'error',
      reason:
        `clamd refused the file: ${text}. Its StreamMaxLength (25 MB by default) is below ` +
        `GATHER_MAX_UPLOAD_MB. Raise StreamMaxLength in clamd.conf, or lower the upload limit.`,
    };
  }

  return { status: 'error', reason: text || 'clamd closed the connection without answering' };
}
