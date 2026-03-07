const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');
const path = require('path');
const loggerV2 = require('./loggerV2');
require('dotenv').config();

class WasabiStorage {
  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.WASABI_ENDPOINT,
      region: process.env.WASABI_REGION,
      credentials: {
        accessKeyId: process.env.WASABI_ACCESS_KEY,
        secretAccessKey: process.env.WASABI_SECRET_KEY
      }
    });
    this.bucket = process.env.WASABI_BUCKET;
  }

  /**
   * Generate Wasabi path for media
   * Format: users/{userId}/conversations/{conversationId}/{messageId}_{timestamp}.{ext}
   */
  generatePath(userId, conversationId, messageId, filename) {
    const timestamp = Date.now();
    const ext = filename ? path.extname(filename) : '';
    const sanitizedFilename = `${messageId}_${timestamp}${ext}`;
    return `users/${userId}/conversations/${conversationId}/${sanitizedFilename}`;
  }

  /**
   * Upload media to Wasabi from URL
   */
  async uploadFromUrl(url, wasabiPath, mimeType, accessToken, userId = 'system') {
    try {
      loggerV2.websocketInfo(
        `📤 Downloading from Meta | url: ${url.substring(0, 60)}...`,
        String(userId)
      );

      loggerV2.websocketDebug(
        `📤 Request headers | has_auth: ${Boolean(accessToken)} | auth_preview: ${accessToken ? accessToken.substring(0, 20) + '...' : 'none'}`,
        String(userId)
      );

      // Download media from URL
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 300
      });

      loggerV2.websocketDebug(
        `📤 Meta response | status: ${response.status} | content-type: ${response.headers['content-type']} | size: ${response.data?.length || 0}`,
        String(userId)
      );

      const buffer = Buffer.from(response.data);

      loggerV2.websocketInfo(
        `📤 Downloaded from Meta | size: ${buffer.length} bytes | uploading to Wasabi: ${wasabiPath}`,
        String(userId)
      );

      // Upload to Wasabi
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath,
        Body: buffer,
        ContentType: mimeType || response.headers['content-type'] || 'application/octet-stream',
        ACL: 'private'
      });

      await this.s3Client.send(command);

      loggerV2.websocketSuccess(
        `📤 Uploaded to Wasabi | path: ${wasabiPath} | size: ${buffer.length} bytes`,
        String(userId)
      );

      return {
        success: true,
        wasabiPath,
        fileSize: buffer.length,
        mimeType: mimeType || response.headers['content-type']
      };
    } catch (error) {
      const errorDetails = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data ? Buffer.from(error.response.data).toString('utf8').substring(0, 500) : null,
        url: url?.substring(0, 100)
      };
      
      loggerV2.websocketError(
        `📤 Meta download failed | status: ${error.response?.status} | error: ${error.message} | url: ${url?.substring(0, 60)}`,
        String(userId)
      );

      if (error.response?.data) {
        try {
          const responseText = Buffer.from(error.response.data).toString('utf8');
          loggerV2.websocketDebug(
            `📤 Meta error response | body: ${responseText.substring(0, 300)}`,
            String(userId)
          );
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      return {
        success: false,
        error: error.message,
        details: errorDetails
      };
    }
  }

  /**
   * Upload media to Wasabi from buffer
   */
  async uploadFromBuffer(buffer, wasabiPath, mimeType, userId = 'system') {
    try {
      loggerV2.websocketInfo(
        `📤 Uploading buffer to Wasabi | path: ${wasabiPath} | size: ${buffer.length} bytes`,
        String(userId)
      );

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
        ACL: 'private'
      });

      await this.s3Client.send(command);

      loggerV2.websocketSuccess(
        `📤 Successfully uploaded to Wasabi | path: ${wasabiPath} | size: ${buffer.length} bytes`,
        String(userId)
      );

      return {
        success: true,
        wasabiPath,
        fileSize: buffer.length,
        mimeType
      };
    } catch (error) {
      loggerV2.websocketError(
        `📤 Wasabi buffer upload error | path: ${wasabiPath} | error: ${error.message}`,
        String(userId)
      );
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if media exists in Wasabi
   */
  async exists(wasabiPath) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get signed URL for media (valid for 1 hour)
   */
  async getSignedUrl(wasabiPath, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;
    } catch (error) {
      console.error('❌ Error generating signed URL:', error.message);
      throw error;
    }
  }

  /**
   * Stream media from Wasabi
   */
  async streamMedia(wasabiPath, userId = 'system') {
    try {
      loggerV2.websocketDebug(
        `📥 Fetching from Wasabi | path: ${wasabiPath}`,
        String(userId)
      );

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath
      });

      const response = await this.s3Client.send(command);
      
      loggerV2.websocketSuccess(
        `📥 Wasabi stream ready | path: ${wasabiPath} | size: ${response.ContentLength || 'unknown'}`,
        String(userId)
      );

      return {
        success: true,
        stream: response.Body,
        contentType: response.ContentType,
        contentLength: response.ContentLength
      };
    } catch (error) {
      loggerV2.websocketError(
        `📥 Wasabi stream error | path: ${wasabiPath} | error: ${error.message}`,
        String(userId)
      );
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete media from Wasabi
   */
  async deleteObject(wasabiPath, userId = 'system') {
    try {
      loggerV2.websocketInfo(
        `🗑️ Deleting from Wasabi | path: ${wasabiPath}`,
        String(userId)
      );

      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: wasabiPath
      });

      await this.s3Client.send(command);

      loggerV2.websocketSuccess(
        `🗑️ Deleted from Wasabi | path: ${wasabiPath}`,
        String(userId)
      );

      return { success: true };
    } catch (error) {
      loggerV2.websocketError(
        `🗑️ Wasabi delete error | path: ${wasabiPath} | error: ${error.message}`,
        String(userId)
      );

      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new WasabiStorage();
