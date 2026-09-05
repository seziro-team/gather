import { fileTypeFromBuffer } from 'file-type';

/**
 * What a file actually is, decided from its bytes rather than its name.
 *
 * plan.md §6: "magic-byte MIME sniffing (never trust extension)". A browser's declared
 * `Content-Type` is attacker-controlled and a filename is a label, so neither decides
 * anything here. The declared extension is used for exactly two things — matching the
 * item's accepted list, and judging formats that genuinely have no magic bytes.
 */

/**
 * Enough for every signature `file-type` knows about. Its own detection window is 4100
 * bytes; ISO-BMFF (HEIC, MOV) needs the most of anyone.
 */
export const SNIFF_BYTES = 4100;

/**
 * Formats that execute when a browser renders them.
 *
 * Downloads are already served as attachments with `X-Content-Type-Options: nosniff`, and
 * Phase 6 moves them to a separate origin. This list is the layer that means none of that
 * has to hold: a firm's client cannot upload an HTML page or an SVG into a request in the
 * first place. Scripts and installers are here because a document request is not a file
 * transfer service.
 */
const BLOCKED_EXTENSIONS = new Set([
  'htm',
  'html',
  'xhtml',
  'shtml',
  'svg',
  'svgz',
  'mhtml',
  'xht',
  'js',
  'mjs',
  'wasm',
  'exe',
  'dll',
  'msi',
  'scr',
  'com',
  'bat',
  'cmd',
  'ps1',
  'vbs',
  'jar',
  'apk',
  'app',
  'deb',
  'rpm',
  'dmg',
  'sh',
  'bash',
  'zsh',
]);

/**
 * Formats with no signature to find. A CSV is bytes that happen to have commas in.
 * They are allowed on their declared extension alone, and stored as text/plain.
 */
const TEXTUAL_EXTENSIONS = new Set([
  'txt',
  'csv',
  'tsv',
  'md',
  'log',
  // Bank and accounting exports a bookkeeper is asked for constantly.
  'ofx',
  'qfx',
  'qbo',
  'qif',
  'iif',
]);

/**
 * Extensions a detected type is allowed to disagree with.
 *
 * `file-type` reports the container, not the document: every Office file since 2007 is a
 * zip, and everything before it is a Microsoft compound file. Reporting "your .docx is
 * really a zip" would be true and useless.
 */
const COMPATIBLE_WITH: Record<string, readonly string[]> = {
  jpg: ['jpg', 'jpeg'],
  jpeg: ['jpg', 'jpeg'],
  tif: ['tif', 'tiff'],
  tiff: ['tif', 'tiff'],
  heic: ['heic', 'heif'],
  heif: ['heic', 'heif'],
  docx: ['docx', 'zip', 'cfb'],
  xlsx: ['xlsx', 'zip', 'cfb'],
  pptx: ['pptx', 'zip', 'cfb'],
  odt: ['odt', 'zip'],
  ods: ['ods', 'zip'],
  doc: ['doc', 'cfb'],
  xls: ['xls', 'cfb'],
  ppt: ['ppt', 'cfb'],
  msg: ['msg', 'cfb'],
  numbers: ['numbers', 'zip'],
  pages: ['pages', 'zip'],
};

/**
 * Formats that always begin with a signature `file-type` can find.
 *
 * If a file claims one of these and nothing was detected, the claim is false — the bytes
 * are not what the name says. That was found by a test uploading HTML named `.pdf`: no
 * binary signature, so `file-type` reported nothing, and the file sailed through the
 * extension checks because the *extension* was fine.
 */
const SIGNATURE_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'bmp',
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'doc',
  'xls',
  'ppt',
  'msg',
  'rtf',
  'mp4',
  'mov',
]);

/**
 * Is this markup a browser would execute?
 *
 * `file-type` reads binary signatures, so HTML, SVG and XML are invisible to it — they are
 * text. Blocking them by extension alone means renaming `evil.svg` to `evil.pdf` gets it
 * past, which is exactly what happens without this.
 *
 * The file is still never rendered in Gather's origin (downloads are always an attachment
 * with `default-src 'none'; sandbox`). This is the layer before that one: the firm's own
 * machine, where somebody double-clicks it out of their downloads folder and it opens in a
 * browser with a `file://` origin that no header of ours controls.
 */
function looksLikeMarkup(head: Uint8Array): boolean {
  // Enough to see a doctype or a root element, and short enough that a large binary file
  // whose first kilobyte happens to contain "<html" in a comment is not misjudged.
  const start = Buffer.from(head.subarray(0, 512))
    .toString('utf8')
    // A UTF-8 or UTF-16 BOM, and any leading whitespace.
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();

  return (
    start.startsWith('<!doctype html') ||
    start.startsWith('<html') ||
    start.startsWith('<svg') ||
    start.startsWith('<?xml') ||
    start.startsWith('<!entity') ||
    // A fragment with no root element, which is still executed by a browser.
    /^<(script|iframe|object|embed|body|head)\b/.test(start)
  );
}

export class UploadRejected extends Error {
  constructor(
    message: string,
    readonly reason: 'blocked-type' | 'not-accepted' | 'content-mismatch' | 'empty-name',
  ) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/**
 * A filename safe to store and to put in a `Content-Disposition`.
 *
 * Directory components are dropped rather than escaped — a client's browser has no business
 * telling us a path. Control characters go because they end up in logs and in zip entries.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["*:<>?|\\/]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot would hide the file; a trailing dot breaks on Windows.
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');

  if (cleaned === '') return '';

  // Keep the extension when truncating: a 200-character name that loses its ".pdf" is
  // worse than a short one that keeps it.
  const limit = 180;
  if (cleaned.length <= limit) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0 || cleaned.length - dot > 12) return cleaned.slice(0, limit);
  const extension = cleaned.slice(dot);
  return cleaned.slice(0, limit - extension.length) + extension;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export interface SniffResult {
  /** Never the browser's claim. `application/octet-stream` when nothing is recognised. */
  mime: string;
  /** The extension the bytes say, when they say anything. */
  detectedExtension: string | null;
}

export interface SniffInput {
  /** The first `SNIFF_BYTES` of the plaintext. Fewer is fine for a small file. */
  head: Uint8Array;
  /** Already passed through `sanitizeFilename`. */
  filename: string;
  /** The item's accepted extensions, dot-prefixed and lowercase. Empty means anything. */
  accept?: readonly string[];
}

/**
 * Decide whether an upload may be stored, and what it really is.
 *
 * Throws `UploadRejected` with a message written for the client who is uploading, because
 * that is who reads it.
 */
export async function sniffUpload(input: SniffInput): Promise<SniffResult> {
  const filename = input.filename;
  if (filename === '') {
    throw new UploadRejected(
      'That file has no usable name. Rename it and try again.',
      'empty-name',
    );
  }

  const declared = extensionOf(filename);
  if (declared !== '' && BLOCKED_EXTENSIONS.has(declared)) {
    throw new UploadRejected(
      `Gather does not accept .${declared} files. Send a document or a photo instead.`,
      'blocked-type',
    );
  }

  // Before anything else that reads bytes: markup is text, so `file-type` cannot see it,
  // and blocking `.svg` by name alone means renaming it to `.pdf` gets it through.
  if (looksLikeMarkup(input.head)) {
    throw new UploadRejected(
      'This file is a web page or an image with code in it, whatever it is named. ' +
        'Gather does not accept those — send a document or a photo instead.',
      'blocked-type',
    );
  }

  const detected = await fileTypeFromBuffer(input.head);
  const detectedExtension = detected?.ext.toLowerCase() ?? null;

  if (detectedExtension && BLOCKED_EXTENSIONS.has(detectedExtension)) {
    throw new UploadRejected(
      `This file is really a .${detectedExtension}, which Gather does not accept.`,
      'blocked-type',
    );
  }

  const accept = (input.accept ?? []).map((entry) => entry.replace(/^\./, '').toLowerCase());
  if (accept.length > 0 && !accept.includes(declared)) {
    throw new UploadRejected(
      `This item accepts ${accept.map((entry) => `.${entry}`).join(', ')}. ` +
        (declared === '' ? 'That file has no extension.' : `You sent a .${declared} file.`),
      'not-accepted',
    );
  }

  // The extension says one thing and the bytes say another. Usually a renamed file, and
  // occasionally somebody trying it on; either way the client should know.
  if (detectedExtension && declared !== '' && !matches(declared, detectedExtension)) {
    throw new UploadRejected(
      `This file is named .${declared} but its contents are a .${detectedExtension} file. ` +
        'Check you picked the right one.',
      'content-mismatch',
    );
  }

  // A name that promises a format with a signature, and no signature found. The bytes are
  // not what the name says, and there is no benign version of that.
  if (!detected && SIGNATURE_EXTENSIONS.has(declared)) {
    throw new UploadRejected(
      `This file is named .${declared}, but its contents are not a .${declared} file. ` +
        'Check you picked the right one.',
      'content-mismatch',
    );
  }

  if (detected) return { mime: detected.mime, detectedExtension };
  if (TEXTUAL_EXTENSIONS.has(declared)) return { mime: 'text/plain', detectedExtension: null };
  return { mime: 'application/octet-stream', detectedExtension: null };
}

function matches(declared: string, detectedExtension: string): boolean {
  if (declared === detectedExtension) return true;
  return (COMPATIBLE_WITH[declared] ?? []).includes(detectedExtension);
}
