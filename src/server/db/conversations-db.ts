import 'server-only';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@/lib/logger';

const log = new Logger('ConversationsDB');

export interface ConversationDbConfig {
  url: string;
  database: string;
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
  phoneNumber: string | null;
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
  isBlocked: boolean;
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

export interface ConversationMessageHistory {
  id: number;
  whatsappMessageId: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseDatabaseName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

function getConversationsDbConfig(): ConversationDbConfig {
  const url = process.env.CONVERSATIONS_DATABASE_URL || process.env.DATABASE_URL || '';
  return {
    url,
    database: parseDatabaseName(url),
  };
}

const globalForConversationsDb = globalThis as typeof globalThis & {
  __whats91ConversationsDb?: PrismaClient;
  __whats91ConversationsDbUrl?: string;
};

function createConversationsDbClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
    log: process.env.ENABLE_DB_QUERY_LOGGING === 'true'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });
}

export function getConversationsDb(): PrismaClient {
  const { url } = getConversationsDbConfig();

  if (!url) {
    throw new Error('CONVERSATIONS_DATABASE_URL or DATABASE_URL must be set');
  }

  if (
    !globalForConversationsDb.__whats91ConversationsDb ||
    globalForConversationsDb.__whats91ConversationsDbUrl !== url
  ) {
    globalForConversationsDb.__whats91ConversationsDb = createConversationsDbClient(url);
    globalForConversationsDb.__whats91ConversationsDbUrl = url;
    log.info('Conversations Prisma client initialized', { database: parseDatabaseName(url) });
  }

  return globalForConversationsDb.__whats91ConversationsDb;
}

let isConnected = false;

export function isConversationsDbConnected(): boolean {
  return isConnected;
}

export function getConversationsDbName(): string {
  return getConversationsDbConfig().database;
}

function normalizeSql(sql: string): string {
  return sql.replace(/datetime\('now'\)/g, 'CURRENT_TIMESTAMP');
}

export async function queryConversationsDb<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const conversationsDb = getConversationsDb();
    const result = await conversationsDb.$queryRawUnsafe(normalizeSql(sql), ...params);
    return result as T[];
  } catch (error) {
    log.error('Query error', { error: error instanceof Error ? error.message : error });
    throw error;
  }
}

export async function executeConversationsDb(
  sql: string,
  params: unknown[] = []
): Promise<{ affectedRows: number; insertId: number }> {
  try {
    const conversationsDb = getConversationsDb();
    const result = await conversationsDb.$executeRawUnsafe(normalizeSql(sql), ...params);
    return { affectedRows: result, insertId: 0 };
  } catch (error) {
    log.error('Execute error', { error: error instanceof Error ? error.message : error });
    throw error;
  }
}

export async function testConversationsDbConnection(): Promise<boolean> {
  try {
    const conversationsDb = getConversationsDb();
    await conversationsDb.$queryRawUnsafe('SELECT 1');
    log.info('Connection test passed');
    isConnected = true;
    return true;
  } catch (error) {
    log.error('Connection test failed', { error: error instanceof Error ? error.message : error });
    isConnected = false;
    return false;
  }
}

export async function closeConversationsDb(): Promise<void> {
  if (globalForConversationsDb.__whats91ConversationsDb) {
    await globalForConversationsDb.__whats91ConversationsDb.$disconnect();
    delete globalForConversationsDb.__whats91ConversationsDb;
    delete globalForConversationsDb.__whats91ConversationsDbUrl;
    isConnected = false;
    log.info('Connection closed');
  }
}

export const conversationsDb = {
  query: queryConversationsDb,
  execute: executeConversationsDb,
  getClient: getConversationsDb,
  isConnected: isConversationsDbConnected,
  testConnection: testConversationsDbConnection,
  getName: getConversationsDbName,
  close: closeConversationsDb,
};

export default conversationsDb;
