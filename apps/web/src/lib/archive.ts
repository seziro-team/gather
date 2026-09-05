import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import type { DownloadableFile } from '@gather/db';
import { openFile } from './files';

/**
 * Everything a client sent, as one zip.
 *
 * Streamed rather than assembled: a year of bank statements is hundreds of megabytes, and
 * buffering that to build a Content-Length would put it all in the app's heap. `yazl`
 * (MIT) writes entries as they are read and uses a data descriptor for sizes it does not
 * know in advance, which is exactly the trade — no length header, no memory ceiling.
 *
 * `addReadStreamLazy` matters more than it looks: it opens each file only when the writer
 * reaches it, so a 40-file request holds one decryption stream at a time rather than forty.
 */

/**
 * `01 Income/02 Bank statements - statement-jan.pdf`
 *
 * ASCII punctuation, deliberately. Entry names are UTF-8 and carry the flag that says so,
 * which every current extractor honours — but Info-ZIP UnZip 6.00 (2009) is still what
 * `unzip` is on Debian and Ubuntu, and it prints a "mismatching local filename" warning
 * and exits non-zero for any non-ASCII name. The archive is fine; the tool is old. Where
 * the characters come from a firm's or a client's own data we keep them, because mangling
 * somebody's name is worse than a warning. Where they are ours — this separator — we do
 * not spend their goodwill on a typographic preference.
 */
export function entryPath(entry: DownloadableFile): string {
  const section = `${pad(entry.sectionPosition + 1)} ${sanitize(entry.sectionTitle)}`;
  const label = `${pad(entry.itemPosition + 1)} ${sanitize(entry.itemLabel)}`;
  return `${section}/${label} - ${sanitize(entry.file.originalName)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A path component that opens everywhere.
 *
 * Windows refuses `\ / : * ? " < > |` and trailing dots or spaces; macOS and Linux treat
 * `/` as a separator. A zip that unpacks on the firm's machine and not on their client's
 * accountant's is a zip that generates a support email, so the intersection wins.
 */
export function sanitize(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    // Control characters are legal in a zip entry name and legal in no filesystem, so a
    // crafted filename could otherwise produce an archive that will not extract.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');

  // Reserved device names on Windows, which cannot be a filename even with an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)) return `_${cleaned}`;

  // Long enough for any real document name, short enough that the whole path stays under
  // the 260-character ceiling a default Windows install still has.
  return (cleaned || 'untitled').slice(0, 80);
}

export interface ArchiveOptions {
  /** Prefixed to every entry, so unzipping never scatters files into the current directory. */
  rootFolder: string;
  files: DownloadableFile[];
  /** A line explaining what is and is not in here, written into the archive. */
  manifest: string;
}

export function buildArchive(options: ArchiveOptions): Readable {
  const zip = new ZipFile();

  // Duplicate names are possible and legal — two files called `scan.pdf` in one item —
  // and a zip with two identical entry paths extracts unpredictably.
  const used = new Map<string, number>();

  for (const entry of options.files) {
    const base = `${options.rootFolder}/${entryPath(entry)}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const path = seen === 0 ? base : withSuffix(base, seen + 1);

    zip.addReadStreamLazy(
      path,
      { mtime: entry.file.uploadedAt, mode: 0o644 },
      // yazl's contract: a truthy first argument makes it emit `error` on the zip and
      // ignore the stream, which is why the unreachable second argument is cast rather
      // than fabricated as an empty stream — an empty stream would silently produce a
      // zero-byte entry for a document that failed to decrypt.
      (callback: (error: unknown, stream: NodeJS.ReadableStream) => void) => {
        openFile(entry.file).then(
          (stream) => callback(null, stream),
          (error: unknown) => callback(error, null as unknown as NodeJS.ReadableStream),
        );
      },
    );
  }

  zip.addBuffer(Buffer.from(options.manifest, 'utf8'), `${options.rootFolder}/MANIFEST.txt`, {
    mtime: new Date(0),
  });

  zip.end();
  return zip.outputStream as unknown as Readable;
}

function withSuffix(path: string, index: number): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot <= slash) return `${path} (${index})`;
  return `${path.slice(0, dot)} (${index})${path.slice(dot)}`;
}

/**
 * What is in the archive, and what is deliberately not.
 *
 * A zip of tax documents with no provenance is a folder of PDFs. This one says which
 * request it came from, when it was made, and the SHA-256 of every file — so a firm can
 * prove later that what they handed on is what the client sent.
 */
export function buildManifest(input: {
  firmName: string;
  clientName: string;
  requestTitle: string;
  generatedAt: Date;
  files: DownloadableFile[];
  skipped: DownloadableFile[];
}): string {
  const lines = [
    `${input.requestTitle}`,
    `Client:    ${input.clientName}`,
    `Firm:      ${input.firmName}`,
    `Exported:  ${input.generatedAt.toISOString()}`,
    `Files:     ${input.files.length}`,
    '',
    'Every file below is exactly as the client uploaded it. The hash is SHA-256 of the',
    'file contents, recorded when it arrived — not computed from this archive.',
    '',
  ];

  for (const entry of input.files) {
    lines.push(`${entry.file.sha256}  ${entryPath(entry)}`);
  }

  if (input.skipped.length > 0) {
    lines.push(
      '',
      `Not included (${input.skipped.length}): superseded by a later upload after the firm`,
      'sent the item back. They are retained in Gather and remain in the audit trail.',
      '',
    );
    for (const entry of input.skipped) {
      lines.push(
        `  v${entry.file.responseVersion}  ${entry.itemLabel} — ${entry.file.originalName}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
