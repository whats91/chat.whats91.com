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
  ConversationListItem,
  Message,
  MessageDirection,
  MessageStatus,
  MessageType,
  SendMessageRequest 
} from '@/lib/types/chat';
import { 
  sendMessageToMeta, 
  normalizeConversationPhone, 
  mapConversationMessageStatus 
} from '../whatsapp/message-sender';
import { publishNewMessage, publishStatusUpdate } from '../pubsub/pubsub-service';
import { findCloudApiSetupByUserAndPhoneNumberId, findDefaultCloudApiSetupByUser } from '../db/cloud-api-setup';
import { executeConversationsDb, queryConversationsDb } from '../db/conversations-db';
import { buildConversationMediaProxyUrl, MEDIA_MESSAGE_TYPES } from '@/lib/media/conversation-media';
import { db } from '@/lib/db';
import {
  cleanupPendingConversationMediaUpload,
  resolveForwardableConversationMedia,
  finalizePendingConversationMediaUpload,
  resolvePendingConversationMediaUpload,
} from '@/server/media/conversation-media-service';
import { Logger } from '@/lib/logger';

const log = new Logger('ConversationCtrl');

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

function isMediaMessageType(value: string | null | undefined): boolean {
  return Boolean(value && MEDIA_MESSAGE_TYPES.has(value));
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
}

export async function getConversations({
  userId,
  page = 1,
  limit = 20,
  search,
  status = 'active',
  archived = false,
  unreadOnly = false,
}: GetConversationsParams) {
  try {
    const offset = (page - 1) * limit;
    
    // Build the SQL query
    let sql = `
      SELECT 
        id, contact_phone, contact_name, whatsapp_phone_number_id,
        last_message_id, last_message_content, last_message_type,
        last_message_at, last_message_direction, unread_count,
        total_messages, is_archived, is_pinned, is_muted, status,
        created_at, updated_at
      FROM conversations
      WHERE user_id = ?
    `;
    
    const params: unknown[] = [userId];
    
    // Add filters
    if (search) {
      sql += ` AND (contact_name LIKE ? OR contact_phone LIKE ? OR last_message_content LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    
    if (status !== 'all') {
      sql += ` AND status = ?`;
      params.push(status);
    }
    
    if (archived) {
      sql += ` AND is_archived = true`;
    } else {
      sql += ` AND is_archived = false`;
    }
    
    if (unreadOnly) {
      sql += ` AND unread_count > 0`;
    }
    
    // Add ordering and pagination
    sql += ` ORDER BY is_pinned DESC, last_message_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    // Execute query
    const conversations = await queryConversationsDb<any>(sql, params);
    
    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM conversations WHERE user_id = ?`;
    const countParams: unknown[] = [userId];
    
    if (search) {
      countSql += ` AND (contact_name LIKE ? OR contact_phone LIKE ? OR last_message_content LIKE ?)`;
      const searchPattern = `%${search}%`;
      countParams.push(searchPattern, searchPattern, searchPattern);
    }
    
    if (status !== 'all') {
      countSql += ` AND status = ?`;
      countParams.push(status);
    }
    
    if (archived) {
      countSql += ` AND is_archived = true`;
    } else {
      countSql += ` AND is_archived = false`;
    }
    
    if (unreadOnly) {
      countSql += ` AND unread_count > 0`;
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
      lastMessageTimeAgo: formatTimeAgo(conv.last_message_at),
      unreadCount: toSafeNumber(conv.unread_count),
      isPinned: conv.is_pinned || false,
      isArchived: conv.is_archived || false,
      isMuted: conv.is_muted || false,
      status: conv.status,
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
}: {
  userId: string;
  search?: string;
  limit?: number;
}) {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const trimmedSearch = search?.trim();

    let conversationsSql = `
      SELECT id, contact_phone, contact_name, last_message_at, updated_at
      FROM conversations
      WHERE user_id = ? AND is_archived = false
    `;
    const conversationParams: unknown[] = [userId];

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
       (user_id, contact_phone, contact_name, whatsapp_phone_number_id, status, unread_count, total_messages, is_archived, is_pinned, is_muted, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, 0, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [userId, normalizedPhone, trimmedContactName, setup.phoneNumberId]
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
    
    // Get messages (oldest first for display)
    const offset = (page - 1) * limit;
    const messages = await queryConversationsDb<any>(
      `SELECT * FROM conversation_messages 
       WHERE conversation_id = ? 
       ORDER BY timestamp DESC 
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
    const formattedMessages: Message[] = messages.map(msg => ({
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
      readAt: msg.read_at,
    }));
    
    // Mark as read and clear unread count
    await executeConversationsDb(
      `UPDATE conversations SET unread_count = 0, updated_at = datetime('now') WHERE id = ?`,
      [conversationId]
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
    
    // Get CloudApiSetup for this user
    let resolvedPhoneNumberId = conversation.whatsapp_phone_number_id
      ? String(conversation.whatsapp_phone_number_id)
      : null;
    let cloudSetup = resolvedPhoneNumberId
      ? await findCloudApiSetupByUserAndPhoneNumberId(userId, resolvedPhoneNumberId)
      : null;

    if (!cloudSetup?.whatsappAccessToken) {
      const fallbackSetup = await findDefaultCloudApiSetupByUser(userId);

      if (fallbackSetup?.phoneNumberId && fallbackSetup.whatsappAccessToken) {
        cloudSetup = fallbackSetup;
        resolvedPhoneNumberId = fallbackSetup.phoneNumberId;

        if (String(conversation.whatsapp_phone_number_id || '') !== fallbackSetup.phoneNumberId) {
          await executeConversationsDb(
            `UPDATE conversations
             SET whatsapp_phone_number_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`,
            [fallbackSetup.phoneNumberId, conversationId, userId]
          );
          conversation.whatsapp_phone_number_id = fallbackSetup.phoneNumberId;
        }
      }
    }

    if (!cloudSetup || !cloudSetup.whatsappAccessToken || !resolvedPhoneNumberId) {
      return {
        success: false,
        message: 'WhatsApp configuration not found for this phone number',
        data: null,
      };
    }

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
        messagePayload.audio = { link: mediaUrlForMeta };
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
      accessToken: cloudSetup.whatsappAccessToken,
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
        conversation.whatsapp_phone_number_id,
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
      `UPDATE conversations SET is_archived = ?, updated_at = datetime('now') WHERE id = ?`,
      [newArchivedState, conversationId]
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
      `UPDATE conversations SET is_pinned = ?, updated_at = datetime('now') WHERE id = ?`,
      [newPinnedState, conversationId]
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
// DELETE CONVERSATION
// ========================================

export async function deleteConversation(conversationId: number, userId: string) {
  try {
    // Delete messages first
    await executeConversationsDb(
      `DELETE FROM conversation_messages WHERE conversation_id = ?`,
      [conversationId]
    );
    
    // Delete conversation
    await executeConversationsDb(
      `DELETE FROM conversations WHERE id = ? AND user_id = ?`,
      [conversationId, userId]
    );
    
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
// UPDATE MESSAGE STATUS (for webhooks)
// ========================================

export async function updateMessageStatus(
  whatsappMessageId: string,
  status: MessageStatus,
  errorCode?: string,
  errorMessage?: string
) {
  try {
    await executeConversationsDb(
      `UPDATE conversation_messages SET status = ?, error_message = ?, updated_at = datetime('now') WHERE whatsapp_message_id = ?`,
      [status, errorMessage || null, whatsappMessageId]
    );
    
    // Get conversation for pub/sub
    const [message] = await queryConversationsDb<any>(
      `SELECT cm.*, c.user_id FROM conversation_messages cm 
       JOIN conversations c ON cm.conversation_id = c.id 
       WHERE cm.whatsapp_message_id = ?`,
      [whatsappMessageId]
    );
    
    if (message) {
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

// Export controller
export const conversationController = {
  getConversations,
  getConversationTargets,
  startConversation,
  getConversationById,
  sendMessage,
  markAsRead: markConversationAsRead,
  toggleArchive: toggleArchiveConversation,
  togglePin: togglePinConversation,
  delete: deleteConversation,
  processIncomingMessage,
  updateMessageStatus,
};

export default conversationController;
