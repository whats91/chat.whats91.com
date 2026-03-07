/**
 * WhatsApp Cloud API Message Sender Utility
 * 
 * Centralized utility for sending all WhatsApp Cloud API messages to Meta.
 * This is the SINGLE source of truth for message sending logic.
 * 
 * Features:
 * - Centralized message sending to Meta's Graph API
 * - Standardized response parsing and status determination
 * - Built-in retry logic support
 * - Error code handling based on 2025 Meta guidelines
 * - Conversation logging integration
 */

import 'server-only';
import type { 
  WhatsAppMessagePayload, 
  WhatsAppApiResponse,
  MessageStatus,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES 
} from '@/lib/types/chat';
import { Logger } from '@/lib/logger';

const log = new Logger('WhatsApp');

// ========================================
// CONFIGURATION
// ========================================

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v24.0';
const SUCCESS_STATUSES = ['sent', 'delivered', 'accepted', 'read'];

// Retryable error codes with their base retry delays in minutes
const RETRYABLE_ERRORS: Record<number, { delay: number; status: string }> = {
  131049: { delay: 720, status: 'ecosystem_limited' },
  131048: { delay: 30, status: 'spam_rate_limited' },
  131056: { delay: 5, status: 'pair_rate_limited' },
  4: { delay: 1, status: 'rate_limited' },
  80007: { delay: 1, status: 'rate_limited' },
  130429: { delay: 1, status: 'rate_limited' },
  2: { delay: 5, status: 'offline' },
  131000: { delay: 5, status: 'offline' },
};

// Non-retryable error codes (permanent failures)
const NON_RETRYABLE_ERRORS: Record<number, string> = {
  190: 'token_expired',
  3: 'permission_issue',
  10: 'permission_issue',
  100: 'invalid_parameter',
  33: 'phone_number_deleted',
  131008: 'missing_parameter',
  131009: 'invalid_parameter_value',
  133010: 'phone_not_registered',
  131042: 'payment_issue',
  132001: 'template_not_exist',
  132015: 'template_paused',
  132016: 'template_disabled',
  368: 'policy_violation',
  131047: 're_engagement_outside_24h',
  131026: 'not_on_whatsapp',
  131021: 'user_opted_out',
  131031: 'user_blocked_business',
};

// ========================================
// TYPES
// ========================================

export interface SendResult {
  success: boolean;
  messageId?: string | null;
  messageStatus?: string;
  apiResponse?: WhatsAppApiResponse;
  errorCode?: string | number | null;
  error?: string;
  duration?: number;
  needsRetry?: boolean;
  retryAfter?: Date;
  retryReason?: string;
  retryCount?: number;
  blocked?: boolean;
  reason?: string;
}

export interface SendOptions {
  enableDebugLog?: boolean;
  timeout?: number;
  receiverId?: string;
  retryCount?: number;
  maxRetryAttempts?: number;
  userId?: string | number | bigint;
  skipConversationLog?: boolean;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Detect if a phone number is from the United States (+1 prefix)
 */
function isUSPhoneNumber(phoneNumber: string): boolean {
  if (!phoneNumber) return false;
  const cleanedNumber = phoneNumber.toString().replace(/\D/g, '');
  if (cleanedNumber.startsWith('1') && cleanedNumber.length === 11) return true;
  if (phoneNumber.toString().trim().startsWith('+1')) return true;
  return false;
}

/**
 * Parse Meta API response to determine message status, ID, and error code
 */
function parseMetaApiResponse(
  responseData: WhatsAppApiResponse | undefined,
  receiverId?: string
): {
  messageStatus: string;
  messageId: string | null;
  errorCode: number | null;
  retryable: boolean;
  retryAfterMinutes: number;
} {
  let messageStatus = 'failed';
  let messageId: string | null = null;
  let errorCode: number | null = null;
  let retryable = false;
  let retryAfterMinutes = 0;

  if (responseData?.messages && responseData.messages.length > 0) {
    // Successful response
    const msgStatus = responseData.messages[0].message_status;
    messageStatus = msgStatus === 'accepted' ? 'accepted' : 'sent';
    messageId = responseData.messages[0].id;
    retryable = false;
  } else if (responseData?.error) {
    // Error response
    errorCode = responseData.error.code || null;

    if (RETRYABLE_ERRORS[errorCode]) {
      const errorConfig = RETRYABLE_ERRORS[errorCode];
      
      // Special handling for ecosystem error with US numbers
      if (errorCode === 131049 && receiverId && isUSPhoneNumber(receiverId)) {
        messageStatus = 'us_marketing_blocked';
        retryable = false;
      } else {
        messageStatus = errorConfig.status;
        retryable = true;
        retryAfterMinutes = errorConfig.delay;
      }
    } else if (NON_RETRYABLE_ERRORS[errorCode]) {
      if (errorCode === 131026) {
        messageStatus = 'notonwa';
      } else if (errorCode === 131021 || errorCode === 131031) {
        messageStatus = 'blocked';
      } else {
        messageStatus = 'failed';
      }
      retryable = false;
    } else {
      messageStatus = 'failed';
      retryable = false;
    }
  } else if (responseData?.statuses && responseData.statuses.length > 0) {
    // Webhook status update
    const statusObject = responseData.statuses[0];
    messageId = statusObject.id;
    const webhookStatus = statusObject.status;

    switch (webhookStatus) {
      case 'queued':
      case 'accepted':
      case 'sent':
      case 'delivered':
      case 'read':
      case 'deleted':
        messageStatus = webhookStatus;
        retryable = false;
        break;
      case 'warning':
        messageStatus = 'warning';
        retryable = false;
        break;
      case 'failed':
        if (statusObject.errors && statusObject.errors.length > 0) {
          errorCode = statusObject.errors[0].code || null;
          if (RETRYABLE_ERRORS[errorCode]) {
            messageStatus = RETRYABLE_ERRORS[errorCode].status;
            retryable = true;
            retryAfterMinutes = RETRYABLE_ERRORS[errorCode].delay;
          }
        }
        break;
      case 'undelivered':
        messageStatus = 'undelivered';
        retryable = true;
        retryAfterMinutes = 60;
        break;
      default:
        messageStatus = 'failed';
    }
  }

  return { messageStatus, messageId, errorCode, retryable, retryAfterMinutes };
}

/**
 * Calculate the next retry time using exponential backoff
 */
function calculateRetryTime(
  retryCount: number,
  baseDelayMinutes: number,
  errorCode: number
): Date {
  let delayMinutes: number;

  switch (errorCode) {
    case 131049: // Ecosystem engagement
      const ecosystemDelays = [720, 1440, 2880, 4320, 5760];
      delayMinutes = ecosystemDelays[Math.min(retryCount, ecosystemDelays.length - 1)];
      break;
    case 131048: // Spam rate limit
      const spamDelays = [30, 60, 120, 240];
      delayMinutes = spamDelays[Math.min(retryCount, spamDelays.length - 1)];
      break;
    case 131056: // Pair rate limit
      const pairDelays = [5, 15, 30, 60];
      delayMinutes = pairDelays[Math.min(retryCount, pairDelays.length - 1)];
      break;
    default:
      delayMinutes = baseDelayMinutes * Math.pow(2, retryCount);
      delayMinutes = Math.min(delayMinutes, 1440); // Cap at 24 hours
  }

  const nextRetry = new Date();
  nextRetry.setMinutes(nextRetry.getMinutes() + delayMinutes);
  return nextRetry;
}

/**
 * Normalize phone for conversation lookup/storage
 */
export function normalizeConversationPhone(phoneNumber: string): string | null {
  if (!phoneNumber) return null;
  const cleaned = phoneNumber.toString().replace(/\D/g, '');
  return cleaned || phoneNumber.toString().trim() || null;
}

/**
 * Map sender statuses to conversation_messages.status enum values
 */
export function mapConversationMessageStatus(messageStatus: string): MessageStatus {
  const normalizedStatus = (messageStatus || '').toLowerCase();
  if (normalizedStatus === 'read') return 'read';
  if (normalizedStatus === 'delivered') return 'delivered';
  if (normalizedStatus === 'sent' || normalizedStatus === 'accepted' || normalizedStatus === 'queued') return 'sent';
  return 'failed';
}

// ========================================
// MAIN SEND FUNCTION
// ========================================

/**
 * Send a message to Meta's WhatsApp Cloud API
 */
export async function sendMessageToMeta({
  messagePayload,
  accessToken,
  phoneNumberId,
  options = {},
}: {
  messagePayload: WhatsAppMessagePayload;
  accessToken: string;
  phoneNumberId: string;
  options?: SendOptions;
}): Promise<SendResult> {
  const {
    enableDebugLog = false,
    timeout = 30000,
    receiverId,
    retryCount = 0,
    maxRetryAttempts = 5,
    userId,
    skipConversationLog = false,
  } = options;

  const startTime = Date.now();

  try {
    // Validate required parameters
    if (!messagePayload || typeof messagePayload !== 'object') {
      return {
        success: false,
        error: 'Invalid message payload',
        errorCode: 'INVALID_PAYLOAD',
      };
    }

    if (!accessToken) {
      return {
        success: false,
        error: 'Missing access token',
        errorCode: 'MISSING_ACCESS_TOKEN',
      };
    }

    if (!phoneNumberId) {
      return {
        success: false,
        error: 'Missing phone number ID',
        errorCode: 'MISSING_PHONE_NUMBER_ID',
      };
    }

    // Build API URL
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

    if (enableDebugLog) {
      log.debug('Sending message', { url, type: messagePayload.type, to: messagePayload.to });
    }

    // Make the API request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
      signal: AbortSignal.timeout(timeout),
    });

    const apiDuration = Date.now() - startTime;
    const responseData = await response.json() as WhatsAppApiResponse;

    // Parse the response
    const finalReceiverId = receiverId || messagePayload.to;
    const { messageStatus, messageId, errorCode, retryable, retryAfterMinutes } =
      parseMetaApiResponse(responseData, finalReceiverId);

    log.info('API response', { messageId, status: messageStatus, duration: apiDuration });

    // Determine if successful
    const isSuccess = SUCCESS_STATUSES.includes(messageStatus);

    // Build result object
    const result: SendResult = {
      success: isSuccess,
      messageId,
      messageStatus,
      apiResponse: responseData,
      errorCode: isSuccess ? null : errorCode,
      duration: apiDuration,
    };

    // Add retry information if applicable
    if (retryable && !isSuccess) {
      if (retryCount < maxRetryAttempts) {
        const retryAfter = calculateRetryTime(retryCount, retryAfterMinutes, errorCode as number);
        result.needsRetry = true;
        result.retryAfter = retryAfter;
        result.retryCount = retryCount + 1;
      } else {
        result.needsRetry = false;
        result.retryReason = `Maximum retry attempts (${maxRetryAttempts}) exceeded`;
      }
    }

    // TODO: Log to conversation if needed and userId is provided
    if (!skipConversationLog && isSuccess && messageId && userId) {
      // await logOutgoingMessageToConversation(...)
    }

    return result;
  } catch (error) {
    const apiDuration = Date.now() - startTime;

    log.error('API error', { error: error instanceof Error ? error.message : error });

    const result: SendResult = {
      success: false,
      messageId: null,
      messageStatus: 'failed',
      apiResponse: undefined,
      errorCode: 'REQUEST_FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: apiDuration,
    };

    return result;
  }
}

/**
 * Simplified send function for basic use cases
 */
export async function sendMessage(
  messagePayload: WhatsAppMessagePayload,
  accessToken: string,
  phoneNumberId: string
): Promise<SendResult> {
  return sendMessageToMeta({
    messagePayload,
    accessToken,
    phoneNumberId,
  });
}

/**
 * Build a text message payload
 */
export function buildTextMessage(to: string, text: string): WhatsAppMessagePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  };
}

/**
 * Build a template message payload
 */
export function buildTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string = 'en',
  components?: Array<{ type: 'header' | 'body' | 'button'; parameters: Record<string, unknown>[] }>
): WhatsAppMessagePayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };
}

/**
 * Build a media message payload (image, video, document, audio)
 */
export function buildMediaMessage(
  to: string,
  mediaType: 'image' | 'video' | 'document' | 'audio',
  mediaUrl: string,
  caption?: string,
  filename?: string
): WhatsAppMessagePayload {
  const payload: WhatsAppMessagePayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: mediaType,
  };

  switch (mediaType) {
    case 'image':
      payload.image = { link: mediaUrl, caption };
      break;
    case 'video':
      payload.video = { link: mediaUrl, caption };
      break;
    case 'document':
      payload.document = { link: mediaUrl, caption, filename };
      break;
    case 'audio':
      payload.audio = { link: mediaUrl };
      break;
  }

  return payload;
}

// Export all functions as named exports
export {
  sendMessageToMeta,
  sendMessage,
  buildTextMessage,
  buildTemplateMessage,
  buildMediaMessage,
  normalizeConversationPhone,
  mapConversationMessageStatus,
};
