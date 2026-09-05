import { describe, expect, it } from 'vitest';
import { extensionOf, sanitizeFilename, sniffUpload, UploadRejected } from './sniff.js';

/**
 * Test fixtures — real magic bytes for each format, written out here rather than checked in
 * as binaries so the signature under test is visible in the diff.
 */
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
  Buffer.alloc(512, 0x20),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'latin1'),
  Buffer.alloc(512, 0x11),
]);
/** A genuine 1×1 PNG — the signature alone is not enough, the IHDR chunk has to be there. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256)]);
const HTML = Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>');
const CSV = Buffer.from('date,description,amount\n2026-01-04,Opening balance,1520.00\n');

describe('sanitizeFilename', () => {
  it('keeps a normal name intact', () => {
    expect(sanitizeFilename('2025 Form W-2 (final).pdf')).toBe('2025 Form W-2 (final).pdf');
  });

  it('drops any path the browser sent', () => {
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('../../../../etc/shadow')).toBe('shadow');
    expect(sanitizeFilename('C:\\Users\\Dana\\Desktop\\w2.pdf')).toBe('w2.pdf');
    expect(sanitizeFilename('a/b/c/../d.pdf')).toBe('d.pdf');
  });

  it('removes control characters and separators that break logs and zip entries', () => {
    expect(sanitizeFilename('bank\u0000statement\n2025.pdf')).toBe('bankstatement2025.pdf');
    expect(sanitizeFilename('what:is<this>?.pdf')).toBe('what-is-this--.pdf');
  });

  it('refuses to produce a hidden or trailing-dot name', () => {
    expect(sanitizeFilename('...hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeFilename('report.pdf...')).toBe('report.pdf');
    expect(sanitizeFilename('...')).toBe('');
    expect(sanitizeFilename('   ')).toBe('');
  });

  it('truncates a very long name but keeps its extension', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lowercased', () => {
    expect(extensionOf('W2.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('is empty when there is nothing to read', () => {
    expect(extensionOf('receipt')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('sniffUpload', () => {
  it('identifies documents and photos from their bytes', async () => {
    await expect(sniffUpload({ head: PDF, filename: 'w2.pdf' })).resolves.toMatchObject({
      mime: 'application/pdf',
      detectedExtension: 'pdf',
    });
    await expect(sniffUpload({ head: JPEG, filename: 'IMG_0421.jpg' })).resolves.toMatchObject({
      mime: 'image/jpeg',
    });
    await expect(sniffUpload({ head: PNG, filename: 'screenshot.png' })).resolves.toMatchObject({
      mime: 'image/png',
    });
  });

  it('accepts .jpeg for bytes detected as jpg, because those are the same format', async () => {
    await expect(sniffUpload({ head: JPEG, filename: 'photo.jpeg' })).resolves.toMatchObject({
      mime: 'image/jpeg',
    });
  });

  it('accepts an Office file whose container is a zip', async () => {
    await expect(sniffUpload({ head: ZIP, filename: 'ledger.xlsx' })).resolves.toMatchObject({
      detectedExtension: 'zip',
    });
  });

  it('rejects anything that runs in a browser, by name or by content', async () => {
    await expect(sniffUpload({ head: CSV, filename: 'invoice.html' })).rejects.toThrow(
      UploadRejected,
    );
    await expect(sniffUpload({ head: HTML, filename: 'notes.svg' })).rejects.toThrow(
      UploadRejected,
    );
    await expect(sniffUpload({ head: CSV, filename: 'run.sh' })).rejects.toThrow(UploadRejected);
  });

  it('catches a file renamed to look like something it is not', async () => {
    const error = await sniffUpload({ head: JPEG, filename: 'return.pdf' }).catch((e) => e);
    expect(error).toBeInstanceOf(UploadRejected);
    expect(error.reason).toBe('content-mismatch');
    expect(error.message).toContain('.jpg');
  });

  it('enforces the item\u2019s accepted list on the declared extension', async () => {
    await expect(
      sniffUpload({ head: PDF, filename: 'w2.pdf', accept: ['.pdf', '.jpg'] }),
    ).resolves.toMatchObject({ mime: 'application/pdf' });

    const error = await sniffUpload({
      head: PNG,
      filename: 'shot.png',
      accept: ['.pdf'],
    }).catch((e) => e);
    expect(error).toBeInstanceOf(UploadRejected);
    expect(error.reason).toBe('not-accepted');
    expect(error.message).toContain('.pdf');
  });

  it('allows formats that have no magic bytes at all, on their extension', async () => {
    await expect(sniffUpload({ head: CSV, filename: 'transactions.csv' })).resolves.toEqual({
      mime: 'text/plain',
      detectedExtension: null,
    });
    await expect(sniffUpload({ head: CSV, filename: 'export.qbo' })).resolves.toEqual({
      mime: 'text/plain',
      detectedExtension: null,
    });
  });

  it('falls back to octet-stream rather than believing the browser', async () => {
    await expect(sniffUpload({ head: Buffer.alloc(64), filename: 'mystery.dat' })).resolves.toEqual(
      {
        mime: 'application/octet-stream',
        detectedExtension: null,
      },
    );
  });

  it('rejects a file whose name sanitizes away to nothing', async () => {
    const error = await sniffUpload({ head: PDF, filename: '' }).catch((e) => e);
    expect(error).toBeInstanceOf(UploadRejected);
    expect(error.reason).toBe('empty-name');
  });
});
