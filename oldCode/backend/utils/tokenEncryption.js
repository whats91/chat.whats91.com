const crypto = require('crypto');

/**
 * Token Encryption Utility
 * 
 * Provides secure encryption and decryption for sensitive WhatsApp access tokens.
 * Uses AES-256-GCM encryption with a secret key from environment variables.
 * 
 * Environment Variable Required:
 * - WHATSAPP_TOKEN_ENCRYPTION_KEY: 32-byte (64 hex chars) encryption key
 * 
 * Security Features:
 * - AES-256-GCM authenticated encryption
 * - Random IV for each encryption (prevents pattern analysis)
 * - Authentication tag for integrity verification
 * - Fails safely if encryption key is missing or invalid
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * @returns {Buffer} The encryption key
 * @throws {Error} If key is missing or invalid
 */
function getEncryptionKey() {
  const key = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error(
      'WHATSAPP_TOKEN_ENCRYPTION_KEY is not set in environment variables. ' +
      'Please add a 64-character hex string to your .env file.'
    );
  }
  
  // Convert hex string to buffer
  const keyBuffer = Buffer.from(key, 'hex');
  
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `WHATSAPP_TOKEN_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
      `Current length: ${keyBuffer.length} bytes. ` +
      `Generate a new key with: node -e "console.log(crypto.randomBytes(32).toString('hex'))"`
    );
  }
  
  return keyBuffer;
}

/**
 * Encrypt a plaintext WhatsApp access token
 * 
 * @param {string} plainToken - The plaintext access token
 * @returns {string|null} Encrypted token in format: iv:authTag:encryptedData (hex), or null if input is null/empty
 * @throws {Error} If encryption fails or key is invalid
 */
function encryptAccessToken(plainToken) {
  // Handle null/empty tokens gracefully
  if (!plainToken || plainToken.trim() === '') {
    return null;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt the token
    let encrypted = cipher.update(plainToken, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encryptedData (all in hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('❌ Token encryption failed:', error.message);
    throw new Error(`Failed to encrypt access token: ${error.message}`);
  }
}

/**
 * Decrypt an encrypted WhatsApp access token
 * 
 * @param {string} encryptedToken - The encrypted token (format: iv:authTag:encryptedData)
 * @returns {string|null} Decrypted plaintext token, or null if input is null/empty
 * @throws {Error} If decryption fails, format is invalid, or authentication fails
 */
function decryptAccessToken(encryptedToken) {
  // Handle null/empty tokens gracefully
  if (!encryptedToken || encryptedToken.trim() === '') {
    return null;
  }
  
  try {
    const key = getEncryptionKey();
    
    // Parse the encrypted token format
    const parts = encryptedToken.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted token format. Expected format: iv:authTag:encryptedData'
      );
    }
    
    const [ivHex, authTagHex, encryptedData] = parts;
    
    // Convert from hex
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // Validate lengths
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
    }
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt the token
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Token decryption failed:', error.message);
    throw new Error(`Failed to decrypt access token: ${error.message}`);
  }
}

/**
 * Generate a new encryption key (for setup purposes)
 * 
 * @returns {string} A new 64-character hex string suitable for WHATSAPP_TOKEN_ENCRYPTION_KEY
 */
function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Check if a token is encrypted (has the expected format)
 * 
 * @param {string} token - The token to check
 * @returns {boolean} True if token appears to be encrypted
 */
function isTokenEncrypted(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }
  
  // Check for expected format: hex:hex:hex (3 parts separated by colons)
  const parts = token.split(':');
  if (parts.length !== 3) {
    return false;
  }
  
  // Check if parts look like hex strings
  const hexRegex = /^[0-9a-f]+$/i;
  return parts.every(part => hexRegex.test(part));
}

module.exports = {
  encryptAccessToken,
  decryptAccessToken,
  generateEncryptionKey,
  isTokenEncrypted
};
