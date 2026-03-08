/**
 * Pub/Sub Service for Real-time Messaging
 * 
 * This module provides real-time message delivery using Redis Pub/Sub.
 * Falls back to in-memory pub/sub when Redis is not available.
 * 
 * Channel naming: conversations-{userId}
 * 
 * Event types:
 * - new_message: New incoming/outgoing message
 * - status_update: Message status change (sent, delivered, read, failed)
 * - conversation_update: Conversation metadata change
 */

import 'server-only';
import { getRedisClient } from '../db/redis';
import { Logger } from '@/lib/logger';
import type {
  PubSubConversationUpdateEvent as ConversationUpdateEvent,
  PubSubEvent,
  PubSubEventType,
  PubSubNewMessageEvent as NewMessageEvent,
  PubSubStatusUpdateEvent as StatusUpdateEvent,
} from '@/lib/types/pubsub';

const log = new Logger('PubSub');

// Callback type
export type PubSubCallback = (event: PubSubEvent) => void;

/**
 * Get channel name for a user
 */
export function getChannelName(userId: string | number | bigint): string {
  return `conversations-${userId}`;
}

/**
 * Publish an event to a user's channel
 */
export async function publishToUser(
  userId: string | number | bigint,
  event: PubSubEvent
): Promise<void> {
  try {
    const channel = getChannelName(userId);
    const message = JSON.stringify(event);
    
    const redis = await getRedisClient();
    await redis.publish(channel, message);

    log.info('Published event', { type: event.type, channel });
  } catch (error) {
    log.error('Publish error', { error });
  }
}

/**
 * Subscribe to a user's channel
 */
export async function subscribeToUser(
  userId: string | number | bigint,
  callback: PubSubCallback
): Promise<() => void> {
  const channel = getChannelName(userId);
  const redis = await getRedisClient();
  const redisHandler = (message: string) => {
    try {
      const event = JSON.parse(message) as PubSubEvent;
      log.debug('Received pubsub message', { type: event.type, channel });
      callback(event);
    } catch (error) {
      log.error('Parse error', { error, channel });
    }
  };

  try {
    await redis.subscribe(channel, redisHandler);
  } catch (error) {
    log.warn('Subscribe error', { error, channel });
  }
  
  log.info('Subscribed to channel', { channel });
  
  return async () => {
    if (typeof redis.unsubscribe === 'function') {
      await redis.unsubscribe(channel, redisHandler);
    }
    log.debug('Unsubscribed from channel', { channel });
  };
}

/**
 * Publish a new message event
 */
export async function publishNewMessage(
  userId: string | number | bigint,
  conversation: { id: number; contactPhone: string; contactName: string | null },
  messageRecord: {
    id: number;
    whatsappMessageId: string;
    direction: 'inbound' | 'outbound';
    messageType: string;
    messageContent: string | null;
    status: string;
    timestamp: Date | string;
    mediaUrl?: string | null;
    mediaMimeType?: string | null;
    mediaFilename?: string | null;
    isPinned?: boolean;
    isStarred?: boolean;
    incomingPayload?: Record<string, unknown> | null;
    outgoingPayload?: Record<string, unknown> | null;
  }
): Promise<void> {
  const event: NewMessageEvent = {
    type: 'new_message',
    timestamp: new Date().toISOString(),
    data: {
      conversation,
      messageRecord: {
        ...messageRecord,
        timestamp: typeof messageRecord.timestamp === 'string' 
          ? messageRecord.timestamp 
          : messageRecord.timestamp.toISOString(),
      },
    },
  };
  
  await publishToUser(userId, event);
}

/**
 * Publish a status update event
 */
export async function publishStatusUpdate(
  userId: string | number | bigint,
  data: {
    messageId: string;
    conversationId: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    errorCode?: string;
    errorMessage?: string;
  }
): Promise<void> {
  const event: StatusUpdateEvent = {
    type: 'status_update',
    timestamp: new Date().toISOString(),
    data: {
      ...data,
      timestamp: new Date().toISOString(),
    },
  };
  
  await publishToUser(userId, event);
}

/**
 * Publish a conversation update event
 */
export async function publishConversationUpdate(
  userId: string | number | bigint,
  conversationId: number,
  updates: Record<string, unknown>
): Promise<void> {
  const event: ConversationUpdateEvent = {
    type: 'conversation_update',
    timestamp: new Date().toISOString(),
    data: {
      conversationId,
      userId: String(userId),
      updates,
    },
  };
  
  await publishToUser(userId, event);
}

// Export a pubsub instance
export const pubsub = {
  getChannelName,
  publish: publishToUser,
  subscribe: subscribeToUser,
  publishNewMessage,
  publishStatusUpdate,
  publishConversationUpdate,
};

export default pubsub;
