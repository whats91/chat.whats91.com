/**
 * Secondary Database Configuration for Conversations
 * 
 * This database is used to store conversations and conversation messages
 * to reduce load on the main database and avoid connection errors at scale.
 * 
 * Database: botmaster_centerdesk_conversation
 */

const { Sequelize } = require('sequelize');
require('dotenv').config({ path: './.env' });

// Conversations database configuration - can use separate credentials
const CONVERSATIONS_DB_NAME = process.env.CONVERSATIONS_DB_NAME || 'botmaster_centerdesk_conversation';
const CONVERSATIONS_DB_USER = process.env.CONVERSATIONS_DB_USER || process.env.DB_USER;
const CONVERSATIONS_DB_PASSWORD = process.env.CONVERSATIONS_DB_PASSWORD || process.env.DB_PASSWORD;
const CONVERSATIONS_DB_HOST = process.env.CONVERSATIONS_DB_HOST || process.env.DB_HOST;

const conversationsSequelize = new Sequelize(
  CONVERSATIONS_DB_NAME,
  CONVERSATIONS_DB_USER,
  CONVERSATIONS_DB_PASSWORD,
  {
    host: CONVERSATIONS_DB_HOST,
    dialect: 'mysql',
    port: process.env.CONVERSATIONS_DB_PORT || process.env.DB_PORT || 3306,
    logging: false,
    timezone: '+05:30',
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Track connection status
let isConnected = false;

/**
 * Test the connection to the conversations database
 * @returns {Promise<boolean>} True if connection successful
 */
const testConnection = async () => {
  try {
    await conversationsSequelize.authenticate();
    console.log('💬 Conversations Database connected successfully');
    isConnected = true;
    return true;
  } catch (error) {
    console.error('❌ Conversations Database connection failed:', error.message);
    isConnected = false;
    return false;
  }
};

/**
 * Check if the database is connected
 * @returns {boolean}
 */
const isConversationsDatabaseConnected = () => isConnected;

/**
 * Get the conversations database instance
 * @returns {Sequelize}
 */
const getConversationsDatabase = () => conversationsSequelize;

// Auto-test connection on module load
(async () => {
  try {
    await testConnection();
  } catch (err) {
    console.error('❌ Failed to auto-connect to conversations database:', err.message);
  }
})();

module.exports = {
  conversationsSequelize,
  testConnection,
  isConversationsDatabaseConnected,
  getConversationsDatabase,
  CONVERSATIONS_DB_NAME
};
