import 'server-only';
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { Logger } from '@/lib/logger';

const log = new Logger('CloudApiSetupDB');
const ALGORITHM = 'aes-256-gcm';

interface CloudApiSetupRow {
  user_id: string | number | bigint;
  phone_number_id: string | number | bigint | null;
  phone_number: string | null;
  whatsapp_access_token: string | null;
  access_chats: boolean | number | null;
}

export interface CloudApiSetupRecord {
  userId: string;
  phoneNumberId: string | null;
  phoneNumber: string | null;
  whatsappAccessToken: string | null;
  accessChats: boolean;
}

function isTokenEncrypted(token: string | null): token is string {
  if (!token) {
    return false;
  }

  const parts = token.split(':');
  if (parts.length !== 3) {
    return false;
  }

  return parts.every((part) => /^[0-9a-f]+$/i.test(part));
}

function getEncryptionKey(): Buffer | null {
  const rawKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    return null;
  }

  const key = Buffer.from(rawKey, 'hex');
  if (key.length !== 32) {
    log.warn('WHATSAPP_TOKEN_ENCRYPTION_KEY has invalid length');
    return null;
  }

  return key;
}

function decryptAccessTokenIfNeeded(token: string | null): string | null {
  if (!token || !isTokenEncrypted(token)) {
    return token;
  }

  const key = getEncryptionKey();
  if (!key) {
    log.warn('Encrypted WhatsApp access token found but WHATSAPP_TOKEN_ENCRYPTION_KEY is unavailable');
    return null;
  }

  try {
    const [ivHex, authTagHex, encryptedData] = token.split(':');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    log.error('Failed to decrypt WhatsApp access token', {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

function normalizeCloudApiSetup(row: CloudApiSetupRow | undefined): CloudApiSetupRecord | null {
  if (!row) {
    return null;
  }

  return {
    userId: String(row.user_id),
    phoneNumberId: row.phone_number_id == null ? null : String(row.phone_number_id),
    phoneNumber: row.phone_number || null,
    whatsappAccessToken: decryptAccessTokenIfNeeded(row.whatsapp_access_token),
    accessChats: row.access_chats === true || row.access_chats === 1,
  };
}

export async function findCloudApiSetupByUserAndPhoneNumberId(
  userId: string,
  phoneNumberId: string
): Promise<CloudApiSetupRecord | null> {
  const rows = await db.$queryRawUnsafe<CloudApiSetupRow[]>(
    `SELECT user_id, phone_number_id, phone_number, whatsapp_access_token, access_chats
     FROM cloud_api_setup
     WHERE user_id = ? AND phone_number_id = ?
     ORDER BY (whatsapp_access_token IS NOT NULL AND whatsapp_access_token != '') DESC, access_chats DESC, id DESC
     LIMIT 1`,
    userId,
    phoneNumberId
  );

  return normalizeCloudApiSetup(rows[0]);
}

export async function findCloudApiSetupByPhoneNumberId(
  phoneNumberId: string
): Promise<CloudApiSetupRecord | null> {
  const rows = await db.$queryRawUnsafe<CloudApiSetupRow[]>(
    `SELECT user_id, phone_number_id, phone_number, whatsapp_access_token, access_chats
     FROM cloud_api_setup
     WHERE phone_number_id = ?
     ORDER BY (whatsapp_access_token IS NOT NULL AND whatsapp_access_token != '') DESC, access_chats DESC, id DESC
     LIMIT 1`,
    phoneNumberId
  );

  return normalizeCloudApiSetup(rows[0]);
}

export async function findDefaultCloudApiSetupByUser(
  userId: string
): Promise<CloudApiSetupRecord | null> {
  const rows = await db.$queryRawUnsafe<CloudApiSetupRow[]>(
    `SELECT user_id, phone_number_id, phone_number, whatsapp_access_token, access_chats
     FROM cloud_api_setup
     WHERE user_id = ? AND phone_number_id IS NOT NULL
     ORDER BY (whatsapp_access_token IS NOT NULL AND whatsapp_access_token != '') DESC, access_chats DESC, updated_at DESC, id DESC
     LIMIT 1`,
    userId
  );

  return normalizeCloudApiSetup(rows[0]);
}
