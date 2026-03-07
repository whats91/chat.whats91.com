const { Conversation, ConversationMessage, Contacts, User, CloudApiSetup, CloudApiReport, MediaStorage } = require('../models');
const { Op, Sequelize } = require('sequelize');
const WhatsAppMediaService = require('../services/whatsappMediaService');
const cloudMessageSender = require('../utils/cloudMessageSender');
const loggerV2 = require('../utils/loggerV2');
const wasabiStorage = require('../utils/wasabiStorage');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];
const MAX_CONVERSATION_UPLOAD_SIZE = 100 * 1024 * 1024;
const CONVERSATION_UPLOAD_TEMP_DIR = path.join(process.cwd(), 'temp', 'conversation-uploads');
const PENDING_MEDIA_UPLOAD_PREFIX = 'pending-upload-';
const ALLOWED_CONVERSATION_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/webm',
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);

const parseJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? value : null;
};

const firstArrayItem = (value) => (Array.isArray(value) && value.length > 0 ? value[0] : null);

const extractPayloadMessageNode = (payload) => {
  const parsed = parseJsonObject(payload);
  if (!parsed) return null;

  const entry = firstArrayItem(parsed.entry);
  const change = firstArrayItem(entry?.changes);
  const valueMessage = firstArrayItem(change?.value?.messages);
  if (valueMessage) return valueMessage;

  const nestedValueMessage = firstArrayItem(parsed.value?.messages);
  if (nestedValueMessage) return nestedValueMessage;

  const directMessage = firstArrayItem(parsed.messages);
  if (directMessage) return directMessage;

  if (parsed.message && typeof parsed.message === 'object') {
    return parsed.message;
  }

  if (parsed.type || parsed.text || parsed.image || parsed.video || parsed.audio || parsed.document || parsed.sticker) {
    return parsed;
  }

  return null;
};

const isMetaProtectedMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return (
    /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(url) ||
    /graph\.facebook\.com/i.test(url)
  );
};

const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
const isRelativeMediaUrl = (value) => typeof value === 'string' && /^\/?media\//i.test(value);
const toSafeNumber = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const resolveLocalPublicMediaPath = (mediaUrl) => {
  if (!mediaUrl || typeof mediaUrl !== 'string') return null;

  let pathname = null;
  const trimmed = mediaUrl.trim();

  if (isHttpUrl(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else if (trimmed.startsWith('/')) {
    pathname = trimmed;
  } else if (isRelativeMediaUrl(trimmed)) {
    pathname = `/${trimmed}`;
  }

  if (!pathname) return null;
  if (!/^\/media\//i.test(pathname)) return null;

  const normalizedPath = path.normalize(pathname).replace(/^([/\\])+/, '');
  const publicDir = path.join(process.cwd(), 'public');
  const absolutePath = path.join(publicDir, normalizedPath);
  const relativeToPublic = path.relative(publicDir, absolutePath);

  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    return null;
  }

  return absolutePath;
};

const sendLocalMediaFile = (res, filePath, options = {}) => {
  const {
    forceDownload = false,
    filename = path.basename(filePath),
    contentType = null
  } = options;

  const safeFilename = String(filename || path.basename(filePath)).replace(/["\r\n]/g, '_');

  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');

  if (forceDownload) {
    return res.download(filePath, safeFilename);
  }

  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  return res.sendFile(filePath);
};

const ensureDirectoryExistsSync = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const deleteLocalFileIfExists = async (filePath) => {
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const createPendingMediaUploadToken = () => `${PENDING_MEDIA_UPLOAD_PREFIX}${crypto.randomUUID()}`;
const isPendingMediaUploadToken = (value) => typeof value === 'string' && value.startsWith(PENDING_MEDIA_UPLOAD_PREFIX);

const buildConversationWhereClause = (id, userId) => ({
  user_id: userId,
  ...(isNaN(id) ? { uid: id } : { id: parseInt(id, 10) })
});

const buildConversationMediaProxyUrl = (messageId) => `/api/conversations/media/${encodeURIComponent(String(messageId))}`;

const cleanupPendingMediaUpload = async (mediaStorageRecord, userId) => {
  if (!mediaStorageRecord || !isPendingMediaUploadToken(mediaStorageRecord.message_id)) {
    return;
  }

  const deleteResult = await wasabiStorage.deleteObject(mediaStorageRecord.wasabi_path, userId);
  if (!deleteResult.success) {
    loggerV2.websocketWarn(
      `🗑️ Failed to delete orphaned Wasabi object | path: ${mediaStorageRecord.wasabi_path} | error: ${deleteResult.error}`,
      String(userId)
    );
  }

  await mediaStorageRecord.destroy();
};

const conversationUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureDirectoryExistsSync(CONVERSATION_UPLOAD_TEMP_DIR);
      cb(null, CONVERSATION_UPLOAD_TEMP_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const conversationUploadFileFilter = (req, file, cb) => {
  if (ALLOWED_CONVERSATION_UPLOAD_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('Invalid file type. Only chat-supported media files are allowed.'), false);
};

const conversationMediaUpload = multer({
  storage: conversationUploadStorage,
  fileFilter: conversationUploadFileFilter,
  limits: {
    fileSize: MAX_CONVERSATION_UPLOAD_SIZE
  }
});

/**
 * Get all conversations for a user with pagination and filtering
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 20, 
      search, 
      status = 'active',
      archived = false,
      unread_only = false
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    // Build where clause
    const whereClause = {
      user_id: userId,
      is_archived: archived === 'true'
    };
    
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    if (unread_only === 'true') {
      whereClause.unread_count = { [Op.gt]: 0 };
    }
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { contact_name: { [Op.like]: `%${search}%` } },
        { contact_phone: { [Op.like]: `%${search}%` } },
        { last_message_content: { [Op.like]: `%${search}%` } }
      ];
    }
    
    const { count, rows: conversations } = await Conversation.findAndCountAll({
      where: whereClause,
      // NOTE: Contact association disabled due to separate database
      // Contact data will be fetched separately if needed
      order: [
        ['is_pinned', 'DESC'],
        ['last_message_at', 'DESC'],
        ['created_at', 'DESC']
      ],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Format response with additional computed fields
    const formattedConversations = conversations.map(conv => {
      const convData = conv.toJSON();
      
      // Determine display name from contact_name stored in conversation
      // Note: Contact association is disabled due to separate database
      let displayName = convData.contact_name;
      if (!displayName) {
        displayName = convData.contact_phone;
      }
      
      return {
        ...convData,
        display_name: displayName,
        last_message_time_ago: convData.last_message_at ? getTimeAgo(convData.last_message_at) : null
      };
    });
    
    res.status(200).json({
      success: true,
      message: 'Conversations retrieved successfully',
      data: {
        conversations: formattedConversations,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit),
          hasNextPage: page * limit < count,
          hasPrevPage: page > 1
        },
        summary: {
          total_conversations: count,
          unread_conversations: await Conversation.count({
            where: { 
              user_id: userId, 
              unread_count: { [Op.gt]: 0 },
              is_archived: false
            }
          })
        }
      }
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve conversations',
      error: error.message
    });
  }
};

/**
 * Get a single conversation by ID with message history
 */
exports.getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { 
      page = 1, 
      limit = 50,
      before_message_id = null 
    } = req.query;
    
    // Check if id is numeric (database ID) or string (UID)
    const whereClause = {
      user_id: userId,
      ...(isNaN(id) ? { uid: id } : { id: parseInt(id) })
    };
    
    const conversation = await Conversation.findOne({
      where: whereClause
      // NOTE: Contact association disabled due to separate database
    });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    // Get messages with pagination
    const messageWhereClause = { conversation_id: conversation.id };
    
    if (before_message_id) {
      const beforeMessage = await ConversationMessage.findOne({
        where: { whatsapp_message_id: before_message_id }
      });
      if (beforeMessage) {
        messageWhereClause.timestamp = { [Op.lt]: beforeMessage.timestamp };
      }
    }
    
    const { count: totalMessages, rows: messages } = await ConversationMessage.findAndCountAll({
      where: messageWhereClause,
      order: [['timestamp', 'DESC']],
      limit: parseInt(limit),
      offset: 0
    });

    // Fix relative URLs to absolute URLs for cross-domain access
    const messagesWithFixedUrls = messages.map(message => {
      const messageData = message.toJSON();
      if (messageData.media_url) {
        messageData.media_url = WhatsAppMediaService.fixRelativeUrl(messageData.media_url);
      }
      return messageData;
    });
    
    // Mark messages as read
    await ConversationMessage.update(
      { is_read: true, read_at: new Date() },
      { 
        where: {
          conversation_id: conversation.id,
          is_read: false,
          direction: 'inbound'
        }
      }
    );
    
    // Reset unread count
    if (conversation.unread_count > 0) {
      await conversation.update({ unread_count: 0 });
    }
    
    // Determine display name from contact_name stored in conversation
    // Note: Contact association is disabled due to separate database
    let displayName = conversation.contact_name;
    if (!displayName) {
      displayName = conversation.contact_phone;
    }
    
    res.status(200).json({
      success: true,
      message: 'Conversation retrieved successfully',
      data: {
        conversation: {
          ...conversation.toJSON(),
          display_name: displayName
        },
        messages: messagesWithFixedUrls.reverse(), // Show oldest first
        pagination: {
          total_messages: totalMessages,
          current_page: parseInt(page),
          messages_per_page: parseInt(limit),
          has_more: totalMessages > parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve conversation',
      error: error.message
    });
  }
};

/**
 * Stream conversation media from Wasabi storage.
 * Flow: Check Wasabi -> If exists, stream from Wasabi -> If not, return metadata for frontend to trigger download
 */
exports.streamConversationMedia = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const forceDownload = req.query.download === '1';

    loggerV2.websocketInfo(
      `📥 Media request | internal_message_id: ${messageId} | user_id: ${userId} | download: ${forceDownload}`,
      String(userId)
    );

    // Check if media exists in Wasabi using internal database ID
    const mediaStorage = await MediaStorage.findOne({
      where: { message_id: String(messageId), user_id: userId }
    });

    if (mediaStorage) {
      loggerV2.websocketSuccess(
        `📥 Media found in Wasabi | wasabi_path: ${mediaStorage.wasabi_path} | internal_message_id: ${messageId}`,
        String(userId)
      );

      // Media exists in Wasabi - stream it
      const streamResult = await wasabiStorage.streamMedia(mediaStorage.wasabi_path, userId);

      if (streamResult.success) {
        loggerV2.websocketSuccess(
          `📥 Streaming from Wasabi | internal_message_id: ${messageId} | size: ${streamResult.contentLength || 'unknown'}`,
          String(userId)
        );

        res.setHeader('Content-Type', streamResult.contentType || mediaStorage.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${forceDownload ? 'attachment' : 'inline'}; filename="${mediaStorage.original_filename || 'media'}"`);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        
        if (streamResult.contentLength) {
          res.setHeader('Content-Length', streamResult.contentLength);
        }

        streamResult.stream.pipe(res);
        return;
      } else {
        loggerV2.websocketError(
          `📥 Failed to stream from Wasabi | wasabi_path: ${mediaStorage.wasabi_path} | error: ${streamResult.error}`,
          String(userId)
        );
      }
    } else {
      loggerV2.websocketWarn(
        `📥 Media not in Wasabi | internal_message_id: ${messageId} | user_id: ${userId} | action: needs_download`,
        String(userId)
      );
    }

    // Media not in Wasabi - return metadata so frontend can trigger download
    return res.status(404).json({
      success: false,
      message: 'Media not cached',
      needsDownload: true,
      messageId
    });

  } catch (error) {
    const userId = req.user?.id;
    loggerV2.websocketError(
      `📥 Media stream error | internal_message_id: ${req.params?.messageId} | error: ${error.message} | user_id: ${userId}`,
      String(userId)
    );
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media',
      error: error.message
    });
  }
};

/**
 * Download media from Meta and upload to Wasabi
 */
exports.downloadAndCacheMedia = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    loggerV2.websocketInfo(
      `⬇️ Download request | internal_message_id: ${messageId} | user_id: ${userId}`,
      String(userId)
    );

    // Find message using internal database ID
    const messageRecord = await ConversationMessage.findOne({
      where: { id: parseInt(messageId) },
      attributes: ['id', 'conversation_id', 'direction', 'media_url', 'media_mime_type', 'media_filename', 'message_type', 'incoming_payload', 'outgoing_payload', 'whatsapp_message_id']
    });

    if (!messageRecord) {
      loggerV2.websocketError(
        `⬇️ Message not found | internal_message_id: ${messageId} | user_id: ${userId}`,
        String(userId)
      );
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    const internalMessageId = messageRecord.id;
    const conversationId = messageRecord.conversation_id;

    loggerV2.websocketDebug(
      `⬇️ Message found | internal_id: ${internalMessageId} | conversation_id: ${conversationId} | direction: ${messageRecord.direction}`,
      String(userId)
    );

    // Check if already cached
    const existingMedia = await MediaStorage.findOne({
      where: { message_id: String(internalMessageId), user_id: userId }
    });

    if (existingMedia) {
      loggerV2.websocketInfo(
        `⬇️ Already cached | internal_id: ${internalMessageId} | wasabi_path: ${existingMedia.wasabi_path}`,
        String(userId)
      );
      return res.json({
        success: true,
        message: 'Media already cached',
        cached: true
      });
    }

    // Extract media information
    const message = messageRecord.toJSON();
    const payload = message.direction === 'inbound' ? message.incoming_payload : message.outgoing_payload;
    const payloadMessage = extractPayloadMessageNode(payload) || parseJsonObject(payload) || {};
    const payloadType = String(payloadMessage.type || message.message_type || '').toLowerCase();

    loggerV2.websocketDebug(
      `⬇️ Payload extracted | type: "${payloadType}" | has_payload: ${Boolean(payload)}`,
      String(userId)
    );

    let mediaNode = null;
    if (MEDIA_TYPES.includes(payloadType) && payloadMessage[payloadType]) {
      mediaNode = payloadMessage[payloadType];
    } else {
      const fallbackType = MEDIA_TYPES.find((type) => payloadMessage[type]);
      mediaNode = fallbackType ? payloadMessage[fallbackType] : null;
    }

    const payloadMediaUrl = mediaNode?.url || mediaNode?.link;
    const mediaId = mediaNode?.id;
    const mimeType = mediaNode?.mime_type || message.media_mime_type || 'application/octet-stream';
    const filename = message.media_filename || mediaNode?.filename || `media_${Date.now()}`;

    loggerV2.websocketDebug(
      `⬇️ Media info | media_id: ${mediaId || 'null'} | has_url: ${Boolean(payloadMediaUrl)} | mime: ${mimeType} | filename: ${filename}`,
      String(userId)
    );

    if (!payloadMediaUrl) {
      loggerV2.websocketError(
        `⬇️ No media URL in payload | internal_id: ${internalMessageId} | type: "${payloadType}" | media_node: ${Boolean(mediaNode)}`,
        String(userId)
      );
      return res.status(404).json({ success: false, message: 'Media URL not found in payload' });
    }

    // Get WhatsApp access token
    const setup = await CloudApiSetup.findOne({
      where: { user_id: userId },
      order: [['updated_at', 'DESC']],
      attributes: ['whatsapp_access_token']
    });

    if (!setup?.whatsapp_access_token) {
      loggerV2.websocketError(
        `⬇️ No access token | user_id: ${userId}`,
        String(userId)
      );
      return res.status(400).json({ success: false, message: 'WhatsApp access token not configured' });
    }

    // Step 1: Check if media already exists in Wasabi
    const wasabiPath = wasabiStorage.generatePath(userId, conversationId, internalMessageId, filename);
    
    loggerV2.websocketDebug(
      `⬇️ Checking Wasabi | path: ${wasabiPath} | internal_id: ${internalMessageId}`,
      String(userId)
    );

    const existsInWasabi = await wasabiStorage.exists(wasabiPath);
    
    if (existsInWasabi) {
      loggerV2.websocketSuccess(
        `⬇️ Already exists in Wasabi | path: ${wasabiPath} | internal_id: ${internalMessageId}`,
        String(userId)
      );
      
      // Save to database if not already there
      await MediaStorage.findOrCreate({
        where: { message_id: String(internalMessageId), user_id: userId },
        defaults: {
          user_id: userId,
          message_id: String(internalMessageId),
          wasabi_path: wasabiPath,
          mime_type: mimeType,
          file_size: null,
          original_filename: filename
        }
      });
      
      return res.json({
        success: true,
        message: 'Media already available in Wasabi',
        cached: true
      });
    }

    // Step 2: Get fresh download URL from Graph API
    if (!mediaId) {
      loggerV2.websocketError(
        `⬇️ No media ID available | internal_id: ${internalMessageId}`,
        String(userId)
      );
      return res.status(404).json({ success: false, message: 'Media ID not found' });
    }

    loggerV2.websocketInfo(
      `⬇️ Fetching fresh URL from Graph API | media_id: ${mediaId} | internal_id: ${internalMessageId}`,
      String(userId)
    );

    let downloadUrl;
    try {
      const graphResponse = await axios.get(
        `https://graph.facebook.com/v21.0/${mediaId}`,
        {
          headers: { Authorization: `Bearer ${setup.whatsapp_access_token}` },
          timeout: 10000
        }
      );

      downloadUrl = graphResponse.data?.url;
      if (!downloadUrl) {
        loggerV2.websocketError(
          `⬇️ Graph API returned no URL | media_id: ${mediaId}`,
          String(userId)
        );
        return res.status(404).json({ success: false, message: 'Could not get media URL from Graph API' });
      }

      loggerV2.websocketSuccess(
        `⬇️ Fresh URL obtained | url: ${downloadUrl.substring(0, 50)}... | internal_id: ${internalMessageId}`,
        String(userId)
      );
    } catch (graphError) {
      loggerV2.websocketError(
        `⬇️ Graph API failed | media_id: ${mediaId} | error: ${graphError.message}`,
        String(userId)
      );
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to get media URL from Graph API',
        error: graphError.message 
      });
    }

    // Step 3: Download from Meta to local temp file
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.join(tempDir, `${internalMessageId}_${Date.now()}`);
    
    loggerV2.websocketInfo(
      `⬇️ Downloading from Meta to temp file | internal_id: ${internalMessageId} | temp: ${path.basename(tempFilePath)}`,
      String(userId)
    );

    try {
      const downloadResponse = await axios.get(downloadUrl, {
        responseType: 'stream',
        headers: { Authorization: `Bearer ${setup.whatsapp_access_token}` },
        timeout: 60000
      });

      const writer = fs.createWriteStream(tempFilePath);
      downloadResponse.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      const fileStats = fs.statSync(tempFilePath);
      
      loggerV2.websocketSuccess(
        `⬇️ Downloaded to temp file | size: ${fileStats.size} bytes | internal_id: ${internalMessageId}`,
        String(userId)
      );

      // Step 4: Upload temp file to Wasabi
      loggerV2.websocketInfo(
        `⬇️ Uploading to Wasabi | path: ${wasabiPath} | size: ${fileStats.size} bytes`,
        String(userId)
      );

      const fileBuffer = fs.readFileSync(tempFilePath);
      const uploadResult = await wasabiStorage.uploadFromBuffer(fileBuffer, wasabiPath, mimeType, userId);

      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      
      loggerV2.websocketDebug(
        `⬇️ Temp file cleaned up | internal_id: ${internalMessageId}`,
        String(userId)
      );

      if (!uploadResult.success) {
        loggerV2.websocketError(
          `⬇️ Wasabi upload failed | error: ${uploadResult.error} | internal_id: ${internalMessageId}`,
          String(userId)
        );
        return res.status(500).json({
          success: false,
          message: 'Failed to upload to Wasabi',
          error: uploadResult.error
        });
      }

      loggerV2.websocketSuccess(
        `⬇️ Uploaded to Wasabi | path: ${wasabiPath} | size: ${uploadResult.fileSize} bytes`,
        String(userId)
      );

      // Step 5: Save to database using internal message ID
      await MediaStorage.create({
        user_id: userId,
        message_id: String(internalMessageId),
        wasabi_path: wasabiPath,
        mime_type: uploadResult.mimeType,
        file_size: uploadResult.fileSize,
        original_filename: filename
      });

      loggerV2.websocketSuccess(
        `⬇️ Media cached successfully | internal_id: ${internalMessageId} | wasabi_path: ${wasabiPath}`,
        String(userId)
      );

      return res.json({
        success: true,
        message: 'Media downloaded and cached successfully',
        cached: true
      });

    } catch (downloadError) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      loggerV2.websocketError(
        `⬇️ Download from Meta failed | error: ${downloadError.message} | internal_id: ${internalMessageId}`,
        String(userId)
      );
      
      return res.status(500).json({
        success: false,
        message: 'Failed to download from Meta',
        error: downloadError.message
      });
    }

  } catch (error) {
    const userId = req.user?.id;
    loggerV2.websocketError(
      `⬇️ Download error | internal_message_id: ${req.params?.messageId} | error: ${error.message} | user_id: ${userId}`,
      String(userId)
    );
    res.status(500).json({
      success: false,
      message: 'Failed to download and cache media',
      error: error.message
    });
  }
};

exports.getConversationMediaUploadMiddleware = () => conversationMediaUpload.array('files', 1);

exports.uploadConversationMedia = async (req, res) => {
  const userId = req.user?.id;
  const uploadedFile = req.files?.[0];
  let uploadedToWasabi = false;
  let createdMediaRecord = null;
  let uploadedWasabiPath = null;

  try {
    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        message: 'No file was uploaded'
      });
    }

    const { id } = req.params;
    const conversation = await Conversation.findOne({
      where: buildConversationWhereClause(id, userId),
      attributes: ['id']
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const pendingUploadToken = createPendingMediaUploadToken();
    const wasabiPath = wasabiStorage.generatePath(
      userId,
      conversation.id,
      pendingUploadToken,
      uploadedFile.originalname
    );
    uploadedWasabiPath = wasabiPath;
    const fileBuffer = await fs.promises.readFile(uploadedFile.path);

    const uploadResult = await wasabiStorage.uploadFromBuffer(
      fileBuffer,
      wasabiPath,
      uploadedFile.mimetype,
      userId
    );

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload media to Wasabi',
        error: uploadResult.error
      });
    }

    uploadedToWasabi = true;

    createdMediaRecord = await MediaStorage.create({
      user_id: userId,
      message_id: pendingUploadToken,
      wasabi_path: wasabiPath,
      mime_type: uploadResult.mimeType || uploadedFile.mimetype,
      file_size: uploadResult.fileSize || uploadedFile.size,
      original_filename: uploadedFile.originalname
    });

    return res.status(201).json({
      success: true,
      message: 'Media uploaded to Wasabi successfully',
      data: [{
        upload_token: pendingUploadToken,
        proxy_url: buildConversationMediaProxyUrl(pendingUploadToken),
        mime_type: createdMediaRecord.mime_type,
        file_size: createdMediaRecord.file_size,
        original_filename: createdMediaRecord.original_filename
      }]
    });
  } catch (error) {
    if (uploadedToWasabi) {
      if (createdMediaRecord) {
        await cleanupPendingMediaUpload(createdMediaRecord, userId);
      } else if (uploadedWasabiPath) {
        await wasabiStorage.deleteObject(uploadedWasabiPath, userId);
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to upload conversation media',
      error: error.message
    });
  } finally {
    try {
      await deleteLocalFileIfExists(uploadedFile?.path);
    } catch (cleanupError) {
      loggerV2.websocketWarn(
        `🧹 Failed to delete temp upload file | file: ${uploadedFile?.path} | error: ${cleanupError.message}`,
        String(userId)
      );
    }
  }
};

/**
 * Send a message in a conversation
 */
exports.sendMessage = async (req, res) => {
  let pendingMediaStorage = null;
  let acceptedWhatsappMessageId = null;
  let finalizedMediaStorageMessageId = null;

  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { 
      message_type = 'text',
      message_content,
      media_url,
      media_upload_token,
      media_caption,
      reply_to_message_id
    } = req.body;
    let persistedMediaUrl = media_url || null;
    let mediaUrlForMeta = media_url || null;
    let resolvedMediaMimeType = null;
    let resolvedMediaFilename = null;
    
    // Validate message content
    if (!message_content && !media_url && !media_upload_token) {
      return res.status(400).json({
        success: false,
        message: 'Message content or media URL is required'
      });
    }
    
    // Find conversation
    const whereClause = buildConversationWhereClause(id, userId);
    
    const conversation = await Conversation.findOne({ where: whereClause });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    // Get user's WhatsApp setup
    const whatsappSetup = await CloudApiSetup.findOne({
      where: { 
        user_id: userId,
        phone_number_id: conversation.whatsapp_phone_number_id
      }
    });
    
    if (!whatsappSetup) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp setup not found for this conversation'
      });
    }

    if (media_upload_token) {
      pendingMediaStorage = await MediaStorage.findOne({
        where: {
          message_id: String(media_upload_token),
          user_id: userId
        }
      });

      if (!pendingMediaStorage) {
        return res.status(404).json({
          success: false,
          message: 'Uploaded media was not found. Please upload the file again.'
        });
      }

      mediaUrlForMeta = await wasabiStorage.getSignedUrl(pendingMediaStorage.wasabi_path, 3600);
      persistedMediaUrl = buildConversationMediaProxyUrl(media_upload_token);
      resolvedMediaMimeType = pendingMediaStorage.mime_type || null;
      resolvedMediaFilename = pendingMediaStorage.original_filename || null;
    }

    if (message_type !== 'text' && !mediaUrlForMeta) {
      return res.status(400).json({
        success: false,
        message: 'Media URL is required for media messages'
      });
    }
    
    // Prepare message data for WhatsApp API
    const messageData = {
      messaging_product: 'whatsapp',
      to: conversation.contact_phone,
      type: message_type
    };
    
    // Handle different message types
    if (message_type === 'text') {
      messageData.text = { body: message_content };
    } else if (message_type === 'image') {
      messageData.image = {
        link: mediaUrlForMeta,
        ...(media_caption && { caption: media_caption })
      };
    } else if (message_type === 'video') {
      messageData.video = {
        link: mediaUrlForMeta,
        ...(media_caption && { caption: media_caption })
      };
    } else if (message_type === 'audio') {
      messageData.audio = {
        link: mediaUrlForMeta
      };
    } else if (message_type === 'document') {
      messageData.document = {
        link: mediaUrlForMeta,
        ...(resolvedMediaFilename && { filename: resolvedMediaFilename }),
        ...(media_caption && { caption: media_caption })
      };
    }
    
    // Add reply context if provided
    if (reply_to_message_id) {
      messageData.context = { message_id: reply_to_message_id };
    }
    
    console.log('📤 Sending WhatsApp message:', JSON.stringify(messageData, null, 2));
    
    // Send message via centralized Cloud API sender
    const sendResult = await cloudMessageSender.sendMessageToMeta({
      messagePayload: messageData,
      accessToken: whatsappSetup.whatsapp_access_token,
      phoneNumberId: conversation.whatsapp_phone_number_id,
      options: {
        receiverId: conversation.contact_phone,
        userId,
        skipConversationLog: true
      }
    });
    
    if (!sendResult.success) {
      if (pendingMediaStorage) {
        await cleanupPendingMediaUpload(pendingMediaStorage, userId);
        pendingMediaStorage = null;
      }

      return res.status(400).json({
        success: false,
        message: sendResult.error || 'Failed to send message via WhatsApp API',
        error_code: sendResult.errorCode
      });
    }
    
    const whatsappMessageId = sendResult.messageId;
    acceptedWhatsappMessageId = whatsappMessageId;
    let messageRecord = null;

    if (whatsappSetup.access_chats) {
      // Save message to database only when chat access is enabled
      messageRecord = await ConversationMessage.create({
        conversation_id: conversation.id,
        whatsapp_message_id: whatsappMessageId,
        from_phone: conversation.whatsapp_phone_number_id,
        to_phone: conversation.contact_phone,
        direction: 'outbound',
        message_type,
        message_content,
        media_url: pendingMediaStorage ? null : media_url,
        media_mime_type: resolvedMediaMimeType,
        media_filename: resolvedMediaFilename,
        media_caption,
        replied_to_message_id: reply_to_message_id,
        status: 'sent',
        timestamp: new Date(),
        webhook_data: sendResult.apiResponse || null,
        outgoing_payload: messageData
      });

      if (pendingMediaStorage) {
        persistedMediaUrl = buildConversationMediaProxyUrl(messageRecord.id);
        await pendingMediaStorage.update({ message_id: String(messageRecord.id) });
        finalizedMediaStorageMessageId = String(messageRecord.id);
        await messageRecord.update({
          media_url: persistedMediaUrl,
          media_mime_type: resolvedMediaMimeType,
          media_filename: resolvedMediaFilename
        });
      }

      // Update conversation metadata
      await conversation.update({
        last_message_id: whatsappMessageId,
        last_message_content: message_content || '[Media]',
        last_message_type: message_type,
        last_message_at: new Date(),
        last_message_direction: 'outbound',
        total_messages: conversation.total_messages + 1
      });

      // Broadcast via WebSocket
      if (global.websocketLogger) {
        const messageData = messageRecord.toJSON();
        // Fix media URL for cross-domain access
        if (messageData.media_url) {
          messageData.media_url = WhatsAppMediaService.fixRelativeUrl(messageData.media_url);
        }

        global.websocketLogger('new_message', {
          conversation_id: conversation.id,
          message: messageData,
          type: 'outbound'
        }, userId.toString());
      }
    }

    if (!messageRecord && pendingMediaStorage) {
      const finalMediaReference = acceptedWhatsappMessageId || media_upload_token;
      persistedMediaUrl = buildConversationMediaProxyUrl(finalMediaReference);
      await pendingMediaStorage.update({ message_id: String(finalMediaReference) });
      finalizedMediaStorageMessageId = String(finalMediaReference);
    }

    let responseMessage = {
      whatsapp_message_id: whatsappMessageId,
      from_phone: conversation.whatsapp_phone_number_id,
      to_phone: conversation.contact_phone,
      direction: 'outbound',
      message_type,
      message_content: message_content || null,
      media_url: persistedMediaUrl || null,
      media_mime_type: resolvedMediaMimeType || null,
      media_filename: resolvedMediaFilename || null,
      media_caption: media_caption || null,
      replied_to_message_id: reply_to_message_id || null,
      status: 'sent',
      timestamp: new Date()
    };

    if (messageRecord) {
      responseMessage = messageRecord.toJSON();
      if (responseMessage.media_url) {
        responseMessage.media_url = WhatsAppMediaService.fixRelativeUrl(responseMessage.media_url);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        message: responseMessage,
        whatsapp_message_id: whatsappMessageId,
        conversation_logged: !!messageRecord
      }
    });
  } catch (error) {
    if (pendingMediaStorage) {
      try {
        if (finalizedMediaStorageMessageId) {
          // Media row is already linked to the final message reference.
        } else if (acceptedWhatsappMessageId) {
          await pendingMediaStorage.update({
            message_id: String(acceptedWhatsappMessageId)
          });
        } else {
          await cleanupPendingMediaUpload(pendingMediaStorage, req.user?.id);
        }
      } catch (mediaCleanupError) {
        loggerV2.websocketWarn(
          `📤 Failed to finalize outgoing Wasabi media | error: ${mediaCleanupError.message} | user_id: ${req.user?.id}`,
          String(req.user?.id)
        );
      }
    }

    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

/**
 * Archive/Unarchive conversation
 */
exports.toggleArchiveConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const whereClause = {
      user_id: userId,
      ...(isNaN(id) ? { uid: id } : { id: parseInt(id) })
    };
    
    const conversation = await Conversation.findOne({ where: whereClause });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    const newArchivedStatus = !conversation.is_archived;
    await conversation.update({ is_archived: newArchivedStatus });
    
    res.status(200).json({
      success: true,
      message: `Conversation ${newArchivedStatus ? 'archived' : 'unarchived'} successfully`,
      data: { is_archived: newArchivedStatus }
    });
  } catch (error) {
    console.error('Error toggling archive status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update conversation',
      error: error.message
    });
  }
};

/**
 * Pin/Unpin conversation
 */
exports.togglePinConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const whereClause = {
      user_id: userId,
      ...(isNaN(id) ? { uid: id } : { id: parseInt(id) })
    };
    
    const conversation = await Conversation.findOne({ where: whereClause });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    const newPinnedStatus = !conversation.is_pinned;
    await conversation.update({ is_pinned: newPinnedStatus });
    
    res.status(200).json({
      success: true,
      message: `Conversation ${newPinnedStatus ? 'pinned' : 'unpinned'} successfully`,
      data: { is_pinned: newPinnedStatus }
    });
  } catch (error) {
    console.error('Error toggling pin status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update conversation',
      error: error.message
    });
  }
};

/**
 * Mark conversation as read
 */
exports.markConversationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const whereClause = {
      user_id: userId,
      ...(isNaN(id) ? { uid: id } : { id: parseInt(id) })
    };
    
    const conversation = await Conversation.findOne({ where: whereClause });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    // Mark all messages as read
    await ConversationMessage.update(
      { is_read: true, read_at: new Date() },
      { 
        where: {
          conversation_id: conversation.id,
          is_read: false,
          direction: 'inbound'
        }
      }
    );
    
    // Reset unread count
    await conversation.update({ unread_count: 0 });
    
    res.status(200).json({
      success: true,
      message: 'Conversation marked as read',
      data: { unread_count: 0 }
    });
  } catch (error) {
    console.error('Error marking conversation as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark conversation as read',
      error: error.message
    });
  }
};

/**
 * Delete conversation and all messages
 */
exports.deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const whereClause = {
      user_id: userId,
      ...(isNaN(id) ? { uid: id } : { id: parseInt(id) })
    };
    
    const conversation = await Conversation.findOne({ where: whereClause });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }
    
    // Delete all messages first
    await ConversationMessage.destroy({
      where: { conversation_id: conversation.id }
    });
    
    // Delete conversation
    await conversation.destroy();
    
    res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete conversation',
      error: error.message
    });
  }
};

/**
 * Get conversation statistics
 */
exports.getConversationStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const stats = await Promise.all([
      // Total conversations
      Conversation.count({ where: { user_id: userId } }),
      
      // Unread conversations
      Conversation.count({ 
        where: { 
          user_id: userId, 
          unread_count: { [Op.gt]: 0 }
        }
      }),
      
      // Archived conversations
      Conversation.count({ 
        where: { 
          user_id: userId, 
          is_archived: true 
        }
      }),
      
      // Total messages sent today
      ConversationMessage.count({
        where: {
          timestamp: {
            [Op.gte]: new Date().setHours(0, 0, 0, 0)
          },
          direction: 'outbound'
        },
        include: [{
          model: Conversation,
          as: 'conversation',
          where: { user_id: userId },
          attributes: []
        }]
      }),
      
      // Total messages received today
      ConversationMessage.count({
        where: {
          timestamp: {
            [Op.gte]: new Date().setHours(0, 0, 0, 0)
          },
          direction: 'inbound'
        },
        include: [{
          model: Conversation,
          as: 'conversation',
          where: { user_id: userId },
          attributes: []
        }]
      })
    ]);
    
    res.status(200).json({
      success: true,
      message: 'Conversation statistics retrieved successfully',
      data: {
        total_conversations: stats[0],
        unread_conversations: stats[1],
        archived_conversations: stats[2],
        messages_sent_today: stats[3],
        messages_received_today: stats[4]
      }
    });
  } catch (error) {
    console.error('Error getting conversation stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve conversation statistics',
      error: error.message
    });
  }
};

/**
 * Helper function to calculate time ago
 */
function getTimeAgo(date) {
  const now = new Date();
  const messageDate = new Date(date);
  const diffInSeconds = Math.floor((now - messageDate) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return messageDate.toLocaleDateString();
}
