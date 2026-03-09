/**
 * Conversation Controller
 * 
 * Main HTTP controller for the chat module.
 * Handles all conversation and message operations.
 * 
 * Routes:
 * - GET  /api/conversations - Get conversation list
 * - GET  /api/conversations/:id - Get conversation with messages
 * - POST /api/conversations/:id/messages - Send a message
 * - POST /api/conversations/:id/read - Mark as read
 * - PATCH /api/conversations/:id/archive - Toggle archive
 * - PATCH /api/conversations/:id/pin - Toggle pin
 * - DELETE /api/conversations/:id - Delete conversation
 */

import 'server-only';
import type { 
  ChatLabel,
  ConversationListItem,
  Message,
  MessageDirection,
  MessageStatus,
  MessageType,
  SendMessageRequest,
  WhatsAppMessagePayload,
} from '@/lib/types/chat';
import { 
  sendMessageToMeta, 
  normalizeConversationPhone, 
  mapConversationMessageStatus 
} from '../whatsapp/message-sender';
import { uploadMediaToMeta } from '../whatsapp/media-upload';
import { publishNewMessage, publishStatusUpdate } from '../pubsub/pubsub-service';
import { findCloudApiSetupByUserAndPhoneNumberId, findDefaultCloudApiSetupByUser } from '../db/cloud-api-setup';
import { getChatLabelsByIds, getChatLabelsByUser, getChatLabelsByUserAndPhoneNumber } from '../db/chat-labels';
import { executeConversationsDb, queryConversationsDb } from '../db/conversations-db';
import { buildConversationMediaProxyUrl, MEDIA_MESSAGE_TYPES } from '@/lib/media/conversation-media';
import { db } from '@/lib/db';
import {
  cleanupPendingConversationMediaUpload,
  resolveForwardableConversationMedia,
  finalizePendingConversationMediaUpload,
  resolvePendingConversationMediaUpload,
  uploadConversationMedia,
} from '@/server/media/conversation-media-service';
import { Logger } from '@/lib/logger';
import { prepareVoiceNoteAudio, type VoiceNoteRecordingMode } from '@/server/media/voice-note-audio';
import { buildExcelWorkbookBuffer } from '@/server/export/chat-excel';

const log = new Logger('ConversationCtrl');
const SERVICE_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;
const exportTimestampFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Format relative time
 */
function formatTimeAgo(date: Date | null): string {
  if (!date) return '';
  
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return new Date(date).toLocaleDateString();
}

/**
 * Get display name for a conversation
 */
function getDisplayName(contactName: string | null, contactPhone: string): string {
  if (contactName) return contactName;
  return `+${contactPhone}`;
}

/**
 * Get preview text for a message based on type
 */
function getPreviewText(messageType: string, content: string | null): string {
  if (content) return content;
  
  const previews: Record<string, string> = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎵 Audio',
    document: '📄 Document',
    location: '📍 Location',
    contacts: '👤 Contact',
    sticker: '😀 Sticker',
    interactive: '💬 Interactive',
    template: '📝 Template',
  };
  
  return previews[messageType] || 'Message';
}

function toSafeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isObject(value) ? value : null;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseHistoryTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochMilliseconds = value > 1e12 ? value : value * 1000;
    const parsed = new Date(epochMilliseconds);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      if (Number.isFinite(numericValue)) {
        const epochMilliseconds = trimmed.length >= 13 ? numericValue : numericValue * 1000;
        const parsed = new Date(epochMilliseconds);
        if (Number.isFinite(parsed.getTime())) {
          return parsed;
        }
      }
    }

    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

type LatestMessageHistoryStatus = {
  status: MessageStatus;
  rawStatus: string;
  errorMessage: string | null;
  timestamp: Date | null;
  historyId: number;
};

function getMessageStatusProgressRank(status: MessageStatus): number {
  switch (status) {
    case 'read':
      return 4;
    case 'delivered':
      return 3;
    case 'failed':
      return 2;
    case 'sent':
      return 1;
    case 'pending':
    default:
      return 0;
  }
}

function shouldApplyMessageStatusUpdate(
  currentStatus: MessageStatus,
  nextStatus: MessageStatus
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  return getMessageStatusProgressRank(nextStatus) >= getMessageStatusProgressRank(currentStatus);
}

function shouldPreferHistoryStatus(
  currentStatus: LatestMessageHistoryStatus,
  nextStatus: LatestMessageHistoryStatus
): boolean {
  const currentRank = getMessageStatusProgressRank(currentStatus.status);
  const nextRank = getMessageStatusProgressRank(nextStatus.status);

  if (nextRank !== currentRank) {
    return nextRank > currentRank;
  }

  const currentTimestamp = currentStatus.timestamp?.getTime() ?? 0;
  const nextTimestamp = nextStatus.timestamp?.getTime() ?? 0;

  if (nextTimestamp !== currentTimestamp) {
    return nextTimestamp > currentTimestamp;
  }

  return nextStatus.historyId > currentStatus.historyId;
}

function extractLatestMessageHistoryStatus(
  payload: unknown,
  historyId: number
): LatestMessageHistoryStatus | null {
  const parsedPayload = parseJsonObject(payload);
  if (!parsedPayload) {
    return null;
  }

  const rawStatus = getStringValue(parsedPayload.status);
  if (!rawStatus) {
    return null;
  }

  const errors = Array.isArray(parsedPayload.errors) ? parsedPayload.errors : [];
  const firstError = errors.find((entry) => isObject(entry));
  const errorMessage = getStringValue(firstError?.message) || null;

  return {
    status: mapConversationMessageStatus(rawStatus),
    rawStatus,
    errorMessage,
    timestamp: parseHistoryTimestamp(parsedPayload.timestamp),
    historyId,
  };
}

async function storeConversationMessageHistory(
  whatsappMessageId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await executeConversationsDb(
    `INSERT INTO conversation_message_history
     (whatsapp_message_id, payload, created_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [whatsappMessageId, JSON.stringify(payload)]
  );
}

async function getLatestMessageHistoryStatusMap(
  whatsappMessageIds: string[]
): Promise<Map<string, LatestMessageHistoryStatus>> {
  const normalizedMessageIds = Array.from(
    new Set(
      whatsappMessageIds
        .map((messageId) => messageId?.trim())
        .filter((messageId): messageId is string => Boolean(messageId))
    )
  );

  if (normalizedMessageIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedMessageIds.map(() => '?').join(', ');
  const historyRows = await queryConversationsDb<{
    id: number;
    whatsapp_message_id: string;
    payload: unknown;
  }>(
    `SELECT cmh.id, cmh.whatsapp_message_id, cmh.payload
     FROM conversation_message_history cmh
     WHERE cmh.whatsapp_message_id IN (${placeholders})
     ORDER BY cmh.id ASC`,
    normalizedMessageIds
  );

  const statusMap = new Map<string, LatestMessageHistoryStatus>();

  for (const row of historyRows) {
    const latestStatus = extractLatestMessageHistoryStatus(row.payload, row.id);
    if (!latestStatus) {
      continue;
    }

    const currentStatus = statusMap.get(row.whatsapp_message_id);
    if (!currentStatus || shouldPreferHistoryStatus(currentStatus, latestStatus)) {
      statusMap.set(row.whatsapp_message_id, latestStatus);
    }
  }

  return statusMap;
}

async function applyMessageHistoryStatuses(messages: Message[]): Promise<Message[]> {
  const statusMap = await getLatestMessageHistoryStatusMap(
    messages.map((message) => message.whatsappMessageId)
  );

  if (statusMap.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const latestStatus = statusMap.get(message.whatsappMessageId);
    if (!latestStatus) {
      return message;
    }

    const isRead = latestStatus.status === 'read' ? true : message.isRead;
    const readAt =
      latestStatus.status === 'read'
        ? latestStatus.timestamp || message.readAt || null
        : message.readAt || null;

    return {
      ...message,
      status: latestStatus.status,
      errorMessage: latestStatus.errorMessage || message.errorMessage,
      isRead,
      readAt,
      metadata: {
        ...(message.metadata || {}),
        statusTimestamp: latestStatus.timestamp
          ? latestStatus.timestamp.toISOString()
          : message.metadata?.statusTimestamp,
      },
    };
  });
}

type ConversationLabelLinkRow = {
  conversation_id: number | string | bigint;
  label_id: number | string | bigint;
};

function normalizeIdentifier(value: string | number | bigint | null | undefined): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
}

async function getConversationAssignedLabelMap(
  userId: string,
  conversationIds: number[]
): Promise<Map<string, ChatLabel[]>> {
  const normalizedConversationIds = Array.from(new Set(conversationIds.filter((id) => Number.isFinite(id))));
  if (normalizedConversationIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedConversationIds.map(() => '?').join(', ');
  const links = await queryConversationsDb<ConversationLabelLinkRow>(
    `SELECT conversation_id, label_id
     FROM conversation_labels
     WHERE conversation_id IN (${placeholders})`,
    normalizedConversationIds
  );

  if (links.length === 0) {
    return new Map();
  }

  const labelIds = Array.from(
    new Set(
      links
        .map((link) => normalizeIdentifier(link.label_id))
        .filter(Boolean)
    )
  );

  const labels = await getChatLabelsByIds(userId, labelIds);
  const labelMap = new Map(labels.map((label) => [label.id, label]));
  const assignedLabels = new Map<string, ChatLabel[]>();

  for (const link of links) {
    const conversationKey = normalizeIdentifier(link.conversation_id);
    const labelKey = normalizeIdentifier(link.label_id);
    const label = labelMap.get(labelKey);

    if (!conversationKey || !label) {
      continue;
    }

    const existing = assignedLabels.get(conversationKey) || [];
    existing.push(label);
    assignedLabels.set(conversationKey, existing);
  }

  for (const [conversationKey, conversationLabels] of assignedLabels.entries()) {
    const uniqueLabels = Array.from(new Map(conversationLabels.map((label) => [label.id, label])).values());
    assignedLabels.set(
      conversationKey,
      uniqueLabels.sort((left, right) => left.name.localeCompare(right.name))
    );
  }

  return assignedLabels;
}

async function resolveConversationPhoneNumberForLabels(
  conversation: {
    phone_number?: string | null;
    whatsapp_phone_number_id?: string | null;
  },
  userId: string
): Promise<string | null> {
  const directPhoneNumber = getStringValue(conversation.phone_number);
  if (directPhoneNumber) {
    return directPhoneNumber;
  }

  const phoneNumberId = getStringValue(conversation.whatsapp_phone_number_id);
  if (!phoneNumberId) {
    return null;
  }

  const setup = await findCloudApiSetupByUserAndPhoneNumberId(userId, phoneNumberId);
  return setup?.phoneNumber || null;
}

function isMediaMessageType(value: string | null | undefined): boolean {
  return Boolean(value && MEDIA_MESSAGE_TYPES.has(value));
}

function isConversationBlocked(value: unknown): boolean {
  return Boolean(value);
}

interface ResolvedConversationSendContext {
  conversation: any;
  resolvedPhoneNumberId: string;
  resolvedPhoneNumber: string | null;
  accessToken: string;
  serviceWindow: ConversationServiceWindowState;
}

interface ConversationServiceWindowState {
  isOpen: boolean;
  lastInboundMessageAt: Date | null;
  expiresAt: Date | null;
}

async function resolveConversationSendContext(
  conversationId: number,
  userId: string,
  options: {
    requireOpenServiceWindow?: boolean;
  } = {}
): Promise<
  | { success: true; data: ResolvedConversationSendContext }
  | { success: false; message: string }
> {
  const { requireOpenServiceWindow = true } = options;
  const [conversation] = await queryConversationsDb<any>(
    `SELECT * FROM conversations WHERE id = ? AND user_id = ?`,
    [conversationId, userId]
  );

  if (!conversation) {
    return {
      success: false,
      message: 'Conversation not found',
    };
  }

  if (isConversationBlocked(conversation.is_blocked)) {
    return {
      success: false,
      message: 'This contact is blocked. Unblock the contact to send messages.',
    };
  }

  const serviceWindow = await getConversationServiceWindowState(conversationId, userId);
  if (requireOpenServiceWindow && !serviceWindow.isOpen) {
    return {
      success: false,
      message: 'Service window is inactive for this chat. Wait for a new inbound message before sending.',
    };
  }

  let resolvedPhoneNumberId = conversation.whatsapp_phone_number_id
    ? String(conversation.whatsapp_phone_number_id)
    : null;
  let resolvedPhoneNumber = conversation.phone_number ? String(conversation.phone_number) : null;
  let cloudSetup = resolvedPhoneNumberId
    ? await findCloudApiSetupByUserAndPhoneNumberId(userId, resolvedPhoneNumberId)
    : null;

  const envAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || null;
  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;

  if (!cloudSetup?.whatsappAccessToken) {
    const fallbackSetup = await findDefaultCloudApiSetupByUser(userId);

    if (fallbackSetup?.phoneNumberId && fallbackSetup.whatsappAccessToken) {
      cloudSetup = fallbackSetup;
      resolvedPhoneNumberId = fallbackSetup.phoneNumberId;
    }
  }

  if (cloudSetup?.phoneNumber) {
    resolvedPhoneNumber = cloudSetup.phoneNumber;
  }

  const accessToken = cloudSetup?.whatsappAccessToken || envAccessToken;
  if (!resolvedPhoneNumberId && envPhoneNumberId) {
    resolvedPhoneNumberId = envPhoneNumberId;
  }

  const conversationUpdates: string[] = [];
  const conversationUpdateParams: unknown[] = [];

  if (resolvedPhoneNumberId && String(conversation.whatsapp_phone_number_id || '') !== resolvedPhoneNumberId) {
    conversationUpdates.push('whatsapp_phone_number_id = ?');
    conversationUpdateParams.push(resolvedPhoneNumberId);
    conversation.whatsapp_phone_number_id = resolvedPhoneNumberId;
  }

  if (resolvedPhoneNumber && String(conversation.phone_number || '') !== resolvedPhoneNumber) {
    conversationUpdates.push('phone_number = ?');
    conversationUpdateParams.push(resolvedPhoneNumber);
    conversation.phone_number = resolvedPhoneNumber;
  }

  if (conversationUpdates.length > 0) {
    await executeConversationsDb(
      `UPDATE conversations
       SET ${conversationUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [...conversationUpdateParams, conversationId, userId]
    );
  }

  if (!accessToken || !resolvedPhoneNumberId) {
    return {
      success: false,
      message: 'WhatsApp configuration not found for this phone number',
    };
  }

  return {
    success: true,
    data: {
      conversation,
      resolvedPhoneNumberId,
      resolvedPhoneNumber,
      accessToken,
      serviceWindow,
    },
  };
}

async function getConversationServiceWindowState(
  conversationId: number,
  userId: string
): Promise<ConversationServiceWindowState> {
  const [lastInboundMessage] = await queryConversationsDb<{
    lastInboundMessageAt: Date | string | null;
  }>(
    `SELECT COALESCE(cm.created_at, cm.timestamp) AS lastInboundMessageAt
     FROM conversation_messages cm
     INNER JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.conversation_id = ? AND c.user_id = ? AND cm.direction = 'inbound'
     ORDER BY COALESCE(cm.created_at, cm.timestamp) DESC, cm.id DESC
     LIMIT 1`,
    [conversationId, userId]
  );

  const lastInboundMessageAt = lastInboundMessage?.lastInboundMessageAt
    ? new Date(lastInboundMessage.lastInboundMessageAt)
    : null;
  const expiresAt = lastInboundMessageAt
    ? new Date(lastInboundMessageAt.getTime() + SERVICE_WINDOW_DURATION_MS)
    : null;
  const isOpen = Boolean(expiresAt && expiresAt.getTime() > Date.now());

  return {
    isOpen,
    lastInboundMessageAt,
    expiresAt,
  };
}

function mapConversationMessageRowToMessage(msg: any): Message {
  return {
    id: String(msg.id),
    conversationId: String(msg.conversation_id),
    whatsappMessageId: msg.whatsapp_message_id,
    senderId: msg.direction === 'inbound' ? msg.from_phone : msg.to_phone,
    fromPhone: msg.from_phone,
    toPhone: msg.to_phone,
    direction: msg.direction,
    type: msg.message_type,
    content: msg.message_content,
    status: msg.status,
    timestamp: msg.timestamp,
    replyTo: msg.replied_to_message_id,
    mediaUrl: msg.media_url,
    mediaMimeType: msg.media_mime_type,
    mediaFilename: msg.media_filename,
    mediaCaption: msg.media_caption,
    interactiveData: msg.interactive_data,
    locationData: msg.location_data,
    contactData: msg.contact_data,
    incomingPayload: msg.incoming_payload,
    outgoingPayload: msg.outgoing_payload,
    webhookData: msg.webhook_data,
    errorMessage: msg.error_message,
    isRead: msg.is_read || false,
    isPinned: msg.is_pinned || false,
    isStarred: msg.is_starred || false,
    readAt: msg.read_at,
  };
}

function formatExportDateTime(value: Date | string | null | undefined): string {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return exportTimestampFormatter.format(date);
}

function formatExportBoolean(value: unknown): string {
  return value ? 'Yes' : 'No';
}

function sanitizeExportFileSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'chat';
}

function stringifyStructuredExportValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildExportTimestampSlug(referenceDate = new Date()): string {
  return referenceDate
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:T]/g, '-')
    .replace(/Z$/, '')
    .slice(0, 19);
}

// ========================================
// CONVERSATION LIST
// ========================================

export interface GetConversationsParams {
  userId: string;
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  archived?: boolean;
  unreadOnly?: boolean;
  labelId?: string;
}

export async function getConversations({
  userId,
  page = 1,
  limit = 20,
  search,
  status = 'active',
  archived = false,
  unreadOnly = false,
  labelId,
}: GetConversationsParams) {
  try {
    const offset = (page - 1) * limit;
    
    // Build the SQL query
    let sql = `
      SELECT 
        c.id, c.contact_phone, c.contact_name, c.whatsapp_phone_number_id,
        c.last_message_id, c.last_message_content, c.last_message_type,
        c.last_message_at, c.last_message_direction, c.unread_count,
        c.total_messages, c.is_archived, c.is_pinned, c.is_muted, c.is_blocked, c.status,
        c.created_at, c.updated_at
      FROM conversations c
      WHERE c.user_id = ?
    `;
    
    const params: unknown[] = [userId];
    
    // Add filters
    if (search) {
      sql += ` AND (c.contact_name LIKE ? OR c.contact_phone LIKE ? OR c.last_message_content LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    if (status !== 'all') {
      sql += ` AND c.status = ?`;
      params.push(status);
    }
    
    if (archived) {
      sql += ` AND c.is_archived = true`;
    } else {
      sql += ` AND c.is_archived = false`;
    }
    
    if (unreadOnly) {
      sql += ` AND c.unread_count > 0`;
    }

    if (labelId) {
      sql += `
        AND EXISTS (
          SELECT 1
          FROM conversation_labels cl
          WHERE cl.conversation_id = c.id
            AND cl.label_id = ?
        )
      `;
      params.push(labelId);
    }
    
    // Add ordering and pagination
    sql += ` ORDER BY c.is_pinned DESC, COALESCE(c.last_message_at, c.updated_at) DESC, c.id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    // Execute query
    const conversations = await queryConversationsDb<any>(sql, params);
    const labelsByConversation = await getConversationAssignedLabelMap(
      userId,
      conversations.map((conversation) => toSafeNumber(conversation.id))
    );
    
    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM conversations c WHERE c.user_id = ?`;
    const countParams: unknown[] = [userId];
    
    if (search) {
      countSql += ` AND (c.contact_name LIKE ? OR c.contact_phone LIKE ? OR c.last_message_content LIKE ?)`;
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
    }
    
    if (status !== 'all') {
      countSql += ` AND c.status = ?`;
      countParams.push(status);
    }
    
    if (archived) {
      countSql += ` AND c.is_archived = true`;
    } else {
      countSql += ` AND c.is_archived = false`;
    }
    
    if (unreadOnly) {
      countSql += ` AND c.unread_count > 0`;
    }

    if (labelId) {
      countSql += `
        AND EXISTS (
          SELECT 1
          FROM conversation_labels cl
          WHERE cl.conversation_id = c.id
            AND cl.label_id = ?
        )
      `;
      countParams.push(labelId);
    }

    const [countResult] = await queryConversationsDb<any>(countSql, countParams);
    const totalItems = toSafeNumber(countResult?.total);
    
    // Format response
    const formattedConversations: ConversationListItem[] = conversations.map(conv => ({
      id: conv.id,
      contactPhone: conv.contact_phone,
      contactName: conv.contact_name,
      displayName: getDisplayName(conv.contact_name, conv.contact_phone),
      lastMessageContent: conv.last_message_content 
        ? getPreviewText(conv.last_message_type, conv.last_message_content)
        : null,
      lastMessageType: conv.last_message_type,
      lastMessageDirection: conv.last_message_direction,
      lastMessageAt: conv.last_message_at,
      updatedAt: conv.updated_at,
      lastMessageTimeAgo: formatTimeAgo(conv.last_message_at),
      unreadCount: toSafeNumber(conv.unread_count),
      isPinned: conv.is_pinned || false,
      isArchived: conv.is_archived || false,
      isMuted: conv.is_muted || false,
      isBlocked: conv.is_blocked || false,
      status: conv.status,
      labels: labelsByConversation.get(String(conv.id)) || [],
    }));
    
    // Get unread count summary
    const [unreadResult] = await queryConversationsDb<any>(
      `SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND unread_count > 0 AND is_archived = false`,
      [userId]
    );
    
    return {
      success: true,
      message: 'Conversations retrieved successfully',
      data: {
        conversations: formattedConversations,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalItems / limit),
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page * limit < totalItems,
          hasPrevPage: page > 1,
        },
        summary: {
          totalConversations: totalItems,
          unreadConversations: toSafeNumber(unreadResult?.count),
        },
      },
    };
  } catch (error) {
    log.error('getConversations error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve conversations',
      data: { conversations: [], pagination: {}, summary: {} },
    };
  }
}

export interface ConversationTargetItem {
  id: string;
  source: 'conversation' | 'contact';
  conversationId: string | null;
  phone: string;
  displayName: string;
  contactName: string | null;
  lastMessageAt: Date | null;
  isServiceWindowOpen?: boolean;
}

interface ConversationTargetRow {
  id: number;
  contact_phone: string;
  contact_name: string | null;
  last_message_at: Date | null;
  updated_at: Date | null;
}

interface ContactTargetRow {
  id: number;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  updated_at: Date | null;
}

function normalizeTargetName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(' ').trim() : null;
}

export async function getConversationTargets({
  userId,
  search,
  limit = 50,
  serviceWindowOnly = false,
}: {
  userId: string;
  search?: string;
  limit?: number;
  serviceWindowOnly?: boolean;
}) {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const trimmedSearch = search?.trim();
    const serviceWindowThreshold = new Date(Date.now() - SERVICE_WINDOW_DURATION_MS);

    let conversationsSql = `
      SELECT id, contact_phone, contact_name, last_message_at, updated_at
      FROM conversations
      WHERE user_id = ? AND is_archived = false
    `;
    const conversationParams: unknown[] = [userId];

    if (serviceWindowOnly) {
      conversationsSql += `
        AND EXISTS (
          SELECT 1
          FROM conversation_messages cm
          WHERE cm.conversation_id = conversations.id
            AND cm.direction = 'inbound'
            AND COALESCE(cm.created_at, cm.timestamp) >= ?
        )
      `;
      conversationParams.push(serviceWindowThreshold);
    }

    if (trimmedSearch) {
      const searchPattern = `%${trimmedSearch}%`;
      conversationsSql += ` AND (contact_name LIKE ? OR contact_phone LIKE ?)`;
      conversationParams.push(searchPattern, searchPattern);
    }

    conversationsSql += ` ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT ?`;
    conversationParams.push(safeLimit);

    const conversationRows = await queryConversationsDb<ConversationTargetRow>(
      conversationsSql,
      conversationParams
    );

    let contactsSql = `
      SELECT id, phone, first_name, last_name, updated_at
      FROM contacts
      WHERE user_id = ? AND phone IS NOT NULL AND phone != ''
    `;
    const contactParams: unknown[] = [userId];

    if (trimmedSearch) {
      const searchPattern = `%${trimmedSearch}%`;
      contactsSql += ` AND (phone LIKE ? OR first_name LIKE ? OR last_name LIKE ?)`;
      contactParams.push(searchPattern, searchPattern, searchPattern);
    }

    contactsSql += ` ORDER BY updated_at DESC LIMIT ?`;
    contactParams.push(safeLimit);

    const contactRows = await db.$queryRawUnsafe<ContactTargetRow[]>(
      contactsSql,
      ...contactParams
    );

    const targetMap = new Map<string, ConversationTargetItem>();

    for (const row of conversationRows) {
      const normalizedPhone = normalizeConversationPhone(row.contact_phone);
      if (!normalizedPhone) {
        continue;
      }

      targetMap.set(normalizedPhone, {
        id: `conversation:${row.id}`,
        source: 'conversation',
        conversationId: String(row.id),
        phone: normalizedPhone,
        displayName: getDisplayName(row.contact_name, normalizedPhone),
        contactName: row.contact_name,
        lastMessageAt: row.last_message_at || row.updated_at,
        isServiceWindowOpen: serviceWindowOnly ? true : undefined,
      });
    }

    for (const row of contactRows) {
      const normalizedPhone = normalizeConversationPhone(row.phone || '');
      if (!normalizedPhone) {
        continue;
      }

      const contactName = normalizeTargetName(row.first_name, row.last_name);
      const existing = targetMap.get(normalizedPhone);

      if (existing) {
        if (!existing.contactName && contactName) {
          existing.contactName = contactName;
          existing.displayName = contactName;
        }
        continue;
      }

      targetMap.set(normalizedPhone, {
        id: `contact:${row.id}`,
        source: 'contact',
        conversationId: null,
        phone: normalizedPhone,
        displayName: getDisplayName(contactName, normalizedPhone),
        contactName,
        lastMessageAt: row.updated_at,
      });
    }

    const targets = Array.from(targetMap.values())
      .sort((left, right) => {
        if (left.conversationId && !right.conversationId) return -1;
        if (!left.conversationId && right.conversationId) return 1;

        const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
        const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }

        return left.displayName.localeCompare(right.displayName);
      })
      .slice(0, safeLimit);

    return {
      success: true,
      message: 'Conversation targets retrieved successfully',
      data: {
        targets,
      },
    };
  } catch (error) {
    log.error('getConversationTargets error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve conversation targets',
      data: null,
    };
  }
}

export async function startConversation({
  userId,
  phone,
  contactName,
}: {
  userId: string;
  phone: string;
  contactName?: string | null;
}) {
  try {
    const normalizedPhone = normalizeConversationPhone(phone);
    if (!normalizedPhone) {
      return {
        success: false,
        message: 'A valid phone number is required',
        data: null,
      };
    }

    const trimmedContactName = contactName?.trim() || null;

    let [conversation] = await queryConversationsDb<any>(
      `SELECT id, contact_phone, contact_name
       FROM conversations
       WHERE user_id = ? AND contact_phone = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, normalizedPhone]
    );

    if (conversation) {
      if (trimmedContactName && !conversation.contact_name) {
        await executeConversationsDb(
          `UPDATE conversations
           SET contact_name = ?, is_archived = false, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [trimmedContactName, conversation.id]
        );
        conversation.contact_name = trimmedContactName;
      } else {
        await executeConversationsDb(
          `UPDATE conversations
           SET is_archived = false, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [conversation.id]
        );
      }

      return {
        success: true,
        message: 'Conversation ready',
        data: {
          conversationId: String(conversation.id),
          displayName: getDisplayName(conversation.contact_name || trimmedContactName, normalizedPhone),
          contactPhone: normalizedPhone,
          contactName: conversation.contact_name || trimmedContactName,
        },
      };
    }

    const setup = await findDefaultCloudApiSetupByUser(userId);
    if (!setup?.phoneNumberId || !setup.whatsappAccessToken) {
      return {
        success: false,
        message: 'WhatsApp phone number is not configured for this user',
        data: null,
      };
    }

    await executeConversationsDb(
      `INSERT INTO conversations
       (user_id, contact_phone, contact_name, whatsapp_phone_number_id, phone_number, status, unread_count, total_messages, is_archived, is_pinned, is_muted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, 0, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, normalizedPhone, trimmedContactName, setup.phoneNumberId, setup.phoneNumber]
    );

    [conversation] = await queryConversationsDb<any>(
      `SELECT id, contact_phone, contact_name
       FROM conversations
       WHERE user_id = ? AND contact_phone = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, normalizedPhone]
    );

    if (!conversation) {
      return {
        success: false,
        message: 'Conversation could not be created',
        data: null,
      };
    }

    return {
      success: true,
      message: 'Conversation created successfully',
      data: {
        conversationId: String(conversation.id),
        displayName: getDisplayName(conversation.contact_name || trimmedContactName, normalizedPhone),
        contactPhone: normalizedPhone,
        contactName: conversation.contact_name || trimmedContactName,
      },
    };
  } catch (error) {
    log.error('startConversation error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to start conversation',
      data: null,
    };
  }
}

// ========================================
// GET CONVERSATION BY ID
// ========================================

export interface GetConversationParams {
  conversationId: number;
  userId: string;
  page?: number;
  limit?: number;
  beforeMessageId?: string;
}

export async function getConversationById({
  conversationId,
  userId,
  page = 1,
  limit = 50,
}: GetConversationParams) {
  try {
    // Get conversation
    const [conversation] = await queryConversationsDb<any>(
      `SELECT * FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
    if (!conversation) {
      return {
        success: false,
        message: 'Conversation not found',
        data: null,
      };
    }

    const serviceWindow = await getConversationServiceWindowState(conversationId, userId);
    const labelsByConversation = await getConversationAssignedLabelMap(userId, [conversationId]);
    
    // Get messages (oldest first for display)
    const offset = (page - 1) * limit;
    const messages = await queryConversationsDb<any>(
      `SELECT * FROM conversation_messages 
       WHERE conversation_id = ? 
       ORDER BY timestamp DESC, id DESC
       LIMIT ? OFFSET ?`,
      [conversationId, limit, offset]
    );
    
    // Reverse to get oldest first
    messages.reverse();
    
    // Get total message count
    const [countResult] = await queryConversationsDb<any>(
      `SELECT COUNT(*) as total FROM conversation_messages WHERE conversation_id = ?`,
      [conversationId]
    );
    
    const totalMessages = toSafeNumber(countResult?.total);
    
    // Format messages
    const formattedMessages = await applyMessageHistoryStatuses(
      messages.map(mapConversationMessageRowToMessage)
    );
    
    // Mark as read and clear unread count
    await executeConversationsDb(
      `UPDATE conversations SET unread_count = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
    return {
      success: true,
      message: 'Conversation retrieved successfully',
      data: {
        conversation: {
          id: conversation.id,
          displayName: getDisplayName(conversation.contact_name, conversation.contact_phone),
          contactPhone: conversation.contact_phone,
          contactName: conversation.contact_name,
          conversationNotes: conversation.conversation_notes || null,
          isBlocked: Boolean(conversation.is_blocked),
          isServiceWindowOpen: serviceWindow.isOpen,
          serviceWindowStartedAt: serviceWindow.lastInboundMessageAt,
          serviceWindowExpiresAt: serviceWindow.expiresAt,
          status: conversation.status,
          labels: labelsByConversation.get(String(conversationId)) || [],
        },
        messages: formattedMessages,
        pagination: {
          totalMessages,
          currentPage: page,
          messagesPerPage: limit,
          hasMore: page * limit < totalMessages,
        },
      },
    };
  } catch (error) {
    log.error('getConversationById error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve conversation',
      data: null,
    };
  }
}

export async function getPinnedMessage(conversationId: number, userId: string) {
  try {
    const [message] = await queryConversationsDb<any>(
      `SELECT cm.*
       FROM conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = ? AND c.user_id = ? AND cm.is_pinned = true
       ORDER BY cm.updated_at DESC, cm.timestamp DESC, cm.id DESC
       LIMIT 1`,
      [conversationId, userId]
    );

    return {
      success: true,
      message: 'Pinned message retrieved successfully',
      data: {
        message: message ? mapConversationMessageRowToMessage(message) : null,
      },
    };
  } catch (error) {
    log.error('getPinnedMessage error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve pinned message',
      data: null,
    };
  }
}

export async function getStarredMessages(
  conversationId: number,
  userId: string,
  limit = 100
) {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 250);
    const messages = await queryConversationsDb<any>(
      `SELECT cm.*
       FROM conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = ? AND c.user_id = ? AND cm.is_starred = true
       ORDER BY cm.timestamp DESC, cm.id DESC
       LIMIT ?`,
      [conversationId, userId, safeLimit]
    );

    return {
      success: true,
      message: 'Starred messages retrieved successfully',
      data: {
        messages: messages.map(mapConversationMessageRowToMessage),
      },
    };
  } catch (error) {
    log.error('getStarredMessages error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve starred messages',
      data: null,
    };
  }
}

export async function getConversationMediaMessages(
  conversationId: number,
  userId: string,
  limit = 250
) {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const mediaMessageTypes = Array.from(MEDIA_MESSAGE_TYPES);
    const placeholders = mediaMessageTypes.map(() => '?').join(', ');

    const messages = await queryConversationsDb<any>(
      `SELECT cm.*
       FROM conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = ? AND c.user_id = ?
         AND (
           cm.media_url IS NOT NULL
           OR cm.message_type IN (${placeholders})
           OR cm.message_content LIKE '%http://%'
           OR cm.message_content LIKE '%https://%'
         )
       ORDER BY cm.timestamp DESC, cm.id DESC
       LIMIT ?`,
      [conversationId, userId, ...mediaMessageTypes, safeLimit]
    );

    return {
      success: true,
      message: 'Conversation media retrieved successfully',
      data: {
        messages: messages.map(mapConversationMessageRowToMessage),
      },
    };
  } catch (error) {
    log.error('getConversationMediaMessages error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to retrieve conversation media',
      data: null,
    };
  }
}

// ========================================
// SEND MESSAGE
// ========================================

export interface SendMessageParams {
  conversationId: number;
  userId: string;
  messageData: SendMessageRequest;
}

export async function sendMessage({
  conversationId,
  userId,
  messageData,
}: SendMessageParams) {
  let pendingUploadToken: string | null = null;
  let acceptedWhatsappMessageId: string | null = null;

  try {
    let mediaUrlForMeta = messageData.mediaUrl || null;
    let persistedMediaUrl = messageData.mediaUrl || null;
    let resolvedMediaMimeType: string | null = null;
    let resolvedMediaFilename: string | null = null;
    const sendContext = await resolveConversationSendContext(conversationId, userId);
    if (!sendContext.success) {
      return {
        success: false,
        message: sendContext.message,
        data: null,
      };
    }

    const { conversation, resolvedPhoneNumberId, accessToken } = sendContext.data;

    if (messageData.mediaUploadToken) {
      const pendingUpload = await resolvePendingConversationMediaUpload({
        userId,
        uploadToken: messageData.mediaUploadToken,
      });

      if (!pendingUpload.success || !pendingUpload.signedUrl) {
        return {
          success: false,
          message: pendingUpload.message,
          data: null,
        };
      }

      pendingUploadToken = messageData.mediaUploadToken;
      mediaUrlForMeta = pendingUpload.signedUrl;
      persistedMediaUrl = buildConversationMediaProxyUrl(messageData.mediaUploadToken);
      resolvedMediaMimeType = pendingUpload.mimeType || null;
      resolvedMediaFilename = pendingUpload.originalFilename || null;
    } else if (messageData.forwardSourceMessageId) {
      const forwardedMedia = await resolveForwardableConversationMedia({
        userId,
        messageId: messageData.forwardSourceMessageId,
      });

      if (!forwardedMedia.success || !forwardedMedia.signedUrl) {
        return {
          success: false,
          message: forwardedMedia.message,
          data: null,
        };
      }

      mediaUrlForMeta = forwardedMedia.signedUrl;
      persistedMediaUrl = forwardedMedia.proxyUrl || null;
      resolvedMediaMimeType = forwardedMedia.mimeType || null;
      resolvedMediaFilename = forwardedMedia.originalFilename || null;
    }
    
    // Build message payload
    let messagePayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conversation.contact_phone,
      type: messageData.messageType,
    };
    
    // Add content based on message type
    switch (messageData.messageType) {
      case 'text':
        messagePayload.text = { body: messageData.messageContent };
        break;
      case 'image':
        messagePayload.image = {
          link: mediaUrlForMeta,
          caption: messageData.mediaCaption,
        };
        break;
      case 'video':
        messagePayload.video = {
          link: mediaUrlForMeta,
          caption: messageData.mediaCaption,
        };
        break;
      case 'document':
        messagePayload.document = {
          link: mediaUrlForMeta,
          caption: messageData.mediaCaption,
          filename: resolvedMediaFilename || messageData.messageContent,
        };
        break;
      case 'audio':
        messagePayload.audio = {
          link: mediaUrlForMeta,
          ...(messageData.isVoiceMessage ? { voice: true } : {}),
        };
        break;
      case 'sticker':
        messagePayload.sticker = { link: mediaUrlForMeta };
        break;
      case 'template':
        messagePayload.template = {
          name: messageData.templateName,
          language: { code: messageData.templateLanguage || 'en' },
          components: messageData.templateComponents,
        };
        break;
      default:
        return {
          success: false,
          message: `Unsupported message type: ${messageData.messageType}`,
          data: null,
        };
    }
    
    // Send to Meta
    const sendResult = await sendMessageToMeta({
      messagePayload,
      accessToken,
      phoneNumberId: resolvedPhoneNumberId,
      options: {
        userId,
        receiverId: conversation.contact_phone,
      },
    });
    
    if (!sendResult.success) {
      if (pendingUploadToken) {
        await cleanupPendingConversationMediaUpload({
          userId,
          uploadToken: pendingUploadToken,
        });
      }

      return {
        success: false,
        message: sendResult.error || 'Failed to send message',
        data: { errorCode: sendResult.errorCode },
      };
    }

    acceptedWhatsappMessageId = sendResult.messageId || null;
    
    // Create message record
    const messageTimestamp = new Date();
    await executeConversationsDb(
      `INSERT INTO conversation_messages 
       (conversation_id, whatsapp_message_id, from_phone, to_phone, direction, 
        message_type, message_content, media_url, media_mime_type, media_filename, 
        media_caption, status, timestamp, outgoing_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        conversationId,
        sendResult.messageId,
        resolvedPhoneNumberId,
        conversation.contact_phone,
        'outbound',
        messageData.messageType,
        messageData.messageContent,
        pendingUploadToken ? null : persistedMediaUrl,
        resolvedMediaMimeType,
        resolvedMediaFilename || messageData.messageContent,
        messageData.mediaCaption,
        mapConversationMessageStatus(sendResult.messageStatus || 'sent'),
        messageTimestamp,
        JSON.stringify(messagePayload),
      ]
    );
    
    // Get the inserted message
    const [newMessage] = await queryConversationsDb<any>(
      `SELECT * FROM conversation_messages WHERE whatsapp_message_id = ?`,
      [sendResult.messageId]
    );

    if (pendingUploadToken && newMessage) {
      const finalMediaUrl = buildConversationMediaProxyUrl(newMessage.id);

      await finalizePendingConversationMediaUpload({
        userId,
        uploadToken: pendingUploadToken,
        finalMessageId: String(newMessage.id),
      });

      await executeConversationsDb(
        `UPDATE conversation_messages
         SET media_url = ?, media_mime_type = ?, media_filename = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          finalMediaUrl,
          resolvedMediaMimeType,
          resolvedMediaFilename || messageData.messageContent || null,
          newMessage.id,
        ]
      );

      newMessage.media_url = finalMediaUrl;
      newMessage.media_mime_type = resolvedMediaMimeType;
      newMessage.media_filename = resolvedMediaFilename || messageData.messageContent || null;
      persistedMediaUrl = finalMediaUrl;
    }
    
    // Update conversation
    await executeConversationsDb(
      `UPDATE conversations SET 
        last_message_id = ?,
        last_message_content = ?,
        last_message_type = ?,
        last_message_at = ?,
        last_message_direction = 'outbound',
        total_messages = total_messages + 1,
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        sendResult.messageId,
        messageData.messageContent || `[${messageData.messageType}]`,
        messageData.messageType,
        messageTimestamp,
        conversationId,
      ]
    );
    
    // Publish real-time event
    await publishNewMessage(
      userId,
      {
        id: conversationId,
        contactPhone: conversation.contact_phone,
        contactName: conversation.contact_name,
      },
      {
        id: newMessage.id,
        whatsappMessageId: newMessage.whatsapp_message_id,
        direction: 'outbound',
        messageType: newMessage.message_type,
        messageContent: newMessage.message_content,
        status: newMessage.status,
        timestamp: messageTimestamp,
        mediaUrl: newMessage.media_url,
        mediaMimeType: newMessage.media_mime_type,
        mediaFilename: newMessage.media_filename,
        isPinned: Boolean(newMessage.is_pinned),
        isStarred: Boolean(newMessage.is_starred),
        outgoingPayload: messagePayload,
      }
    );
    
    return {
      success: true,
      message: 'Message sent successfully',
      data: {
        message: {
          id: String(newMessage.id),
          whatsappMessageId: sendResult.messageId,
          direction: 'outbound',
          messageType: messageData.messageType,
          messageContent: messageData.messageContent,
          mediaUrl: persistedMediaUrl,
          mediaMimeType: resolvedMediaMimeType,
          mediaFilename: resolvedMediaFilename || messageData.messageContent || null,
          mediaCaption: messageData.mediaCaption,
          status: mapConversationMessageStatus(sendResult.messageStatus || 'sent'),
        },
        whatsappMessageId: sendResult.messageId,
        conversationLogged: true,
      },
    };
  } catch (error) {
    if (messageData.mediaUploadToken && !acceptedWhatsappMessageId) {
      try {
        await cleanupPendingConversationMediaUpload({
          userId,
          uploadToken: messageData.mediaUploadToken,
        });
      } catch (cleanupError) {
        log.warn('Failed to clean up pending media upload', {
          error: cleanupError instanceof Error ? cleanupError.message : cleanupError,
          uploadToken: messageData.mediaUploadToken,
        });
      }
    }

    log.error('sendMessage error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to send message',
      data: null,
    };
  }
}

export async function sendVoiceNote(params: {
  conversationId: number;
  userId: string;
  fileBuffer: Buffer;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
  recordingMode: VoiceNoteRecordingMode;
}) {
  const { conversationId, userId, fileBuffer, mimeType, originalFilename, recordingMode } = params;

  let pendingUploadToken: string | null = null;
  let acceptedWhatsappMessageId: string | null = null;

  try {
    const sendContext = await resolveConversationSendContext(conversationId, userId);
    if (!sendContext.success) {
      return {
        success: false,
        message: sendContext.message,
        data: null,
      };
    }

    const { conversation, resolvedPhoneNumberId, accessToken } = sendContext.data;
    const preparedAudio = await prepareVoiceNoteAudio({
      fileBuffer,
      mimeType,
      originalFilename,
      recordingMode,
    });

    if (!preparedAudio.success || !preparedAudio.fileBuffer || !preparedAudio.mimeType || !preparedAudio.originalFilename) {
      return {
        success: false,
        message: preparedAudio.message,
        data: null,
      };
    }

    const uploadToWasabi = await uploadConversationMedia({
      userId,
      conversationId,
      fileBuffer: preparedAudio.fileBuffer,
      mimeType: preparedAudio.mimeType,
      originalFilename: preparedAudio.originalFilename,
      fileSize: preparedAudio.fileBuffer.length,
    });

    const uploadEntry = uploadToWasabi.data?.[0];
    if (!uploadToWasabi.success || !uploadEntry?.uploadToken) {
      return {
        success: false,
        message: uploadToWasabi.message || 'Failed to store voice note in Wasabi',
        data: null,
      };
    }

    pendingUploadToken = uploadEntry.uploadToken;

    const metaMediaUpload = await uploadMediaToMeta({
      accessToken,
      phoneNumberId: resolvedPhoneNumberId,
      fileBuffer: preparedAudio.fileBuffer,
      fileName: preparedAudio.originalFilename,
      mimeType: preparedAudio.mimeType,
    });

    if (!metaMediaUpload.success || !metaMediaUpload.mediaId) {
      if (pendingUploadToken) {
        await cleanupPendingConversationMediaUpload({
          userId,
          uploadToken: pendingUploadToken,
        });
      }

      return {
        success: false,
        message: metaMediaUpload.message,
        data: null,
      };
    }

    const messagePayload: WhatsAppMessagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conversation.contact_phone,
      type: 'audio',
      audio: {
        id: metaMediaUpload.mediaId,
        voice: true,
      },
    };

    const sendResult = await sendMessageToMeta({
      messagePayload,
      accessToken,
      phoneNumberId: resolvedPhoneNumberId,
      options: {
        userId,
        receiverId: conversation.contact_phone,
      },
    });

    if (!sendResult.success || !sendResult.messageId) {
      if (pendingUploadToken) {
        await cleanupPendingConversationMediaUpload({
          userId,
          uploadToken: pendingUploadToken,
        });
      }

      return {
        success: false,
        message: sendResult.error || 'Failed to send voice note',
        data: { errorCode: sendResult.errorCode },
      };
    }

    acceptedWhatsappMessageId = sendResult.messageId;
    const messageTimestamp = new Date();

    await executeConversationsDb(
      `INSERT INTO conversation_messages 
       (conversation_id, whatsapp_message_id, from_phone, to_phone, direction, 
        message_type, message_content, media_url, media_mime_type, media_filename, 
        media_caption, status, timestamp, outgoing_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        conversationId,
        sendResult.messageId,
        resolvedPhoneNumberId,
        conversation.contact_phone,
        'outbound',
        'audio',
        null,
        null,
        preparedAudio.mimeType,
        preparedAudio.originalFilename,
        null,
        mapConversationMessageStatus(sendResult.messageStatus || 'sent'),
        messageTimestamp,
        JSON.stringify(messagePayload),
      ]
    );

    const [newMessage] = await queryConversationsDb<any>(
      `SELECT * FROM conversation_messages WHERE whatsapp_message_id = ?`,
      [sendResult.messageId]
    );

    if (!newMessage) {
      if (pendingUploadToken) {
        await cleanupPendingConversationMediaUpload({
          userId,
          uploadToken: pendingUploadToken,
        });
      }

      return {
        success: false,
        message: 'Voice note was sent to Meta but could not be stored locally',
        data: null,
      };
    }

    let persistedMediaUrl = uploadEntry.proxyUrl;
    if (pendingUploadToken && newMessage) {
      const finalMediaUrl = buildConversationMediaProxyUrl(newMessage.id);

      await finalizePendingConversationMediaUpload({
        userId,
        uploadToken: pendingUploadToken,
        finalMessageId: String(newMessage.id),
      });

      await executeConversationsDb(
        `UPDATE conversation_messages
         SET media_url = ?, media_mime_type = ?, media_filename = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          finalMediaUrl,
          preparedAudio.mimeType,
          preparedAudio.originalFilename,
          newMessage.id,
        ]
      );

      newMessage.media_url = finalMediaUrl;
      newMessage.media_mime_type = preparedAudio.mimeType;
      newMessage.media_filename = preparedAudio.originalFilename;
      persistedMediaUrl = finalMediaUrl;
    }

    await executeConversationsDb(
      `UPDATE conversations SET 
        last_message_id = ?,
        last_message_content = ?,
        last_message_type = ?,
        last_message_at = ?,
        last_message_direction = 'outbound',
        total_messages = total_messages + 1,
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        sendResult.messageId,
        '[audio]',
        'audio',
        messageTimestamp,
        conversationId,
      ]
    );

    await publishNewMessage(
      userId,
      {
        id: conversationId,
        contactPhone: conversation.contact_phone,
        contactName: conversation.contact_name,
      },
      {
        id: newMessage.id,
        whatsappMessageId: newMessage.whatsapp_message_id,
        direction: 'outbound',
        messageType: 'audio',
        messageContent: null,
        status: newMessage.status,
        timestamp: messageTimestamp,
        mediaUrl: persistedMediaUrl,
        mediaMimeType: preparedAudio.mimeType,
        mediaFilename: preparedAudio.originalFilename,
        isPinned: Boolean(newMessage.is_pinned),
        isStarred: Boolean(newMessage.is_starred),
        outgoingPayload: messagePayload as unknown as Record<string, unknown>,
      }
    );

    return {
      success: true,
      message: 'Voice note sent successfully',
      data: {
        message: {
          id: String(newMessage.id),
          whatsappMessageId: sendResult.messageId,
          direction: 'outbound',
          messageType: 'audio',
          messageContent: null,
          mediaUrl: persistedMediaUrl,
          mediaMimeType: preparedAudio.mimeType,
          mediaFilename: preparedAudio.originalFilename,
          mediaCaption: null,
          status: mapConversationMessageStatus(sendResult.messageStatus || 'sent'),
        },
        whatsappMessageId: sendResult.messageId,
        conversationLogged: true,
      },
    };
  } catch (error) {
    log.error('sendVoiceNote error', { error: error instanceof Error ? error.message : error });

    if (pendingUploadToken && !acceptedWhatsappMessageId) {
      await cleanupPendingConversationMediaUpload({
        userId,
        uploadToken: pendingUploadToken,
      });
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send voice note',
      data: null,
    };
  }
}

// ========================================
// MARK AS READ
// ========================================

export async function markConversationAsRead(conversationId: number, userId: string) {
  try {
    // Update conversation
    await executeConversationsDb(
      `UPDATE conversations SET unread_count = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
    // Mark all inbound messages as read
    await executeConversationsDb(
      `UPDATE conversation_messages SET is_read = true, read_at = datetime('now') 
       WHERE conversation_id = ? AND direction = 'inbound' AND is_read = false`,
      [conversationId]
    );
    
    return {
      success: true,
      message: 'Conversation marked as read',
    };
  } catch (error) {
    log.error('markAsRead error', { error: error instanceof Error ? error.message : error });
    return {
      success: false,
      message: 'Failed to mark as read',
    };
  }
}

// ========================================
// TOGGLE ARCHIVE
// ========================================

export async function toggleArchiveConversation(conversationId: number, userId: string) {
  try {
    // Get current state
    const [conversation] = await queryConversationsDb<any>(
      `SELECT is_archived FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }
    
    const newArchivedState = !conversation.is_archived;
    
    await executeConversationsDb(
      `UPDATE conversations SET is_archived = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [newArchivedState, conversationId, userId]
    );
    
    return {
      success: true,
      message: newArchivedState ? 'Conversation archived' : 'Conversation unarchived',
      data: { isArchived: newArchivedState },
    };
  } catch (error) {
    log.error('toggleArchive error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to toggle archive' };
  }
}

// ========================================
// TOGGLE PIN
// ========================================

export async function togglePinConversation(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT is_pinned FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }
    
    const newPinnedState = !conversation.is_pinned;
    
    await executeConversationsDb(
      `UPDATE conversations SET is_pinned = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [newPinnedState, conversationId, userId]
    );
    
    return {
      success: true,
      message: newPinnedState ? 'Conversation pinned' : 'Conversation unpinned',
      data: { isPinned: newPinnedState },
    };
  } catch (error) {
    log.error('togglePin error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to toggle pin' };
  }
}

// ========================================
// TOGGLE MUTE
// ========================================

export async function toggleMuteConversation(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT is_muted FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }

    const newMutedState = !conversation.is_muted;

    await executeConversationsDb(
      `UPDATE conversations SET is_muted = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [newMutedState, conversationId, userId]
    );

    return {
      success: true,
      message: newMutedState ? 'Conversation muted' : 'Conversation unmuted',
      data: { isMuted: newMutedState },
    };
  } catch (error) {
    log.error('toggleMute error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to toggle mute' };
  }
}

// ========================================
// TOGGLE BLOCK
// ========================================

export async function toggleBlockConversation(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT is_blocked FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }

    const newBlockedState = !Boolean(conversation.is_blocked);

    await executeConversationsDb(
      `UPDATE conversations
       SET is_blocked = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [newBlockedState, conversationId, userId]
    );

    return {
      success: true,
      message: newBlockedState ? 'Contact blocked' : 'Contact unblocked',
      data: { isBlocked: newBlockedState },
    };
  } catch (error) {
    log.error('toggleBlock error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to update block state' };
  }
}

// ========================================
// UPDATE CONVERSATION NAME
// ========================================

export async function updateConversationName(
  conversationId: number,
  userId: string,
  contactName: string
) {
  try {
    const trimmedContactName = contactName.trim();

    if (!trimmedContactName) {
      return { success: false, message: 'Conversation name is required', data: null };
    }

    const [conversation] = await queryConversationsDb<any>(
      `SELECT id, contact_phone
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found', data: null };
    }

    await executeConversationsDb(
      `UPDATE conversations
       SET contact_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [trimmedContactName, conversationId, userId]
    );

    return {
      success: true,
      message: 'Conversation name updated',
      data: {
        conversationId: String(conversationId),
        contactName: trimmedContactName,
        displayName: getDisplayName(trimmedContactName, conversation.contact_phone),
      },
    };
  } catch (error) {
    log.error('updateConversationName error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      userId,
    });
    return { success: false, message: 'Failed to update conversation name', data: null };
  }
}

export async function updateConversationNotes(
  conversationId: number,
  userId: string,
  conversationNotes: string
) {
  try {
    const normalizedNotes = conversationNotes.trim();
    const storedNotes = normalizedNotes || null;

    const [conversation] = await queryConversationsDb<any>(
      `SELECT id
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found', data: null };
    }

    await executeConversationsDb(
      `UPDATE conversations
       SET conversation_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [storedNotes, conversationId, userId]
    );

    return {
      success: true,
      message: storedNotes ? 'Conversation notes updated' : 'Conversation notes cleared',
      data: {
        conversationId: String(conversationId),
        conversationNotes: storedNotes,
      },
    };
  } catch (error) {
    log.error('updateConversationNotes error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      userId,
    });
    return { success: false, message: 'Failed to update conversation notes', data: null };
  }
}

// ========================================
// CONVERSATION LABELS
// ========================================

export async function getUserChatLabels(userId: string) {
  try {
    const labels = await getChatLabelsByUser(userId);

    return {
      success: true,
      message: 'Chat labels retrieved successfully',
      data: {
        labels,
      },
    };
  } catch (error) {
    log.error('getUserChatLabels error', {
      error: error instanceof Error ? error.message : error,
      userId,
    });
    return { success: false, message: 'Failed to retrieve chat labels', data: null };
  }
}

export async function getConversationLabels(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT id, phone_number, whatsapp_phone_number_id
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found', data: null };
    }

    const phoneNumber = await resolveConversationPhoneNumberForLabels(conversation, userId);
    const availableLabels = phoneNumber
      ? await getChatLabelsByUserAndPhoneNumber(userId, phoneNumber)
      : [];
    const assignedLabels = (await getConversationAssignedLabelMap(userId, [conversationId])).get(String(conversationId)) || [];

    return {
      success: true,
      message: 'Conversation labels retrieved successfully',
      data: {
        conversationId: String(conversationId),
        availableLabels,
        assignedLabels,
      },
    };
  } catch (error) {
    log.error('getConversationLabels error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      userId,
    });
    return { success: false, message: 'Failed to retrieve conversation labels', data: null };
  }
}

export async function updateConversationLabels(
  conversationId: number,
  userId: string,
  labelIds: Array<string | number>
) {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT id, phone_number, whatsapp_phone_number_id
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found', data: null };
    }

    const phoneNumber = await resolveConversationPhoneNumberForLabels(conversation, userId);
    const availableLabels = phoneNumber
      ? await getChatLabelsByUserAndPhoneNumber(userId, phoneNumber)
      : [];
    const availableLabelIds = new Set(availableLabels.map((label) => label.id));
    const normalizedLabelIds = Array.from(
      new Set(labelIds.map((labelId) => normalizeIdentifier(labelId)).filter((labelId) => availableLabelIds.has(labelId)))
    );

    await executeConversationsDb(
      `DELETE FROM conversation_labels WHERE conversation_id = ?`,
      [conversationId]
    );

    if (normalizedLabelIds.length > 0) {
      const valuesSql = normalizedLabelIds.map(() => '(?, ?)').join(', ');
      const params = normalizedLabelIds.flatMap((labelId) => [conversationId, labelId]);

      await executeConversationsDb(
        `INSERT INTO conversation_labels (conversation_id, label_id)
         VALUES ${valuesSql}`,
        params
      );
    }

    const assignedLabels = availableLabels.filter((label) => normalizedLabelIds.includes(label.id));

    return {
      success: true,
      message: 'Conversation labels updated successfully',
      data: {
        conversationId: String(conversationId),
        availableLabels,
        assignedLabels,
      },
    };
  } catch (error) {
    log.error('updateConversationLabels error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      userId,
    });
    return { success: false, message: 'Failed to update conversation labels', data: null };
  }
}

// ========================================
// CLEAR CONVERSATION
// ========================================

export async function clearConversation(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<{ id: number }>(
      `SELECT id
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }

    await executeConversationsDb(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE id = ? AND user_id = ?
       )`,
      [conversationId, userId]
    );

    await executeConversationsDb(
      `UPDATE conversations
       SET last_message_id = NULL,
           last_message_content = NULL,
           last_message_type = NULL,
           last_message_at = NULL,
           last_message_direction = NULL,
           unread_count = 0,
           total_messages = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );

    return {
      success: true,
      message: 'Chat cleared',
    };
  } catch (error) {
    log.error('clearConversation error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to clear chat' };
  }
}

// ========================================
// DELETE CONVERSATION
// ========================================

export async function deleteConversation(conversationId: number, userId: string) {
  try {
    const [conversation] = await queryConversationsDb<{ id: number }>(
      `SELECT id
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }

    await executeConversationsDb(
      `DELETE FROM conversation_messages
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE id = ? AND user_id = ?
       )`,
      [conversationId, userId]
    );

    const deleteResult = await executeConversationsDb(
      `DELETE FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );

    if (deleteResult.affectedRows === 0) {
      return { success: false, message: 'Conversation not found' };
    }
    
    return {
      success: true,
      message: 'Conversation deleted',
    };
  } catch (error) {
    log.error('delete error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to delete conversation' };
  }
}

// ========================================
// PROCESS INCOMING MESSAGE (for webhooks)
// ========================================

export interface IncomingMessageData {
  userId: string;
  phoneNumberId: string;
  fromPhone: string;
  whatsappMessageId: string;
  messageType: string;
  messageContent?: string;
  mediaId?: string;
  mediaMimeType?: string;
  incomingPayload?: Record<string, unknown>;
}

export async function processIncomingMessage(data: IncomingMessageData) {
  try {
    const {
      userId,
      phoneNumberId,
      fromPhone,
      whatsappMessageId,
      messageType,
      messageContent,
      mediaMimeType,
      incomingPayload,
    } = data;
    
    // Normalize phone
    const normalizedPhone = normalizeConversationPhone(fromPhone);
    if (!normalizedPhone) {
      return { success: false, message: 'Invalid phone number' };
    }
    
    // Find or create conversation
    let [conversation] = await queryConversationsDb<any>(
      `SELECT * FROM conversations WHERE user_id = ? AND contact_phone = ? AND whatsapp_phone_number_id = ?`,
      [userId, normalizedPhone, phoneNumberId]
    );
    
    if (!conversation) {
      // Create new conversation
      await executeConversationsDb(
        `INSERT INTO conversations (user_id, contact_phone, whatsapp_phone_number_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))`,
        [userId, normalizedPhone, phoneNumberId]
      );
      
      [conversation] = await queryConversationsDb<any>(
        `SELECT * FROM conversations WHERE user_id = ? AND contact_phone = ? AND whatsapp_phone_number_id = ?`,
        [userId, normalizedPhone, phoneNumberId]
      );
    }

    if (conversation && isConversationBlocked(conversation.is_blocked)) {
      return {
        success: true,
        message: 'Blocked contact message ignored',
        conversationId: conversation.id,
      };
    }
    
    // Check if message already exists
    const [existingMessage] = await queryConversationsDb<any>(
      `SELECT id FROM conversation_messages WHERE whatsapp_message_id = ?`,
      [whatsappMessageId]
    );
    
    if (existingMessage) {
      return { success: true, message: 'Message already processed', conversationId: conversation.id };
    }
    
    // Create message
    const messageTimestamp = new Date();
    await executeConversationsDb(
      `INSERT INTO conversation_messages 
       (conversation_id, whatsapp_message_id, from_phone, to_phone, direction,
        message_type, message_content, media_mime_type, status, timestamp, incoming_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?, datetime('now'), datetime('now'))`,
      [
        conversation.id,
        whatsappMessageId,
        normalizedPhone,
        phoneNumberId,
        'inbound',
        messageType,
        messageContent,
        mediaMimeType || null,
        messageTimestamp,
        JSON.stringify(incomingPayload),
      ]
    );

    const [storedMessage] = await queryConversationsDb<any>(
      `SELECT * FROM conversation_messages WHERE whatsapp_message_id = ? LIMIT 1`,
      [whatsappMessageId]
    );

    if (!storedMessage) {
      return { success: false, message: 'Stored message could not be reloaded' };
    }

    if (isMediaMessageType(messageType)) {
      const inboundFilename = messageType === 'document' ? messageContent || null : null;

      await executeConversationsDb(
        `UPDATE conversation_messages
         SET media_url = ?, media_mime_type = ?, media_filename = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          buildConversationMediaProxyUrl(storedMessage.id),
          mediaMimeType || null,
          inboundFilename,
          storedMessage.id,
        ]
      );

      storedMessage.media_url = buildConversationMediaProxyUrl(storedMessage.id);
      storedMessage.media_mime_type = mediaMimeType || null;
      storedMessage.media_filename = inboundFilename;
    }
    
    // Update conversation
    await executeConversationsDb(
      `UPDATE conversations SET 
        last_message_id = ?,
        last_message_content = ?,
        last_message_type = ?,
        last_message_at = ?,
        last_message_direction = 'inbound',
        unread_count = unread_count + 1,
        total_messages = total_messages + 1,
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        whatsappMessageId,
        messageContent || `[${messageType}]`,
        messageType,
        messageTimestamp,
        conversation.id,
      ]
    );
    
    // Publish real-time event
    await publishNewMessage(userId, {
      id: conversation.id,
      contactPhone: normalizedPhone,
      contactName: conversation.contact_name,
    }, {
      id: storedMessage.id,
      whatsappMessageId,
      direction: 'inbound',
      messageType,
      messageContent: messageContent || null,
      status: 'delivered',
      timestamp: messageTimestamp,
      mediaUrl: storedMessage.media_url || null,
      mediaMimeType: storedMessage.media_mime_type || null,
      mediaFilename: storedMessage.media_filename || null,
      isPinned: Boolean(storedMessage.is_pinned),
      isStarred: Boolean(storedMessage.is_starred),
      incomingPayload: incomingPayload || null,
    });
    
    return { 
      success: true, 
      message: 'Message processed', 
      conversationId: conversation.id 
    };
  } catch (error) {
    log.error('processIncomingMessage error', { error: error instanceof Error ? error.message : error });
    return { success: false, message: 'Failed to process message' };
  }
}

// ========================================
// TOGGLE MESSAGE PIN / STAR
// ========================================

async function toggleMessageFlag({
  conversationId,
  messageId,
  userId,
  column,
  successOn,
  successOff,
}: {
  conversationId: number;
  messageId: number;
  userId: string;
  column: 'is_pinned' | 'is_starred';
  successOn: string;
  successOff: string;
}) {
  try {
    const [message] = await queryConversationsDb<{ currentValue: number | boolean }>(
      `SELECT cm.${column} as currentValue
       FROM conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.id = ? AND cm.conversation_id = ? AND c.user_id = ?
       LIMIT 1`,
      [messageId, conversationId, userId]
    );

    if (!message) {
      return { success: false, message: 'Message not found', data: null };
    }

    const nextValue = !Boolean(message.currentValue);

    if (column === 'is_pinned' && nextValue) {
      await executeConversationsDb(
        `UPDATE conversation_messages cm
         INNER JOIN conversations c ON c.id = cm.conversation_id
         SET cm.is_pinned = false, cm.updated_at = CURRENT_TIMESTAMP
         WHERE cm.conversation_id = ? AND c.user_id = ?`,
        [conversationId, userId]
      );
    }

    await executeConversationsDb(
      `UPDATE conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       SET cm.${column} = ?, cm.updated_at = CURRENT_TIMESTAMP
       WHERE cm.id = ? AND cm.conversation_id = ? AND c.user_id = ?`,
      [nextValue, messageId, conversationId, userId]
    );

    return {
      success: true,
      message: nextValue ? successOn : successOff,
      data: nextValue,
    };
  } catch (error) {
    log.error('toggleMessageFlag error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      messageId,
      column,
    });
    return { success: false, message: 'Failed to update message flag', data: null };
  }
}

export async function toggleMessagePinned(conversationId: number, messageId: number, userId: string) {
  const result = await toggleMessageFlag({
    conversationId,
    messageId,
    userId,
    column: 'is_pinned',
    successOn: 'Message pinned',
    successOff: 'Message unpinned',
  });

  return {
    success: result.success,
    message: result.message,
    data: result.success ? { isPinned: Boolean(result.data) } : null,
  };
}

export async function toggleMessageStarred(conversationId: number, messageId: number, userId: string) {
  const result = await toggleMessageFlag({
    conversationId,
    messageId,
    userId,
    column: 'is_starred',
    successOn: 'Message starred',
    successOff: 'Message unstarred',
  });

  return {
    success: result.success,
    message: result.message,
    data: result.success ? { isStarred: Boolean(result.data) } : null,
  };
}

// ========================================
// UPDATE MESSAGE STATUS (for webhooks)
// ========================================

export async function updateMessageStatus(
  whatsappMessageId: string,
  status: MessageStatus,
  errorCode?: string,
  errorMessage?: string,
  historyPayload?: Record<string, unknown> | null
) {
  try {
    if (historyPayload) {
      try {
        await storeConversationMessageHistory(whatsappMessageId, historyPayload);
      } catch (historyError) {
        log.error('storeConversationMessageHistory error', {
          whatsappMessageId,
          error: historyError instanceof Error ? historyError.message : historyError,
        });
      }
    }

    const [message] = await queryConversationsDb<any>(
      `SELECT cm.*, c.user_id FROM conversation_messages cm 
       JOIN conversations c ON cm.conversation_id = c.id 
       WHERE cm.whatsapp_message_id = ?`,
      [whatsappMessageId]
    );

    if (!message) {
      return { success: true };
    }

    const currentStatus = mapConversationMessageStatus(String(message.status || 'pending'));
    const shouldApply = shouldApplyMessageStatusUpdate(currentStatus, status);

    if (shouldApply) {
      await executeConversationsDb(
        `UPDATE conversation_messages SET status = ?, error_message = ?, updated_at = datetime('now') WHERE whatsapp_message_id = ?`,
        [status, errorMessage || null, whatsappMessageId]
      );
    }
    
    if (shouldApply) {
      await publishStatusUpdate(message.user_id, {
        messageId: whatsappMessageId,
        conversationId: message.conversation_id,
        status,
        errorCode,
        errorMessage,
      });
    }
    
    return { success: true };
  } catch (error) {
    log.error('updateStatus error', { error: error instanceof Error ? error.message : error });
    return { success: false };
  }
}

type ConversationExportSuccess = {
  success: true;
  message: string;
  data: {
    filename: string;
    buffer: Uint8Array;
  };
};

type ConversationExportFailure = {
  success: false;
  message: string;
  data: null;
};

type ConversationExportResult = ConversationExportSuccess | ConversationExportFailure;

function buildConversationExportRows(message: Message) {
  return [
    message.id,
    message.whatsappMessageId || '',
    message.direction,
    message.type,
    message.content || '',
    message.mediaCaption || '',
    message.mediaFilename || '',
    message.mediaMimeType || '',
    message.mediaUrl || '',
    stringifyStructuredExportValue(message.interactiveData),
    stringifyStructuredExportValue(message.locationData),
    stringifyStructuredExportValue(message.contactData),
    message.status,
    formatExportDateTime(message.timestamp),
    message.fromPhone,
    message.toPhone,
    formatExportBoolean(message.isRead),
    formatExportDateTime(message.readAt || null),
    formatExportBoolean(message.isPinned),
    formatExportBoolean(message.isStarred),
    message.errorMessage || '',
  ];
}

export async function exportConversationExcel(
  conversationId: number,
  userId: string
): Promise<ConversationExportResult> {
  try {
    const [conversation] = await queryConversationsDb<any>(
      `SELECT *
       FROM conversations
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (!conversation) {
      return { success: false, message: 'Conversation not found', data: null };
    }

    const messageRows = await queryConversationsDb<any>(
      `SELECT *
       FROM conversation_messages
       WHERE conversation_id = ?
       ORDER BY COALESCE(timestamp, created_at) ASC, id ASC`,
      [conversationId]
    );

    const messages = messageRows.map(mapConversationMessageRowToMessage);
    const displayName = getDisplayName(conversation.contact_name, conversation.contact_phone);
    const exportTimestamp = new Date();
    const workbook = buildExcelWorkbookBuffer([
      {
        name: 'Conversation',
        rows: [
          ['Field', 'Value'],
          ['Conversation ID', conversation.id],
          ['Display Name', displayName],
          ['Contact Name', conversation.contact_name || ''],
          ['Contact Phone', conversation.contact_phone],
          ['WhatsApp Phone Number ID', conversation.whatsapp_phone_number_id || ''],
          ['Status', conversation.status],
          ['Pinned', formatExportBoolean(conversation.is_pinned)],
          ['Archived', formatExportBoolean(conversation.is_archived)],
          ['Muted', formatExportBoolean(conversation.is_muted)],
          ['Blocked', formatExportBoolean(conversation.is_blocked)],
          ['Unread Count', toSafeNumber(conversation.unread_count)],
          ['Total Messages', toSafeNumber(conversation.total_messages)],
          ['Last Message', conversation.last_message_content || ''],
          ['Last Message Type', conversation.last_message_type || ''],
          ['Last Message Direction', conversation.last_message_direction || ''],
          ['Last Message At (IST)', formatExportDateTime(conversation.last_message_at)],
          ['Exported At (IST)', formatExportDateTime(exportTimestamp)],
        ],
      },
      {
        name: 'Messages',
        rows: [
          [
            'Message ID',
            'WhatsApp Message ID',
            'Direction',
            'Type',
            'Content',
            'Media Caption',
            'Media Filename',
            'Media MIME Type',
            'Media URL',
            'Interactive Data',
            'Location Data',
            'Contact Data',
            'Status',
            'Timestamp (IST)',
            'From Phone',
            'To Phone',
            'Read',
            'Read At (IST)',
            'Pinned',
            'Starred',
            'Error Message',
          ],
          ...messages.map(buildConversationExportRows),
        ],
      },
    ]);

    return {
      success: true,
      message: 'Conversation exported successfully',
      data: {
        filename: `whats91-chat-${sanitizeExportFileSegment(displayName)}-${buildExportTimestampSlug(exportTimestamp)}.xls`,
        buffer: workbook,
      },
    };
  } catch (error) {
    log.error('exportConversationExcel error', {
      error: error instanceof Error ? error.message : error,
      conversationId,
      userId,
    });
    return { success: false, message: 'Failed to export conversation', data: null };
  }
}

export async function exportAllConversationsExcel(userId: string): Promise<ConversationExportResult> {
  try {
    const conversations = await queryConversationsDb<any>(
      `SELECT *
       FROM conversations
       WHERE user_id = ?
       ORDER BY is_pinned DESC, COALESCE(last_message_at, updated_at) DESC, id DESC`,
      [userId]
    );

    const messageRows = await queryConversationsDb<any>(
      `SELECT
         cm.*,
         c.contact_name,
         c.contact_phone,
         c.status AS conversation_status,
         c.is_archived,
         c.is_pinned AS conversation_is_pinned,
         c.is_muted,
         c.is_blocked
       FROM conversation_messages cm
       INNER JOIN conversations c ON c.id = cm.conversation_id
       WHERE c.user_id = ?
       ORDER BY cm.conversation_id ASC, COALESCE(cm.timestamp, cm.created_at) ASC, cm.id ASC`,
      [userId]
    );

    const exportTimestamp = new Date();
    const workbook = buildExcelWorkbookBuffer([
      {
        name: 'Conversations',
        rows: [
          [
            'Conversation ID',
            'Display Name',
            'Contact Name',
            'Contact Phone',
            'WhatsApp Phone Number ID',
            'Status',
            'Pinned',
            'Archived',
            'Muted',
            'Blocked',
            'Unread Count',
            'Total Messages',
            'Last Message',
            'Last Message Type',
            'Last Message Direction',
            'Last Message At (IST)',
            'Updated At (IST)',
          ],
          ...conversations.map((conversation) => [
            conversation.id,
            getDisplayName(conversation.contact_name, conversation.contact_phone),
            conversation.contact_name || '',
            conversation.contact_phone,
            conversation.whatsapp_phone_number_id || '',
            conversation.status,
            formatExportBoolean(conversation.is_pinned),
            formatExportBoolean(conversation.is_archived),
            formatExportBoolean(conversation.is_muted),
            formatExportBoolean(conversation.is_blocked),
            toSafeNumber(conversation.unread_count),
            toSafeNumber(conversation.total_messages),
            conversation.last_message_content || '',
            conversation.last_message_type || '',
            conversation.last_message_direction || '',
            formatExportDateTime(conversation.last_message_at),
            formatExportDateTime(conversation.updated_at),
          ]),
        ],
      },
      {
        name: 'Messages',
        rows: [
          [
            'Conversation ID',
            'Display Name',
            'Contact Phone',
            'Message ID',
            'WhatsApp Message ID',
            'Direction',
            'Type',
            'Content',
            'Media Caption',
            'Media Filename',
            'Media MIME Type',
            'Media URL',
            'Interactive Data',
            'Location Data',
            'Contact Data',
            'Status',
            'Timestamp (IST)',
            'From Phone',
            'To Phone',
            'Read',
            'Read At (IST)',
            'Pinned',
            'Starred',
            'Error Message',
          ],
          ...messageRows.map((row) => {
            const message = mapConversationMessageRowToMessage(row);
            const conversationDisplayName = getDisplayName(row.contact_name, row.contact_phone);

            return [
              message.conversationId,
              conversationDisplayName,
              row.contact_phone,
              ...buildConversationExportRows(message),
            ];
          }),
        ],
      },
      {
        name: 'Export Info',
        rows: [
          ['Field', 'Value'],
          ['Export Type', 'All conversations'],
          ['Exported At (IST)', formatExportDateTime(exportTimestamp)],
          ['Total Conversations', conversations.length],
          ['Total Messages', messageRows.length],
        ],
      },
    ]);

    return {
      success: true,
      message: 'All conversations exported successfully',
      data: {
        filename: `whats91-all-chats-${sanitizeExportFileSegment(userId)}-${buildExportTimestampSlug(exportTimestamp)}.xls`,
        buffer: workbook,
      },
    };
  } catch (error) {
    log.error('exportAllConversationsExcel error', {
      error: error instanceof Error ? error.message : error,
      userId,
    });
    return { success: false, message: 'Failed to export all conversations', data: null };
  }
}

// Export controller
export const conversationController = {
  getConversations,
  getUserChatLabels,
  getConversationTargets,
  startConversation,
  getConversationById,
  getPinnedMessage,
  getStarredMessages,
  getConversationMediaMessages,
  sendMessage,
  sendVoiceNote,
  markAsRead: markConversationAsRead,
  toggleArchive: toggleArchiveConversation,
  togglePin: togglePinConversation,
  toggleMute: toggleMuteConversation,
  toggleBlock: toggleBlockConversation,
  updateConversationName,
  updateConversationNotes,
  getConversationLabels,
  updateConversationLabels,
  toggleMessagePinned,
  toggleMessageStarred,
  clear: clearConversation,
  delete: deleteConversation,
  exportConversationExcel,
  exportAllConversationsExcel,
  processIncomingMessage,
  updateMessageStatus,
};

export default conversationController;
