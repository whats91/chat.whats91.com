import 'server-only';

import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@/lib/logger';

const log = new Logger('WasabiStorage');

interface WasabiConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function getWasabiConfig(): WasabiConfig {
  return {
    endpoint: process.env.WASABI_ENDPOINT || '',
    region: process.env.WASABI_REGION || '',
    accessKeyId: process.env.WASABI_ACCESS_KEY || '',
    secretAccessKey: process.env.WASABI_SECRET_KEY || '',
    bucket: process.env.WASABI_BUCKET || '',
  };
}

function hasWasabiConfig(config: WasabiConfig): boolean {
  return Boolean(
    config.endpoint &&
    config.region &&
    config.accessKeyId &&
    config.secretAccessKey &&
    config.bucket
  );
}

const globalForWasabi = globalThis as typeof globalThis & {
  __whats91WasabiClient?: S3Client;
  __whats91WasabiConfigKey?: string;
};

function createClient(config: WasabiConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getClient(): { client: S3Client; config: WasabiConfig } {
  const config = getWasabiConfig();

  if (!hasWasabiConfig(config)) {
    throw new Error('Wasabi storage is not fully configured');
  }

  const configKey = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
  });

  if (!globalForWasabi.__whats91WasabiClient || globalForWasabi.__whats91WasabiConfigKey !== configKey) {
    globalForWasabi.__whats91WasabiClient = createClient(config);
    globalForWasabi.__whats91WasabiConfigKey = configKey;
    log.info('Initialized Wasabi client', {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
    });
  }

  return {
    client: globalForWasabi.__whats91WasabiClient,
    config,
  };
}

function sanitizeFilename(filename: string | null | undefined): string {
  const base = path.basename(filename || 'media');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function isWasabiConfigured(): boolean {
  return hasWasabiConfig(getWasabiConfig());
}

export function generateWasabiPath(
  userId: string | number,
  conversationId: string | number,
  messageId: string | number,
  filename: string | null | undefined
): string {
  const timestamp = Date.now();
  const safeFilename = sanitizeFilename(filename);
  const extension = path.extname(safeFilename);
  const basename = extension ? safeFilename.slice(0, -extension.length) : safeFilename;
  const objectName = `${String(messageId)}_${timestamp}_${basename || 'media'}${extension}`;
  return `users/${String(userId)}/conversations/${String(conversationId)}/${objectName}`;
}

export async function uploadBufferToWasabi(
  buffer: Buffer,
  wasabiPath: string,
  mimeType: string | null | undefined
): Promise<{ success: true; fileSize: number; mimeType: string } | { success: false; error: string }> {
  try {
    const { client, config } = getClient();

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: wasabiPath,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
      ACL: 'private',
    }));

    return {
      success: true,
      fileSize: buffer.length,
      mimeType: mimeType || 'application/octet-stream',
    };
  } catch (error) {
    log.error('Failed to upload buffer to Wasabi', {
      error: error instanceof Error ? error.message : error,
      wasabiPath,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Wasabi upload error',
    };
  }
}

export async function wasabiObjectExists(wasabiPath: string): Promise<boolean> {
  const { client, config } = getClient();

  try {
    await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: wasabiPath,
    }));
    return true;
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (error as { name?: string })?.name;

    if (name === 'NotFound' || statusCode === 404) {
      return false;
    }

    throw error;
  }
}

export async function getWasabiSignedUrl(wasabiPath: string, expiresIn = 3600): Promise<string> {
  const { client, config } = getClient();

  return getS3SignedUrl(client, new GetObjectCommand({
    Bucket: config.bucket,
    Key: wasabiPath,
  }), { expiresIn });
}

export async function streamWasabiObject(wasabiPath: string): Promise<{
  success: true;
  body: unknown;
  contentType: string | undefined;
  contentLength: number | undefined;
} | {
  success: false;
  error: string;
}> {
  try {
    const { client, config } = getClient();
    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: wasabiPath,
    }));

    return {
      success: true,
      body: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  } catch (error) {
    log.error('Failed to stream Wasabi object', {
      error: error instanceof Error ? error.message : error,
      wasabiPath,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Wasabi stream error',
    };
  }
}

export async function deleteWasabiObject(wasabiPath: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { client, config } = getClient();

    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: wasabiPath,
    }));

    return { success: true };
  } catch (error) {
    log.error('Failed to delete Wasabi object', {
      error: error instanceof Error ? error.message : error,
      wasabiPath,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Wasabi delete error',
    };
  }
}
