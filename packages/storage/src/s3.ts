import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { assertValidKey, ObjectMissing, type StorageDriver } from './driver.js';

/**
 * Any S3-compatible endpoint: AWS, Cloudflare R2, Backblaze B2, Wasabi, SeaweedFS, an
 * existing MinIO, or Garage — which is what `docker compose --profile s3` starts.
 *
 * Path-style addressing by default, because virtual-host style needs a wildcard DNS entry
 * that nobody running this at home has. AWS itself still accepts path-style for existing
 * buckets, and every self-hostable implementation prefers it.
 */

export interface S3Options {
  bucket: string;
  region: string;
  /** Absent for real AWS; set for everything else. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Bytes per multipart part. 8 MiB keeps memory small on a modest VPS. */
  partSize?: number;
}

const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

export class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly partSize: number;
  private readonly endpoint: string;

  constructor(options: S3Options) {
    const config: S3ClientConfig = {
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      forcePathStyle: options.forcePathStyle ?? true,
    };
    if (options.endpoint) config.endpoint = options.endpoint;

    this.client = new S3Client(config);
    this.bucket = options.bucket;
    this.partSize = options.partSize ?? DEFAULT_PART_SIZE;
    this.endpoint = options.endpoint ?? `s3.${options.region}.amazonaws.com`;
  }

  get location(): string {
    return `${this.endpoint}/${this.bucket}`;
  }

  async put(key: string, body: Readable): Promise<void> {
    assertValidKey(key);
    // The length is unknown — the stream is ciphertext being produced as the client
    // uploads — so this is a multipart upload by necessity, not by size.
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
      partSize: this.partSize,
      queueSize: 2,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async open(key: string): Promise<Readable> {
    assertValidKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body;
      if (!(body instanceof Readable)) {
        throw new Error('S3 returned a body that is not a Node stream');
      }
      return body;
    } catch (error) {
      if (isNotFound(error)) throw new ObjectMissing(key);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    assertValidKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    assertValidKey(key);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { size: result.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}

/** S3 says NoSuchKey; a HEAD says 404 with no body to name it. Both mean the same thing. */
function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === 'NoSuchKey' ||
    candidate?.name === 'NotFound' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
