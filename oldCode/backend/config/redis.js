const Redis = require('ioredis');
const logger = require('../utils/logger');

// Redis connection options
const REDIS_OPTIONS = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => {
    return Math.min(times * 50, 2000); // Exponential backoff capped at 2 seconds
  }
};

// Create a singleton Redis client
let redisClient = null;

/**
 * Get the Redis client instance (creates one if it doesn't exist)
 * @returns {Redis} Redis client instance
 */
function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(REDIS_OPTIONS);
    
    // Handle connection events
    redisClient.on('error', (err) => {
      logger.error(`Redis connection error: ${err.message}`);
    });
    
    redisClient.on('connect', () => {
      logger.info('Connected to Redis server');
    });
    
    redisClient.on('reconnecting', () => {
      logger.info('Reconnecting to Redis server');
    });
  }
  
  return redisClient;
}

/**
 * Create a new Redis client (for cases where you need a separate connection)
 * @returns {Redis} New Redis client
 */
function createNewRedisClient() {
  const client = new Redis(REDIS_OPTIONS);
  
  client.on('error', (err) => {
    logger.error(`Redis client error: ${err.message}`);
  });
  
  return client;
}

/**
 * Gracefully close the Redis connection
 * @returns {Promise<void>}
 */
async function closeRedisConnection() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

/**
 * Set a key with a TTL
 * @param {string} key - Redis key
 * @param {string|object} value - Value to store (objects will be JSON stringified)
 * @param {number} ttlSeconds - Time to live in seconds
 * @param {boolean} nx - If true, only set the key if it does not already exist
 * @returns {Promise<boolean>} - True if successful
 */
async function setWithTTL(key, value, ttlSeconds, nx = false) {
  const client = getRedisClient();
  const strValue = typeof value === 'object' ? JSON.stringify(value) : value;
  
  try {
    const options = nx ? ['EX', ttlSeconds, 'NX'] : ['EX', ttlSeconds];
    const result = await client.set(key, strValue, ...options);
    return result === 'OK';
  } catch (error) {
    logger.error(`Redis setWithTTL error for key ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Check if a key exists
 * @param {string} key - Redis key
 * @returns {Promise<boolean>} - True if the key exists
 */
async function keyExists(key) {
  const client = getRedisClient();
  
  try {
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    logger.error(`Redis keyExists error for key ${key}: ${error.message}`);
    return false;
  }
}

/**
 * Delete a key
 * @param {string} key - Redis key
 * @returns {Promise<boolean>} - True if successful
 */
async function deleteKey(key) {
  const client = getRedisClient();
  
  try {
    await client.del(key);
    return true;
  } catch (error) {
    logger.error(`Redis deleteKey error for key ${key}: ${error.message}`);
    return false;
  }
}

module.exports = {
  getRedisClient,
  createNewRedisClient,
  closeRedisConnection,
  setWithTTL,
  keyExists,
  deleteKey
}; 