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

const log = new Logger('PubSub');

// Event types
export type PubSubEventType = 'new_message' | 'status_update' | 'conversation_update';

export interface PubSubEvent {
  type: PubSubEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface NewMessageEvent extends PubSubEvent {
  type: 'new_message';
  data: {
    conversation: {
      id: number;
      contactPhone: string;
      contactName: string | null;
    };
    messageRecord: {
      id: number;
      whatsappMessageId: string;
      direction: 'inbound' | 'outbound';
      messageType: string;
      messageContent: string | null;
      status: string;
      timestamp: string;
      mediaUrl?: string | null;
      mediaMimeType?: string | null;
      mediaFilename?: string | null;
      incomingPayload?: Record<string, unknown> | null;
      outgoingPayload?: Record<string, unknown> | null;
    };
  };
}

export interface StatusUpdateEvent extends PubSubEvent {
  type: 'status_update';
  data: {
    messageId: string;
    conversationId: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    errorCode?: string;
    errorMessage?: string;
  };
}

export interface ConversationUpdateEvent extends PubSubEvent {
  type: 'conversation_update';
  data: {
    conversationId: number;
    userId: string;
    updates: Record<string, unknown>;
  };
}

// Callback type
export type PubSubCallback = (event: PubSubEvent) => void;

// In-memory subscriber storage for fallback
const memorySubscribers = new Map<string, Set<PubSubCallback>>();

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
    
    // Try Redis first
    const redis = await getRedisClient();
    await redis.publish(channel, message);
    
    // Also handle in-memory subscribers
    const callbacks = memorySubscribers.get(channel);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(event);
        } catch (error) {
          log.error('Callback error', { error });
        }
      });
    }
    
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
  
  // Add to in-memory subscribers
  if (!memorySubscribers.has(channel)) {
    memorySubscribers.set(channel, new Set());
  }
  memorySubscribers.get(channel)!.add(callback);
  
  // Also subscribe via Redis
  try {
    const redis = await getRedisClient();
    await redis.subscribe(channel, (message: string) => {
      try {
        const event = JSON.parse(message) as PubSubEvent;
        log.debug('Received Redis message', { type: event.type });
        callback(event);
      } catch (error) {
        log.error('Parse error', { error });
      }
    });
  } catch (error) {
    log.warn('Subscribe error, using in-memory fallback', { error });
  }
  
  log.info('Subscribed to channel', { channel });
  
  // Return unsubscribe function
  return () => {
    const callbacks = memorySubscribers.get(channel);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        memorySubscribers.delete(channel);
      }
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
