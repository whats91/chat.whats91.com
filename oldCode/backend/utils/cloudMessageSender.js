/**
 * ========================================
 * CLOUD API MESSAGE SENDER UTILITY
 * ========================================
 * Centralized utility for sending all WhatsApp Cloud API messages to Meta.
 * This is the SINGLE source of truth for message sending logic.
 * 
 * All controllers and cron jobs should use this utility instead of 
 * implementing their own axios calls to Meta's Graph API.
 * 
 * Features:
 * - Centralized message sending to Meta's Graph API
 * - Standardized response parsing and status determination
 * - Built-in retry logic support
 * - Checkpoint hooks for conditional message blocking
 * - Debug logging support
 * - Error code handling based on 2025 Meta guidelines
 * - MM Lite API support for marketing templates (2025/2026)
 * 
 * MM LITE API (Marketing Messages Lite):
 * - Uses /marketing_messages endpoint for MARKETING templates
 * - Provides algorithmic optimization for better delivery
 * - Supports product_policy and message_activity_sharing parameters
 * - Webhook responses include origin.type: "marketing_lite"
 * ========================================
 */

const axios = require('axios');
const logger = require('./loggerV2');
const { writeCloudDebugLog } = require('../controllers/cloudDebugLogController');
const redisController = require('../controllers/redisController');

// Get Graph API version from environment or default to latest
const getGraphApiVersion = () => {
  return process.env.META_GRAPH_API_VERSION || 'v24.0';
};

/**
 * Status codes that indicate successful message acceptance
 */
const SUCCESS_STATUSES = ['sent', 'delivered', 'accepted', 'read'];

/**
 * Retryable error codes with their base retry delays in minutes
 */
const RETRYABLE_ERRORS = {
  131049: { delay: 720, status: 'ecosystem_limited' },    // Ecosystem engagement (12h)
  131048: { delay: 30, status: 'spam_rate_limited' },     // Spam rate limit
  131056: { delay: 5, status: 'pair_rate_limited' },      // Pair rate limit
  4: { delay: 1, status: 'rate_limited' },                // General rate limit
  80007: { delay: 1, status: 'rate_limited' },            // Cloud API rate limit
  130429: { delay: 1, status: 'rate_limited' },           // Business API rate limit
  2: { delay: 5, status: 'offline' },                     // Service unavailable
  131000: { delay: 5, status: 'offline' }                 // Internal server error
};

/**
 * Non-retryable error codes (permanent failures)
 */
const NON_RETRYABLE_ERRORS = {
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
  131031: 'user_blocked_business'
};

/**
 * ========================================
 * MM LITE API CONSTANTS
 * ========================================
 * Marketing Messages Lite (MM Lite) is Meta's optimized delivery system
 * for marketing templates. It provides algorithmic optimization to
 * improve delivery rates and maintain ecosystem health.
 */

/**
 * MM Lite product policy options
 * - CLOUD_API_FALLBACK (default): Falls back to standard API if MM Lite fails
 * - STRICT: Only use MM Lite, fail if not available
 */
const MM_LITE_PRODUCT_POLICIES = {
  CLOUD_API_FALLBACK: 'CLOUD_API_FALLBACK',
  STRICT: 'STRICT'
};

/**
 * Template categories that should use MM Lite endpoint
 */
const MM_LITE_ELIGIBLE_CATEGORIES = ['MARKETING'];

/**
 * Template categories that should use standard /messages endpoint
 */
const STANDARD_API_CATEGORIES = ['UTILITY', 'AUTHENTICATION', 'SERVICE'];

/**
 * Check if a template category should use MM Lite endpoint
 * @param {string} category - Template category (MARKETING, UTILITY, AUTHENTICATION, etc.)
 * @returns {boolean} - True if should use MM Lite
 */
function shouldUseMMlite(category) {
  if (!category) return false;
  return MM_LITE_ELIGIBLE_CATEGORIES.includes(category.toUpperCase());
}

/**
 * Pre-send checkpoint hooks
 * Add functions here to implement conditional blocking
 * Return { blocked: true, reason: 'reason' } to block the message
 */
const preSendCheckpoints = [];

/**
 * Register a pre-send checkpoint
 * @param {Function} checkpointFn - Function that receives (sendParams) and returns { blocked: boolean, reason?: string }
 */
function registerPreSendCheckpoint(checkpointFn) {
  if (typeof checkpointFn === 'function') {
    preSendCheckpoints.push(checkpointFn);
    logger.info(`✅ Registered pre-send checkpoint. Total checkpoints: ${preSendCheckpoints.length}`);
  }
}

/**
 * Wallet balance checkpoint
 * Blocks messages if customer has insufficient balance (only for managed billing customers)
 * @param {Object} params - Send parameters (must include userId)
 * @returns {Promise<Object>} - { blocked: boolean, reason?: string, balance?: number }
 */
async function walletBalanceCheckpoint(params) {
  try {
    const { userId } = params;
    
    if (!userId) {
      return { blocked: false };
    }

    const balanceInfo = await redisController.getCustomerWalletBalance(userId);
    
    if (balanceInfo === null) {
      return { blocked: false };
    }
    
    if (balanceInfo.balance <= 0) {
      logger.warn(`Message blocked for user ${userId}: Insufficient balance (${balanceInfo.balance} ${balanceInfo.currency})`);
      return {
        blocked: true,
        message: 'Insufficient wallet balance',
        reason: `Insufficient wallet balance: ${balanceInfo.balance} ${balanceInfo.currency}`,
        balance: balanceInfo.balance,
        errorCode: 'INSUFFICIENT_BALANCE'
      };
    }
    
    return { blocked: false };
  } catch (error) {
    logger.error(`Error in wallet balance checkpoint: ${error.message}`);
    return { blocked: false };
  }
}

registerPreSendCheckpoint(walletBalanceCheckpoint);

/**
 * Run all pre-send checkpoints
 * @param {Object} params - Send parameters
 * @returns {Promise<Object>} - { blocked: boolean, reason?: string }
 */
async function runPreSendCheckpoints(params) {
  for (const checkpoint of preSendCheckpoints) {
    try {
      const result = await checkpoint(params);
      if (result && result.blocked) {
        return result;
      }
    } catch (error) {
      logger.error(`Error in pre-send checkpoint: ${error.message}`);
      // Continue with other checkpoints on error
    }
  }
  return { blocked: false };
}

/**
 * Detect if a phone number is from the United States (+1 prefix)
 * @param {string} phoneNumber - Phone number to check
 * @returns {boolean}
 */
function isUSPhoneNumber(phoneNumber) {
  if (!phoneNumber) return false;
  const cleanedNumber = phoneNumber.toString().replace(/\D/g, '');
  if (cleanedNumber.startsWith('1') && cleanedNumber.length === 11) return true;
  if (phoneNumber.toString().trim().startsWith('+1')) return true;
  return false;
}

/**
 * Parse Meta API response to determine message status, ID, and error code
 * @param {Object} responseData - Meta API response data
 * @param {string} receiverId - Optional recipient phone number for US detection
 * @returns {Object} - { messageStatus, messageId, errorCode, retryable, retryAfterMinutes }
 */
function parseMetaApiResponse(responseData, receiverId = null) {
  let messageStatus = 'failed';
  let messageId = null;
  let errorCode = null;
  let retryable = false;
  let retryAfterMinutes = 0;

  if (responseData && responseData.messages && responseData.messages.length > 0) {
    // Successful response
    const msgStatus = responseData.messages[0].message_status;
    messageStatus = msgStatus === 'accepted' ? 'accepted' : 'sent';
    messageId = responseData.messages[0].id;
    retryable = false;

  } else if (responseData && responseData.error) {
    // Error response
    const error = responseData.error;
    errorCode = error.code || null;

    // Check for retryable errors
    if (RETRYABLE_ERRORS[errorCode]) {
      const errorConfig = RETRYABLE_ERRORS[errorCode];
      
      // Special handling for ecosystem error with US numbers
      if (errorCode === 131049 && receiverId && isUSPhoneNumber(receiverId)) {
        messageStatus = 'us_marketing_blocked';
        retryable = false;
        logger.info(`Marketing message to US number ${receiverId} blocked (131049)`);
      } else {
        messageStatus = errorConfig.status;
        retryable = true;
        retryAfterMinutes = errorConfig.delay;
      }
    } else if (NON_RETRYABLE_ERRORS[errorCode]) {
      // Non-retryable errors
      if (errorCode === 131026) {
        messageStatus = 'notonwa';
      } else if (errorCode === 131021 || errorCode === 131031) {
        messageStatus = 'blocked';
      } else {
        messageStatus = 'failed';
      }
      retryable = false;
    } else {
      // Unknown error code
      messageStatus = 'failed';
      retryable = false;
      logger.info(`Unknown error code ${errorCode} encountered`);
    }

  } else if (responseData && responseData.statuses && responseData.statuses.length > 0) {
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
          } else {
            messageStatus = 'failed';
            retryable = false;
          }
        } else {
          messageStatus = 'failed';
          retryable = false;
        }
        break;
      case 'undelivered':
        messageStatus = 'undelivered';
        retryable = true;
        retryAfterMinutes = 60;
        break;
      default:
        messageStatus = 'failed';
        retryable = false;
    }
  }

  return { messageStatus, messageId, errorCode, retryable, retryAfterMinutes };
}

/**
 * Calculate the next retry time using exponential backoff
 * @param {number} retryCount - Current retry count (0-indexed)
 * @param {number} baseDelayMinutes - Base delay in minutes
 * @param {number} errorCode - Meta error code
 * @returns {Date} - Next retry timestamp
 */
function calculateRetryTime(retryCount, baseDelayMinutes, errorCode) {
  let delayMinutes;

  switch (errorCode) {
    case 131049: // Ecosystem engagement
      const ecosystemDelays = [720, 1440, 2880, 4320, 5760]; // 12h, 24h, 48h, 72h, 96h
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
    case 4:
    case 80007:
    case 130429:
      const generalDelays = [1, 5, 15];
      delayMinutes = generalDelays[Math.min(retryCount, generalDelays.length - 1)];
      break;
    case 2:
    case 131000:
      const serviceDelays = [5, 15, 30, 60];
      delayMinutes = serviceDelays[Math.min(retryCount, serviceDelays.length - 1)];
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
 * Get human-readable retry reason
 * @param {number} errorCode - Meta error code
 * @param {Date} retryAfter - Next retry timestamp
 * @param {string} receiverId - Recipient phone number
 * @returns {string} - Human-readable reason
 */
function getRetryReason(errorCode, retryAfter, receiverId = '') {
  const timeStr = retryAfter.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });

  switch (errorCode) {
    case 131049:
      if (isUSPhoneNumber(receiverId)) {
        return `Meta has paused marketing messages to US numbers. Will retry at ${timeStr} in case policy changes.`;
      }
      return `Message will be automatically retried at ${timeStr} to maintain healthy engagement.`;
    case 131048:
      return `Message quality check in progress. Will retry at ${timeStr}.`;
    case 131056:
      return `Recipient has reached their message limit. Will retry at ${timeStr}.`;
    case 4:
    case 80007:
    case 130429:
      return `Temporary rate limit. Will retry at ${timeStr}.`;
    case 2:
    case 131000:
      return `Meta's service is temporarily unavailable. Will retry at ${timeStr}.`;
    default:
      return `Message will be automatically retried at ${timeStr}.`;
  }
}

/**
 * Normalize phone for conversation lookup/storage.
 * Keeps only digits to align inbound and outbound storage.
 * @param {string} phoneNumber
 * @returns {string|null}
 */
function normalizeConversationPhone(phoneNumber) {
  if (!phoneNumber) return null;
  const cleaned = phoneNumber.toString().replace(/\D/g, '');
  return cleaned || phoneNumber.toString().trim() || null;
}

/**
 * Map sender statuses to conversation_messages.status enum values.
 * @param {string} messageStatus
 * @returns {string}
 */
function mapConversationMessageStatus(messageStatus) {
  const normalizedStatus = (messageStatus || '').toLowerCase();
  if (normalizedStatus === 'read') return 'read';
  if (normalizedStatus === 'delivered') return 'delivered';
  if (normalizedStatus === 'sent' || normalizedStatus === 'accepted' || normalizedStatus === 'queued') return 'sent';
  return 'failed';
}

/**
 * Build conversation-compatible fields from Meta payload.
 * @param {Object} messagePayload
 * @returns {Object}
 */
function extractConversationLogData(messagePayload = {}) {
  const messageType = messagePayload.type || (messagePayload.template ? 'template' : 'text');
  const mediaData = {};
  let messageContent = '';

  switch (messageType) {
    case 'text':
      messageContent = messagePayload.text?.body || '';
      break;
    case 'image':
      messageContent = messagePayload.image?.caption || '[Image]';
      mediaData.media_url = messagePayload.image?.link || messagePayload.image?.id || null;
      mediaData.media_mime_type = messagePayload.image?.mime_type || null;
      mediaData.media_caption = messagePayload.image?.caption || null;
      break;
    case 'video':
      messageContent = messagePayload.video?.caption || '[Video]';
      mediaData.media_url = messagePayload.video?.link || messagePayload.video?.id || null;
      mediaData.media_mime_type = messagePayload.video?.mime_type || null;
      mediaData.media_caption = messagePayload.video?.caption || null;
      break;
    case 'audio':
      messageContent = '[Audio]';
      mediaData.media_url = messagePayload.audio?.link || messagePayload.audio?.id || null;
      mediaData.media_mime_type = messagePayload.audio?.mime_type || null;
      break;
    case 'document':
      messageContent = messagePayload.document?.filename
        ? `[Document: ${messagePayload.document.filename}]`
        : '[Document]';
      mediaData.media_url = messagePayload.document?.link || messagePayload.document?.id || null;
      mediaData.media_mime_type = messagePayload.document?.mime_type || null;
      mediaData.media_filename = messagePayload.document?.filename || null;
      mediaData.media_caption = messagePayload.document?.caption || null;
      break;
    case 'interactive':
      if (messagePayload.interactive?.button_reply?.title) {
        messageContent = messagePayload.interactive.button_reply.title;
      } else if (messagePayload.interactive?.list_reply?.title) {
        messageContent = messagePayload.interactive.list_reply.title;
      } else {
        messageContent = '[Interactive Message]';
      }
      break;
    case 'location':
      messageContent = '[Location]';
      break;
    case 'contacts':
      messageContent = '[Contact]';
      break;
    case 'template':
      messageContent = messagePayload.template?.name
        ? `[Template: ${messagePayload.template.name}]`
        : '[Template]';
      break;
    default:
      messageContent = `[${messageType.toUpperCase()}]`;
  }

  return {
    messageType,
    messageContent,
    mediaData,
    interactiveData: messagePayload.interactive || null,
    locationData: messagePayload.location || null,
    contactData: messagePayload.contacts || null
  };
}

/**
 * Resolve CloudApiSetup for conversation logging.
 * Prefers explicit userId match, then falls back to phoneNumberId match.
 * @param {Object} params
 * @param {number|null} params.userId
 * @param {string|number} params.phoneNumberId
 * @returns {Promise<Object|null>}
 */
async function resolveConversationCloudSetup({ userId, phoneNumberId }) {
  const { CloudApiSetup } = require('../models');

  if (!phoneNumberId) return null;

  const normalizedPhoneNumberId = phoneNumberId.toString();
  let cloudSetup = null;

  if (userId) {
    cloudSetup = await CloudApiSetup.findOne({
      where: {
        user_id: userId,
        phone_number_id: normalizedPhoneNumberId
      },
      order: [['created_at', 'DESC']]
    });
  }

  if (!cloudSetup) {
    cloudSetup = await CloudApiSetup.findOne({
      where: { phone_number_id: normalizedPhoneNumberId },
      order: [['created_at', 'DESC']]
    });
  }

  return cloudSetup;
}

/**
 * Insert outbound messages into conversation tables when access_chats is enabled.
 * This keeps chat history consistent for messages sent from non-chat flows (bulk/API/cron).
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function logOutgoingMessageToConversation({
  userId = null,
  phoneNumberId,
  receiverId = null,
  messagePayload = {},
  messageId,
  messageStatus = 'sent',
  apiResponse = null
}) {
  try {
    if (!messageId || !phoneNumberId) {
      return { logged: false, reason: 'missing_message_context' };
    }

    const cloudSetup = await resolveConversationCloudSetup({ userId, phoneNumberId });
    if (!cloudSetup || !cloudSetup.access_chats) {
      return { logged: false, reason: 'access_chats_disabled' };
    }

    const effectiveUserId = cloudSetup.user_id;
    const normalizedPhoneNumberId = phoneNumberId.toString();
    const rawContactPhone = (receiverId || messagePayload?.to || '').toString().trim();
    const normalizedContactPhone = normalizeConversationPhone(rawContactPhone);

    if (!normalizedContactPhone) {
      return { logged: false, reason: 'missing_contact_phone' };
    }

    const { Conversation, ConversationMessage, Contacts } = require('../models');
    const { messageType, messageContent, mediaData, interactiveData, locationData, contactData } =
      extractConversationLogData(messagePayload);

    let conversation = await Conversation.findOne({
      where: {
        user_id: effectiveUserId,
        contact_phone: normalizedContactPhone,
        whatsapp_phone_number_id: normalizedPhoneNumberId
      }
    });

    if (!conversation && rawContactPhone && rawContactPhone !== normalizedContactPhone) {
      conversation = await Conversation.findOne({
        where: {
          user_id: effectiveUserId,
          contact_phone: rawContactPhone,
          whatsapp_phone_number_id: normalizedPhoneNumberId
        }
      });
    }

    const resolvedContactPhone = conversation?.contact_phone || normalizedContactPhone;

    if (!conversation) {
      const contact = await Contacts.findOne({
        where: {
          user_id: effectiveUserId,
          phone: normalizedContactPhone
        },
        attributes: ['id', 'first_name', 'last_name']
      });

      const contactByRawPhone = !contact && rawContactPhone && rawContactPhone !== normalizedContactPhone
        ? await Contacts.findOne({
            where: {
              user_id: effectiveUserId,
              phone: rawContactPhone
            },
            attributes: ['id', 'first_name', 'last_name']
          })
        : null;

      const resolvedContact = contact || contactByRawPhone;

      const firstName = resolvedContact?.first_name || '';
      const lastName = resolvedContact?.last_name || '';
      const contactName = `${firstName} ${lastName}`.trim() || null;

      conversation = await Conversation.create({
        user_id: effectiveUserId,
        contact_phone: normalizedContactPhone,
        contact_id: resolvedContact?.id || null,
        contact_name: contactName,
        whatsapp_phone_number_id: normalizedPhoneNumberId,
        unread_count: 0,
        total_messages: 0,
        status: 'active'
      });
    }

    const messageTimestamp = new Date();
    const [messageRecord, created] = await ConversationMessage.findOrCreate({
      where: { whatsapp_message_id: messageId },
      defaults: {
        conversation_id: conversation.id,
        whatsapp_message_id: messageId,
        from_phone: normalizedPhoneNumberId,
        to_phone: resolvedContactPhone,
        direction: 'outbound',
        message_type: messageType,
        message_content: messageContent,
        ...mediaData,
        interactive_data: interactiveData,
        location_data: locationData,
        contact_data: contactData,
        status: mapConversationMessageStatus(messageStatus),
        timestamp: messageTimestamp,
        webhook_data: apiResponse,
        outgoing_payload: messagePayload
      }
    });

    if (!created) {
      return { logged: false, reason: 'already_logged', conversationId: conversation.id };
    }

    await conversation.update({
      last_message_id: messageId,
      last_message_content: messageContent,
      last_message_type: messageType,
      last_message_at: messageTimestamp,
      last_message_direction: 'outbound',
      total_messages: (conversation.total_messages || 0) + 1
    });

    return {
      logged: true,
      userId: effectiveUserId,
      conversationId: conversation.id,
      conversationMessageId: messageRecord.id
    };
  } catch (error) {
    logger.errorWithUserId(`Conversation log insert failed: ${error.message}`, userId || null);
    return { logged: false, reason: 'insert_failed', error: error.message };
  }
}

/**
 * Main function to send a message to Meta's WhatsApp Cloud API
 * 
 * @param {Object} params - Send parameters
 * @param {Object} params.messagePayload - Complete Meta API message payload
 * @param {string} params.accessToken - WhatsApp access token
 * @param {string} params.phoneNumberId - WhatsApp phone number ID
 * @param {Object} [params.options] - Optional settings
 * @param {boolean} [params.options.enableDebugLog] - Enable debug logging
 * @param {number} [params.options.timeout] - Request timeout in ms (default: 30000)
 * @param {string} [params.options.receiverId] - Recipient phone number for US detection
 * @param {number} [params.options.retryCount] - Current retry count (for backoff calculation)
 * @param {number} [params.options.maxRetryAttempts] - Maximum retry attempts
 * @param {Object} [params.options.checkpointData] - Additional data for checkpoint functions
 * @param {number} [params.options.userId] - User ID for checkpoints and conversation logging
 * @param {boolean} [params.options.skipConversationLog] - Skip conversation log insertion
 * @returns {Promise<Object>} - Send result
 */
async function sendMessageToMeta({
  messagePayload,
  accessToken,
  phoneNumberId,
  options = {}
}) {
  const {
    enableDebugLog = false,
    timeout = 30000,
    receiverId = null,
    retryCount = 0,
    maxRetryAttempts = 5,
    checkpointData = {},
    userId = null,
    skipConversationLog = false
  } = options;

  const startTime = Date.now();

  try {
    // Validate required parameters
    if (!messagePayload || typeof messagePayload !== 'object') {
      return {
        success: false,
        error: 'Invalid message payload',
        errorCode: 'INVALID_PAYLOAD'
      };
    }

    if (!accessToken) {
      return {
        success: false,
        error: 'Missing access token',
        errorCode: 'MISSING_ACCESS_TOKEN'
      };
    }

    if (!phoneNumberId) {
      return {
        success: false,
        error: 'Missing phone number ID',
        errorCode: 'MISSING_PHONE_NUMBER_ID'
      };
    }

    // Run pre-send checkpoints
    const checkpointResult = await runPreSendCheckpoints({
      messagePayload,
      accessToken,
      phoneNumberId,
      receiverId: receiverId || messagePayload.to,
      userId,
      ...checkpointData
    });

    if (checkpointResult.blocked) {
      logger.websocketWarn(`Message blocked by checkpoint: ${checkpointResult.reason}`);
      
      if (enableDebugLog) {
        await writeCloudDebugLog(
          phoneNumberId,
          `[BLOCKED] Message blocked by checkpoint: ${checkpointResult.reason}`,
          'SEND'
        );
      }

      return {
        success: false,
        blocked: true,
        reason: checkpointResult.reason,
        errorCode: 'CHECKPOINT_BLOCKED'
      };
    }

    // Build API URL
    const apiVersion = getGraphApiVersion();
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // Debug log: Pre-send
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[SEND] Sending message - Type: ${messagePayload.type}, To: ${messagePayload.to}, URL: ${url}`,
        'SEND'
      );
    }

    logger.infoWithUserId(`📤 Sending to Meta API: ${url} - Type: ${messagePayload.type}, To: ${messagePayload.to}`, userId);

    // Make the API request
    const response = await axios.post(url, messagePayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout
    });

    const apiDuration = Date.now() - startTime;

    // Parse the response
    const finalReceiverId = receiverId || messagePayload.to;
    const { messageStatus, messageId, errorCode, retryable, retryAfterMinutes } = 
      parseMetaApiResponse(response.data, finalReceiverId);

    // 🔍 DEBUG LOG 1: Response parsed
    logger.websocketDebug(`🔍 [SEND] Meta API responded | Message ID: ${messageId} | Status: "${messageStatus}" | Error Code: ${errorCode || 'none'}`, userId);
    
    logger.websocketSuccess(`✅ Meta API response received - Message ID: ${messageId}, Status: ${messageStatus}`, userId);

    // Debug log: Post-send
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[SEND] Response received - Message ID: ${messageId}, Status: ${messageStatus}, Duration: ${apiDuration}ms`,
        'SEND'
      );
    }

    // Determine if successful
    const isSuccess = SUCCESS_STATUSES.includes(messageStatus);

    // Build result object
    const result = {
      success: isSuccess,
      messageId,
      messageStatus,
      apiResponse: response.data,
      errorCode: isSuccess ? null : errorCode,
      duration: apiDuration
    };

    // Add retry information if applicable
    if (retryable && !isSuccess) {
      if (retryCount < maxRetryAttempts) {
        const retryAfter = calculateRetryTime(retryCount, retryAfterMinutes, errorCode);
        const retryReason = getRetryReason(errorCode, retryAfter, finalReceiverId);
        
        result.needsRetry = true;
        result.retryAfter = retryAfter;
        result.retryReason = retryReason;
        result.retryCount = retryCount + 1;
      } else {
        result.needsRetry = false;
        result.retryReason = `Maximum retry attempts (${maxRetryAttempts}) exceeded`;
      }
    }

    if (!skipConversationLog && isSuccess && messageId) {
      await logOutgoingMessageToConversation({
        userId,
        phoneNumberId,
        receiverId: finalReceiverId,
        messagePayload,
        messageId,
        messageStatus,
        apiResponse: response.data
      });
    }

    return result;

  } catch (error) {
    const apiDuration = Date.now() - startTime;

    logger.websocketError(`❌ Meta API error: ${error.message}`, userId);
    logger.errorWithUserId(`Meta API error details: ${error.stack}`, userId);

    // Debug log: Error
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[SEND] Error - ${error.message}, Response: ${JSON.stringify(error.response?.data || {})}`,
        'SEND'
      );
    }

    // Parse error response
    const finalReceiverId = receiverId || messagePayload?.to;
    const { messageStatus, errorCode, retryable, retryAfterMinutes } = 
      parseMetaApiResponse(error.response?.data, finalReceiverId);

    // 🔍 DEBUG LOG 4: Error response parsed
    logger.websocketDebug(`🔍 [SEND ERROR] Meta API error parsed | Status: "${messageStatus}" | Error Code: ${errorCode || 'none'} | Retryable: ${retryable}`, userId);

    const result = {
      success: false,
      messageId: null,
      messageStatus,
      apiResponse: error.response?.data || { error: error.message },
      errorCode: errorCode || 'REQUEST_FAILED',
      error: error.message,
      duration: apiDuration
    };

    // Add retry information if applicable
    if (retryable) {
      if (retryCount < maxRetryAttempts) {
        const retryAfter = calculateRetryTime(retryCount, retryAfterMinutes, errorCode);
        const retryReason = getRetryReason(errorCode, retryAfter, finalReceiverId);
        
        result.needsRetry = true;
        result.retryAfter = retryAfter;
        result.retryReason = retryReason;
        result.retryCount = retryCount + 1;
      } else {
        result.needsRetry = false;
        result.retryReason = `Maximum retry attempts (${maxRetryAttempts}) exceeded`;
      }
    }

    return result;
  }
}

/**
 * Simplified send function for basic use cases
 * @param {Object} messagePayload - Message payload
 * @param {string} accessToken - Access token
 * @param {string} phoneNumberId - Phone number ID
 * @returns {Promise<Object>} - Send result
 */
async function sendMessage(messagePayload, accessToken, phoneNumberId) {
  return sendMessageToMeta({
    messagePayload,
    accessToken,
    phoneNumberId
  });
}

/**
 * Send message with debug logging enabled
 * @param {Object} messagePayload - Message payload
 * @param {string} accessToken - Access token
 * @param {string} phoneNumberId - Phone number ID
 * @returns {Promise<Object>} - Send result
 */
async function sendMessageWithDebug(messagePayload, accessToken, phoneNumberId) {
  return sendMessageToMeta({
    messagePayload,
    accessToken,
    phoneNumberId,
    options: { enableDebugLog: true }
  });
}

/**
 * ========================================
 * MM LITE API - MARKETING MESSAGES ENDPOINT
 * ========================================
 * Send marketing templates through Meta's optimized MM Lite endpoint.
 * This endpoint provides:
 * - Algorithmic optimization for better delivery timing
 * - Ecosystem health protection (prevents over-messaging)
 * - Up to 9% better delivery rates for marketing messages
 * 
 * IMPORTANT: Only MARKETING category templates can use this endpoint.
 * UTILITY and AUTHENTICATION templates must use the standard /messages endpoint.
 * 
 * @param {Object} params - Send parameters
 * @param {Object} params.messagePayload - Complete Meta API message payload (must be type: template)
 * @param {string} params.accessToken - WhatsApp access token
 * @param {string} params.phoneNumberId - WhatsApp phone number ID
 * @param {Object} [params.options] - Optional settings
 * @param {string} [params.options.productPolicy] - 'CLOUD_API_FALLBACK' (default) or 'STRICT'
 * @param {boolean} [params.options.messageActivitySharing] - Enable data sharing for optimization (default: true)
 * @param {boolean} [params.options.enableDebugLog] - Enable debug logging
 * @param {number} [params.options.timeout] - Request timeout in ms (default: 30000)
 * @param {string} [params.options.receiverId] - Recipient phone number for US detection
 * @param {number} [params.options.retryCount] - Current retry count (for backoff calculation)
 * @param {number} [params.options.maxRetryAttempts] - Maximum retry attempts
 * @returns {Promise<Object>} - Send result with messageId, status, and MM Lite specific info
 */
async function sendMarketingMessageToMeta({
  messagePayload,
  accessToken,
  phoneNumberId,
  options = {}
}) {
  const {
    productPolicy = MM_LITE_PRODUCT_POLICIES.CLOUD_API_FALLBACK,
    messageActivitySharing = true,
    enableDebugLog = false,
    timeout = 30000,
    receiverId = null,
    retryCount = 0,
    maxRetryAttempts = 5,
    checkpointData = {},
    userId = null,
    skipConversationLog = false
  } = options;

  const startTime = Date.now();

  try {
    // Validate required parameters
    if (!messagePayload || typeof messagePayload !== 'object') {
      return {
        success: false,
        error: 'Invalid message payload',
        errorCode: 'INVALID_PAYLOAD',
        usedMMlite: false
      };
    }

    // MM Lite only supports template messages
    if (messagePayload.type !== 'template') {
      logger.info('MM Lite API only supports template messages. Falling back to standard API.');
      return sendMessageToMeta({
        messagePayload,
        accessToken,
        phoneNumberId,
        options: {
          enableDebugLog,
          timeout,
          receiverId,
          retryCount,
          maxRetryAttempts,
          checkpointData,
          userId,
          skipConversationLog
        }
      });
    }

    if (!accessToken) {
      return {
        success: false,
        error: 'Missing access token',
        errorCode: 'MISSING_ACCESS_TOKEN',
        usedMMlite: false
      };
    }

    if (!phoneNumberId) {
      return {
        success: false,
        error: 'Missing phone number ID',
        errorCode: 'MISSING_PHONE_NUMBER_ID',
        usedMMlite: false
      };
    }

    // Run pre-send checkpoints
    const checkpointResult = await runPreSendCheckpoints({
      messagePayload,
      accessToken,
      phoneNumberId,
      receiverId: receiverId || messagePayload.to,
      userId,
      isMMlite: true,
      ...checkpointData
    });

    if (checkpointResult.blocked) {
      logger.websocketWarn(`[MM_LITE] Message blocked by checkpoint: ${checkpointResult.reason}`);
      
      if (enableDebugLog) {
        await writeCloudDebugLog(
          phoneNumberId,
          `[MM_LITE][BLOCKED] Message blocked by checkpoint: ${checkpointResult.reason}`,
          'SEND'
        );
      }

      return {
        success: false,
        blocked: true,
        reason: checkpointResult.reason,
        errorCode: 'CHECKPOINT_BLOCKED',
        usedMMlite: false
      };
    }

    // Build MM Lite API URL
    const apiVersion = getGraphApiVersion();
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/marketing_messages`;

    // Build MM Lite specific payload
    // The MM Lite endpoint has additional parameters
    const mmLitePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: messagePayload.to,
      type: 'template',
      template: messagePayload.template,
      // MM Lite specific parameters
      product_policy: productPolicy,
      message_activity_sharing: messageActivitySharing
    };

    // Debug log: Pre-send
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[MM_LITE][SEND] Sending marketing message - To: ${messagePayload.to}, Template: ${messagePayload.template?.name}, Policy: ${productPolicy}, URL: ${url}`,
        'SEND'
      );
    }

    logger.infoWithUserId(`📤 [MM_LITE] Sending to Meta Marketing API: ${url} - Template: ${messagePayload.template?.name}, To: ${messagePayload.to}`, userId);

    // Make the API request to MM Lite endpoint
    const response = await axios.post(url, mmLitePayload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout
    });

    const apiDuration = Date.now() - startTime;

    // Parse the response
    const finalReceiverId = receiverId || messagePayload.to;
    const { messageStatus, messageId, errorCode, retryable, retryAfterMinutes } = 
      parseMetaApiResponse(response.data, finalReceiverId);

    // 🔍 DEBUG LOG 1: Response parsed (MM Lite)
    logger.websocketDebug(`🔍 [MM_LITE SEND] Meta Marketing API responded receiverId: ${receiverId} | Message ID: ${messageId} | Status: "${messageStatus}" | Error Code: ${errorCode || 'none'}`, userId);
    
    logger.websocketSuccess(`✅ [MM_LITE] Meta Marketing API response received - Message ID: ${messageId}, Status: ${messageStatus}`, userId);

    // Debug log: Post-send
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[MM_LITE][SEND] Response received - Message ID: ${messageId}, Status: ${messageStatus}, Duration: ${apiDuration}ms`,
        'SEND'
      );
    }

    // Determine if successful
    const isSuccess = SUCCESS_STATUSES.includes(messageStatus);

    // Build result object with MM Lite specific info
    const result = {
      success: isSuccess,
      messageId,
      messageStatus,
      apiResponse: response.data,
      errorCode: isSuccess ? null : errorCode,
      duration: apiDuration,
      usedMMlite: true,  // Flag to indicate MM Lite was used
      productPolicy
    };

    // Add retry information if applicable
    if (retryable && !isSuccess) {
      if (retryCount < maxRetryAttempts) {
        const retryAfter = calculateRetryTime(retryCount, retryAfterMinutes, errorCode);
        const retryReason = getRetryReason(errorCode, retryAfter, finalReceiverId);
        
        result.needsRetry = true;
        result.retryAfter = retryAfter;
        result.retryReason = retryReason;
        result.retryCount = retryCount + 1;
        
        // 🔍 DEBUG LOG 2: Retry needed (MM Lite)
        logger.websocketDebug(`🔍 [MM_LITE SEND] Message ${messageId || 'unknown'} will be retried | Retry Count: ${result.retryCount}/${maxRetryAttempts} | Retry After: ${retryReason}`, userId);
      } else {
        result.needsRetry = false;
        result.retryReason = `Maximum retry attempts (${maxRetryAttempts}) exceeded`;
        
        // 🔍 DEBUG LOG 3: Max retries exceeded (MM Lite)
        logger.websocketDebug(`🔍 [MM_LITE SEND] Message ${messageId || 'unknown'} max retries exceeded | Final Status: "${messageStatus}"`, userId);
      }
    }

    if (!skipConversationLog && isSuccess && messageId) {
      await logOutgoingMessageToConversation({
        userId,
        phoneNumberId,
        receiverId: finalReceiverId,
        messagePayload,
        messageId,
        messageStatus,
        apiResponse: response.data
      });
    }

    return result;

  } catch (error) {
    const apiDuration = Date.now() - startTime;

    logger.websocketError(`❌ [MM_LITE] Meta Marketing API error: ${error.message}`, userId);
    logger.errorWithUserId(`[MM_LITE] Meta Marketing API error details: ${error.stack}`, userId);

    // Debug log: Error
    if (enableDebugLog) {
      await writeCloudDebugLog(
        phoneNumberId,
        `[MM_LITE][SEND] Error - ${error.message}, Response: ${JSON.stringify(error.response?.data || {})}`,
        'SEND'
      );
    }

    // Check if we should fallback to standard API (CLOUD_API_FALLBACK policy)
    const errorData = error.response?.data;
    const errorCode = errorData?.error?.code;
    
    // Fallback to standard API if:
    // 1. Using CLOUD_API_FALLBACK policy
    // 2. Error is related to MM Lite availability (not a message/payload error)
    if (productPolicy === MM_LITE_PRODUCT_POLICIES.CLOUD_API_FALLBACK) {
      // Check for MM Lite specific errors that warrant fallback
      const fallbackErrors = [
        // Add any MM Lite specific error codes that should trigger fallback
        // These are errors where MM Lite is not available but standard API might work
      ];
      
      // If it's a general availability issue, try standard API
      if (error.response?.status === 503 || error.response?.status === 502) {
        logger.infoWithUserId(`🔄 [MM_LITE] Falling back to standard API due to MM Lite unavailability`, userId);
        
        if (enableDebugLog) {
          await writeCloudDebugLog(
            phoneNumberId,
            `[MM_LITE][FALLBACK] Falling back to standard /messages endpoint`,
            'SEND'
          );
        }
        
        // Retry with standard API
        const fallbackResult = await sendMessageToMeta({
          messagePayload,
          accessToken,
          phoneNumberId,
          options: {
            enableDebugLog,
            timeout,
            receiverId,
            retryCount,
            maxRetryAttempts,
            checkpointData,
            userId,
            skipConversationLog
          }
        });
        
        fallbackResult.usedMMlite = false;
        fallbackResult.mmLiteFallback = true;
        return fallbackResult;
      }
    }

    // Parse error response
    const finalReceiverId = receiverId || messagePayload?.to;
    const parsedError = parseMetaApiResponse(error.response?.data, finalReceiverId);

    // 🔍 DEBUG LOG 4: Error response parsed (MM Lite)
    logger.websocketDebug(`🔍 [MM_LITE SEND ERROR] Meta Marketing API error parsed | Status: "${parsedError.messageStatus}" | Error Code: ${parsedError.errorCode || 'none'} | Retryable: ${parsedError.retryable}`, userId);

    const result = {
      success: false,
      messageId: null,
      messageStatus: parsedError.messageStatus,
      apiResponse: error.response?.data || { error: error.message },
      errorCode: parsedError.errorCode || 'REQUEST_FAILED',
      error: error.message,
      duration: apiDuration,
      usedMMlite: true,
      productPolicy
    };

    // Add retry information if applicable
    if (parsedError.retryable) {
      if (retryCount < maxRetryAttempts) {
        const retryAfter = calculateRetryTime(retryCount, parsedError.retryAfterMinutes, parsedError.errorCode);
        const retryReason = getRetryReason(parsedError.errorCode, retryAfter, finalReceiverId);
        
        result.needsRetry = true;
        result.retryAfter = retryAfter;
        result.retryReason = retryReason;
        result.retryCount = retryCount + 1;
      } else {
        result.needsRetry = false;
        result.retryReason = `Maximum retry attempts (${maxRetryAttempts}) exceeded`;
      }
    }

    return result;
  }
}

/**
 * Smart send function that automatically routes to MM Lite or standard API
 * based on the template category.
 * 
 * @param {Object} params - Send parameters
 * @param {Object} params.messagePayload - Complete Meta API message payload
 * @param {string} params.accessToken - WhatsApp access token
 * @param {string} params.phoneNumberId - WhatsApp phone number ID
 * @param {string} [params.templateCategory] - Template category (MARKETING, UTILITY, AUTHENTICATION)
 * @param {Object} [params.options] - Optional settings
 * @returns {Promise<Object>} - Send result
 */
async function sendMessageSmart({
  messagePayload,
  accessToken,
  phoneNumberId,
  templateCategory = null,
  options = {}
}) {
  // Determine if we should use MM Lite
  const useMMlite = shouldUseMMlite(templateCategory);
  const userId = options.userId || null;
  
  if (useMMlite && messagePayload.type === 'template') {
    logger.infoWithUserId(`📣 [SMART_SEND] Routing MARKETING template to MM Lite endpoint`, userId);
    return sendMarketingMessageToMeta({
      messagePayload,
      accessToken,
      phoneNumberId,
      options
    });
  } else {
    if (templateCategory) {
      logger.infoWithUserId(`📨 [SMART_SEND] Routing ${templateCategory} template to standard endpoint`, userId);
    }
    return sendMessageToMeta({
      messagePayload,
      accessToken,
      phoneNumberId,
      options
    });
  }
}

// Export functions
module.exports = {
  // Main send function
  sendMessageToMeta,
  
  // Simplified wrappers
  sendMessage,
  sendMessageWithDebug,
  
  // MM Lite API functions (2025/2026)
  sendMarketingMessageToMeta,
  sendMessageSmart,
  shouldUseMMlite,
  
  // MM Lite constants
  MM_LITE_PRODUCT_POLICIES,
  MM_LITE_ELIGIBLE_CATEGORIES,
  STANDARD_API_CATEGORIES,
  
  // Response parsing (for use by report loggers)
  parseMetaApiResponse,
  
  // Retry utilities
  calculateRetryTime,
  getRetryReason,
  
  // Checkpoint registration
  registerPreSendCheckpoint,
  
  // Constants
  SUCCESS_STATUSES,
  RETRYABLE_ERRORS,
  NON_RETRYABLE_ERRORS,
  
  // Utilities
  isUSPhoneNumber,
  getGraphApiVersion
};
