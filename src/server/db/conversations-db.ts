/**
 * Conversations Database Connection Module
 * 
 * This module provides MySQL connection for the conversations database.
 * Separate from the main database to handle high-volume chat traffic.
 * 
 * Database: whats91_chat_conversations (or configured CONVERSATIONS_DB_NAME)
 * Tables: conversations, conversation_messages, media_storage, message_reactions
 * 
 * NOTE: For Prisma to work with a second database, you need to:
 * 1. Generate a separate client: npx prisma generate --schema=prisma/schema-conversations.prisma
 * 2. Or use raw SQL queries through the main Prisma client with dynamic datasource
 */

import 'server-only';
import { Logger } from '@/lib/logger';

const log = new Logger('ConversationsDB');

// Type definitions
export interface ConversationDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export interface ConversationMessage {
  id: number;
  conversationId: number;
  whatsappMessageId: string;
  fromPhone: string;
  toPhone: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  messageContent: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaCaption: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  isRead: boolean;
  readAt: Date | null;
  repliedToMessageId: string | null;
  forwardedFrom: string | null;
  interactiveData: Record<string, unknown> | null;
  locationData: Record<string, unknown> | null;
  contactData: Record<string, unknown> | null;
  timestamp: Date;
  errorMessage: string | null;
  webhookData: Record<string, unknown> | null;
  outgoingPayload: Record<string, unknown> | null;
  incomingPayload: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: number;
  userId: bigint;
  contactPhone: string;
  contactId: bigint | null;
  contactName: string | null;
  whatsappPhoneNumberId: string;
  lastMessageId: string | null;
  lastMessageContent: string | null;
  lastMessageType: string | null;
  lastMessageAt: Date | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  unreadCount: number;
  totalMessages: number;
  isArchived: boolean;
  isPinned: boolean;
  isMuted: boolean;
  status: 'active' | 'closed' | 'blocked';
  metaData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaStorage {
  id: number;
  userId: bigint;
  messageId: string;
  wasabiPath: string;
  mimeType: string | null;
  fileSize: number | null;
  originalFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Database configuration from environment
const getConversationsDbConfig = (): ConversationDbConfig => ({
  host: process.env.CONVERSATIONS_DB_HOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.CONVERSATIONS_DB_PORT || process.env.DB_PORT || '3306'),
  user: process.env.CONVERSATIONS_DB_USER || process.env.DB_USER || 'root',
  password: process.env.CONVERSATIONS_DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.CONVERSATIONS_DB_NAME || 'whats91_chat_conversations',
  connectionLimit: 5,
});

// Connection state
let isConnected = false;

/**
 * Check if the conversations database is connected
 */
export function isConversationsDbConnected(): boolean {
  return isConnected;
}

/**
 * Get the database name
 */
export function getConversationsDbName(): string {
  return getConversationsDbConfig().database;
}

/**
 * Execute a query on the conversations database
 * Uses Prisma's $queryRaw with dynamic database selection
 * 
 * NOTE: This requires the DATABASE_URL to point to the conversations database
 * or use raw SQL with explicit database prefix
 */
export async function queryConversationsDb<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    // Import db dynamically to avoid circular dependencies
    const { db } = await import('./mysql');
    
    // For raw queries, we need to use the database prefix
    // since Prisma's $queryRaw doesn't support dynamic database selection
    const dbName = getConversationsDbName();
    const prefixedSql = sql.replace(/`?conversations`?/g, `\`${dbName}\`.conversations`)
      .replace(/`?conversation_messages`?/g, `\`${dbName}\`.conversation_messages`)
      .replace(/`?media_storage`?/g, `\`${dbName}\`.media_storage`);
    
    const result = await db.$queryRawUnsafe(prefixedSql, ...params);
    return result as T[];
  } catch (error) {
    log.error('Query error', { error: error instanceof Error ? error.message : error });
    throw error;
  }
}

/**
 * Execute a raw SQL command (INSERT, UPDATE, DELETE)
 */
export async function executeConversationsDb(
  sql: string,
  params: unknown[] = []
): Promise<{ affectedRows: number; insertId: number }> {
  try {
    const { db } = await import('./mysql');
    
    const dbName = getConversationsDbName();
    const prefixedSql = sql.replace(/`?conversations`?/g, `\`${dbName}\`.conversations`)
      .replace(/`?conversation_messages`?/g, `\`${dbName}\`.conversation_messages`)
      .replace(/`?media_storage`?/g, `\`${dbName}\`.media_storage`);
    
    const result = await db.$executeRawUnsafe(prefixedSql, ...params);
    return { affectedRows: result, insertId: 0 };
  } catch (error) {
    log.error('Execute error', { error: error instanceof Error ? error.message : error });
    throw error;
  }
}

/**
 * Test the database connection
 */
export async function testConversationsDbConnection(): Promise<boolean> {
  try {
    const { db } = await import('./mysql');
    await db.$queryRawUnsafe(`SELECT 1`);
    log.info('Connection test passed');
    isConnected = true;
    return true;
  } catch (error) {
    log.error('Connection test failed', { error: error instanceof Error ? error.message : error });
    isConnected = false;
    return false;
  }
}

// Export a simplified query interface
export const conversationsDb = {
  query: queryConversationsDb,
  execute: executeConversationsDb,
  isConnected: isConversationsDbConnected,
  testConnection: testConversationsDbConnection,
  getName: getConversationsDbName,
};

export default conversationsDb;
