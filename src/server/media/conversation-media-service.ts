import 'server-only';

import crypto from 'node:crypto';
import { Logger } from '@/lib/logger';
import { buildConversationMediaProxyUrl, MEDIA_MESSAGE_TYPES } from '@/lib/media/conversation-media';
import { queryConversationsDb, executeConversationsDb } from '@/server/db/conversations-db';
import { findCloudApiSetupByUserAndPhoneNumberId } from '@/server/db/cloud-api-setup';
import {
  deleteWasabiObject,
  generateWasabiPath,
  getWasabiSignedUrl,
  isWasabiConfigured,
  streamWasabiObject,
  uploadBufferToWasabi,
  wasabiObjectExists,
} from '@/server/storage/wasabi-storage';

const log = new Logger('ConversationMedia');

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v24.0';
const PENDING_MEDIA_UPLOAD_PREFIX = 'pending-upload-';
const MAX_CONVERSATION_UPLOAD_SIZE = 100 * 1024 * 1024;

const ALLOWED_CONVERSATION_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/aac',
  'audio/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

type JsonObject = Record<string, unknown>;

interface MediaStorageRow {
  id: number;
  user_id: string | number | bigint;
  message_id: string;
  wasabi_path: string;
  mime_type: string | null;
  file_size: number | null;
  original_filename: string | null;
}

interface ConversationRow {
  id: number;
  user_id: string | number | bigint;
  contact_phone: string;
  contact_name: string | null;
  whatsapp_phone_number_id: string;
}

interface MessageWithConversationRow {
  id: number;
  conversation_id: number;
  user_id: string | number | bigint;
  whatsapp_phone_number_id: string;
  whatsapp_message_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  media_caption: string | null;
  incoming_payload: unknown;
  outgoing_payload: unknown;
}

interface MediaDescriptor {
  mediaType: string;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  directUrl: string | null;
}

function parseJsonObject(value: unknown): JsonObject | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : null;
    } catch {
      return null;
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function firstItem<T>(value: unknown): T | null {
  return Array.isArray(value) && value.length > 0 ? (value[0] as T) : null;
}

function extractPayloadMessageNode(payload: unknown): JsonObject | null {
  const parsed = parseJsonObject(payload);
  if (!parsed) return null;

  const entry = firstItem<JsonObject>(parsed.entry);
  const change = firstItem<JsonObject>(entry?.changes);
  const changeValue = parseJsonObject(change?.value);
  const valueMessage = firstItem<JsonObject>(changeValue?.messages);
  if (valueMessage) return valueMessage;

  const nestedValue = parseJsonObject(parsed.value);
  const nestedValueMessage = firstItem<JsonObject>(nestedValue?.messages);
  if (nestedValueMessage) return nestedValueMessage;

  const directMessage = firstItem<JsonObject>(parsed.messages);
  if (directMessage) return directMessage;

  const directMessageObject = parseJsonObject(parsed.message);
  if (directMessageObject) return directMessageObject;

  return parsed;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeFilename(filename: string | null | undefined): string | null {
  const trimmed = getString(filename);
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getExtensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = getString(mimeType)?.toLowerCase();
  if (!normalized) {
    return '';
  }

  if (MIME_EXTENSION_MAP[normalized]) {
    return MIME_EXTENSION_MAP[normalized];
  }

  const subtype = normalized.split('/')[1];
  if (!subtype) {
    return '';
  }

  return subtype.replace(/^x-/, '').replace(/^jpeg$/, 'jpg');
}

function buildFallbackFilename(messageType: string, messageId: string | number, mimeType: string | null | undefined): string {
  const extension = getExtensionFromMimeType(mimeType);
  return extension ? `${messageType || 'media'}_${String(messageId)}.${extension}` : `${messageType || 'media'}_${String(messageId)}`;
}

function isExternalHttpUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

function isPendingMediaUploadToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(PENDING_MEDIA_UPLOAD_PREFIX);
}

function createPendingMediaUploadToken(): string {
  return `${PENDING_MEDIA_UPLOAD_PREFIX}${crypto.randomUUID()}`;
}

async function getConversationForUser(conversationId: number, userId: string): Promise<ConversationRow | null> {
  const [conversation] = await queryConversationsDb<ConversationRow>(
    `SELECT id, user_id, contact_phone, contact_name, whatsapp_phone_number_id
     FROM conversations
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [conversationId, userId]
  );

  return conversation || null;
}

async function getMediaStorageRecord(userId: string, messageId: string): Promise<MediaStorageRow | null> {
  const [record] = await queryConversationsDb<MediaStorageRow>(
    `SELECT id, user_id, message_id, wasabi_path, mime_type, file_size, original_filename
     FROM media_storage
     WHERE user_id = ? AND message_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId, messageId]
  );

  return record || null;
}

async function upsertMediaStorageRecord(params: {
  userId: string;
  messageId: string;
  wasabiPath: string;
  mimeType: string | null;
  fileSize: number | null;
  originalFilename: string | null;
}): Promise<MediaStorageRow> {
  const existing = await getMediaStorageRecord(params.userId, params.messageId);

  if (existing) {
    await executeConversationsDb(
      `UPDATE media_storage
       SET wasabi_path = ?, mime_type = ?, file_size = ?, original_filename = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        params.wasabiPath,
        params.mimeType,
        params.fileSize,
        params.originalFilename,
        existing.id,
      ]
    );
  } else {
    await executeConversationsDb(
      `INSERT INTO media_storage
       (user_id, message_id, wasabi_path, mime_type, file_size, original_filename, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        params.userId,
        params.messageId,
        params.wasabiPath,
        params.mimeType,
        params.fileSize,
        params.originalFilename,
      ]
    );
  }

  const record = await getMediaStorageRecord(params.userId, params.messageId);
  if (!record) {
    throw new Error('Failed to persist media storage record');
  }

  return record;
}

async function deleteMediaStorageRecordById(id: number): Promise<void> {
  await executeConversationsDb(
    `DELETE FROM media_storage WHERE id = ?`,
    [id]
  );
}

async function getMessageWithConversation(messageId: string, userId: string): Promise<MessageWithConversationRow | null> {
  const [message] = await queryConversationsDb<MessageWithConversationRow>(
    `SELECT
       cm.id,
       cm.conversation_id,
       c.user_id,
       c.whatsapp_phone_number_id,
       cm.whatsapp_message_id,
       cm.direction,
       cm.message_type,
       cm.message_content,
       cm.media_url,
       cm.media_mime_type,
       cm.media_filename,
       cm.media_caption,
       cm.incoming_payload,
       cm.outgoing_payload
     FROM conversation_messages cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.id = ? AND c.user_id = ?
     LIMIT 1`,
    [messageId, userId]
  );

  return message || null;
}

function extractMediaDescriptor(message: MessageWithConversationRow): MediaDescriptor {
  const payload = message.direction === 'inbound' ? message.incoming_payload : message.outgoing_payload;
  const payloadMessage = extractPayloadMessageNode(payload) || {};
  const declaredType = String(payloadMessage.type || message.message_type || '').toLowerCase();

  let mediaType = declaredType;
  let mediaNode: JsonObject | null = MEDIA_MESSAGE_TYPES.has(declaredType)
    ? parseJsonObject(payloadMessage[declaredType])
    : null;

  if (!mediaNode) {
    for (const candidate of MEDIA_MESSAGE_TYPES) {
      const next = parseJsonObject(payloadMessage[candidate]);
      if (next) {
        mediaType = candidate;
        mediaNode = next;
        break;
      }
    }
  }

  const fallbackFilename =
    sanitizeFilename(message.media_filename) ||
    sanitizeFilename(message.message_type === 'document' ? message.message_content : null) ||
    null;

  return {
    mediaType: mediaType || message.message_type,
    mediaId: getString(mediaNode?.id),
    mimeType: getString(mediaNode?.mime_type) || getString(message.media_mime_type),
    filename: sanitizeFilename(getString(mediaNode?.filename) || fallbackFilename),
    directUrl: getString(mediaNode?.link) || getString(mediaNode?.url) || getString(message.media_url),
  };
}

async function fetchGraphMediaUrl(userId: string, phoneNumberId: string, mediaId: string): Promise<{ success: true; url: string; token: string } | { success: false; error: string; status?: number }> {
  const setup = await findCloudApiSetupByUserAndPhoneNumberId(userId, String(phoneNumberId));

  if (!setup?.whatsappAccessToken) {
    return {
      success: false,
      error: 'WhatsApp access token not configured for this phone number',
      status: 400,
    };
  }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${setup.whatsappAccessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return {
      success: false,
      error: `Graph API returned ${response.status}`,
      status: response.status,
    };
  }

  const json = await response.json() as { url?: string };
  if (!json.url) {
    return {
      success: false,
      error: 'Graph API did not return a media URL',
      status: 404,
    };
  }

  return {
    success: true,
    url: json.url,
    token: setup.whatsappAccessToken,
  };
}

async function downloadBinary(sourceUrl: string, token?: string): Promise<{ success: true; buffer: Buffer; mimeType: string | null } | { success: false; error: string; status?: number }> {
  const response = await fetch(sourceUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });

  if (!response.ok) {
    return {
      success: false,
      error: `Source download returned ${response.status}`,
      status: response.status,
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    success: true,
    buffer: Buffer.from(arrayBuffer),
    mimeType: getString(response.headers.get('content-type')),
  };
}

async function updateMessageMediaReference(params: {
  messageId: string;
  proxyUrl: string;
  mimeType: string | null;
  filename: string | null;
}): Promise<void> {
  await executeConversationsDb(
    `UPDATE conversation_messages
     SET media_url = ?, media_mime_type = ?, media_filename = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      params.proxyUrl,
      params.mimeType,
      params.filename,
      params.messageId,
    ]
  );
}

export async function downloadAndCacheConversationMedia(params: {
  userId: string;
  messageId: string;
}): Promise<{
  success: boolean;
  status: number;
  message: string;
  record?: MediaStorageRow;
}> {
  const { userId, messageId } = params;

  if (!isWasabiConfigured()) {
    return {
      success: false,
      status: 500,
      message: 'Wasabi storage is not configured',
    };
  }

  const message = await getMessageWithConversation(messageId, userId);
  if (!message) {
    return {
      success: false,
      status: 404,
      message: 'Message not found',
    };
  }

  const existing = await getMediaStorageRecord(userId, messageId);
  if (existing) {
    return {
      success: true,
      status: 200,
      message: 'Media already cached',
      record: existing,
    };
  }

  const descriptor = extractMediaDescriptor(message);
  const filename = descriptor.filename || buildFallbackFilename(descriptor.mediaType, message.id, descriptor.mimeType);
  const wasabiPath = generateWasabiPath(userId, message.conversation_id, message.id, filename);

  if (await wasabiObjectExists(wasabiPath)) {
    const record = await upsertMediaStorageRecord({
      userId,
      messageId,
      wasabiPath,
      mimeType: descriptor.mimeType,
      fileSize: null,
      originalFilename: filename,
    });

    await updateMessageMediaReference({
      messageId,
      proxyUrl: buildConversationMediaProxyUrl(message.id),
      mimeType: descriptor.mimeType,
      filename,
    });

    return {
      success: true,
      status: 200,
      message: 'Media already available in Wasabi',
      record,
    };
  }

  let sourceUrl: string | null = null;
  let sourceToken: string | undefined;

  if (descriptor.mediaId) {
    const graphResult = await fetchGraphMediaUrl(userId, message.whatsapp_phone_number_id, descriptor.mediaId);
    if (!graphResult.success) {
      return {
        success: false,
        status: graphResult.status || 500,
        message: graphResult.error,
      };
    }

    sourceUrl = graphResult.url;
    sourceToken = graphResult.token;
  } else if (isExternalHttpUrl(descriptor.directUrl) && !descriptor.directUrl.includes('/api/conversations/media/')) {
    sourceUrl = descriptor.directUrl;
  }

  if (!sourceUrl) {
    return {
      success: false,
      status: 404,
      message: 'Media source could not be resolved',
    };
  }

  const downloadResult = await downloadBinary(sourceUrl, sourceToken);
  if (!downloadResult.success) {
    return {
      success: false,
      status: downloadResult.status || 500,
      message: downloadResult.error,
    };
  }

  const resolvedMimeType = descriptor.mimeType || downloadResult.mimeType || 'application/octet-stream';
  const uploadResult = await uploadBufferToWasabi(downloadResult.buffer, wasabiPath, resolvedMimeType);
  if (!uploadResult.success) {
    return {
      success: false,
      status: 500,
      message: uploadResult.error,
    };
  }

  const record = await upsertMediaStorageRecord({
    userId,
    messageId,
    wasabiPath,
    mimeType: uploadResult.mimeType,
    fileSize: uploadResult.fileSize,
    originalFilename: filename,
  });

  await updateMessageMediaReference({
    messageId,
    proxyUrl: buildConversationMediaProxyUrl(message.id),
    mimeType: uploadResult.mimeType,
    filename,
  });

  return {
    success: true,
    status: 200,
    message: 'Media downloaded and cached successfully',
    record,
  };
}

export async function streamConversationMedia(params: {
  userId: string;
  messageId: string;
}): Promise<{
  success: true;
  stream: unknown;
  mimeType: string | null;
  filename: string | null;
  contentLength: number | undefined;
} | {
  success: false;
  status: number;
  message: string;
  needsDownload?: boolean;
}> {
  const { userId, messageId } = params;

  let record = await getMediaStorageRecord(userId, messageId);
  if (!record) {
    const cacheResult = await downloadAndCacheConversationMedia({ userId, messageId });
    if (!cacheResult.success || !cacheResult.record) {
      return {
        success: false,
        status: cacheResult.status,
        message: cacheResult.message,
        needsDownload: cacheResult.status === 404,
      };
    }

    record = cacheResult.record;
  }

  const streamResult = await streamWasabiObject(record.wasabi_path);
  if (!streamResult.success) {
    return {
      success: false,
      status: 500,
      message: streamResult.error,
    };
  }

  return {
    success: true,
    stream: streamResult.body,
    mimeType: record.mime_type,
    filename: record.original_filename,
    contentLength: streamResult.contentLength,
  };
}

export async function uploadConversationMedia(params: {
  userId: string;
  conversationId: number;
  fileBuffer: Buffer;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
}): Promise<{
  success: boolean;
  status: number;
  message: string;
  data?: Array<{
    uploadToken: string;
    proxyUrl: string;
    mimeType: string;
    fileSize: number;
    originalFilename: string;
  }>;
}> {
  const { userId, conversationId, fileBuffer, mimeType, originalFilename, fileSize } = params;

  if (!isWasabiConfigured()) {
    return {
      success: false,
      status: 500,
      message: 'Wasabi storage is not configured',
    };
  }

  if (!ALLOWED_CONVERSATION_UPLOAD_MIME_TYPES.has(mimeType)) {
    return {
      success: false,
      status: 400,
      message: 'Invalid file type. Only chat-supported media files are allowed.',
    };
  }

  if (fileSize > MAX_CONVERSATION_UPLOAD_SIZE) {
    return {
      success: false,
      status: 400,
      message: 'Uploaded file exceeds the maximum allowed size.',
    };
  }

  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation) {
    return {
      success: false,
      status: 404,
      message: 'Conversation not found',
    };
  }

  const uploadToken = createPendingMediaUploadToken();
  const safeFilename = sanitizeFilename(originalFilename) || buildFallbackFilename('media', uploadToken, mimeType);
  const wasabiPath = generateWasabiPath(userId, conversationId, uploadToken, safeFilename);
  const uploadResult = await uploadBufferToWasabi(fileBuffer, wasabiPath, mimeType);

  if (!uploadResult.success) {
    return {
      success: false,
      status: 500,
      message: uploadResult.error,
    };
  }

  await upsertMediaStorageRecord({
    userId,
    messageId: uploadToken,
    wasabiPath,
    mimeType: uploadResult.mimeType,
    fileSize: uploadResult.fileSize,
    originalFilename: safeFilename,
  });

  return {
    success: true,
    status: 201,
    message: 'Media uploaded to Wasabi successfully',
    data: [{
      uploadToken,
      proxyUrl: buildConversationMediaProxyUrl(uploadToken),
      mimeType: uploadResult.mimeType,
      fileSize: uploadResult.fileSize,
      originalFilename: safeFilename,
    }],
  };
}

export async function resolvePendingConversationMediaUpload(params: {
  userId: string;
  uploadToken: string;
}): Promise<{
  success: boolean;
  status: number;
  message: string;
  signedUrl?: string;
  mimeType?: string | null;
  originalFilename?: string | null;
}> {
  const { userId, uploadToken } = params;

  if (!isWasabiConfigured()) {
    return {
      success: false,
      status: 500,
      message: 'Wasabi storage is not configured',
    };
  }

  const record = await getMediaStorageRecord(userId, uploadToken);
  if (!record || !isPendingMediaUploadToken(record.message_id)) {
    return {
      success: false,
      status: 404,
      message: 'Uploaded media was not found. Please upload the file again.',
    };
  }

  const signedUrl = await getWasabiSignedUrl(record.wasabi_path, 3600);

  return {
    success: true,
    status: 200,
    message: 'Pending media upload resolved',
    signedUrl,
    mimeType: record.mime_type,
    originalFilename: record.original_filename,
  };
}

export async function finalizePendingConversationMediaUpload(params: {
  userId: string;
  uploadToken: string;
  finalMessageId: string;
}): Promise<void> {
  await executeConversationsDb(
    `UPDATE media_storage
     SET message_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND message_id = ?`,
    [params.finalMessageId, params.userId, params.uploadToken]
  );
}

export async function cleanupPendingConversationMediaUpload(params: {
  userId: string;
  uploadToken: string;
}): Promise<void> {
  const record = await getMediaStorageRecord(params.userId, params.uploadToken);
  if (!record || !isPendingMediaUploadToken(record.message_id)) {
    return;
  }

  const deleteResult = await deleteWasabiObject(record.wasabi_path);
  if (!deleteResult.success) {
    log.warn('Failed to delete orphaned Wasabi object', {
      error: deleteResult.error,
      wasabiPath: record.wasabi_path,
      userId: params.userId,
    });
  }

  await deleteMediaStorageRecordById(record.id);
}
