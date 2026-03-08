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
const DEFAULT_EXTERNAL_PUBSUB_SERVICE_URL =
  'http://pubsub-service.botmastersender.com';

function normalizePubSubServiceUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    }

    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getExternalPubSubServiceUrl(): string | null {
  const resolvedUrl = normalizePubSubServiceUrl(
    process.env.PUBSUB_SERVICE_URL ||
      process.env.PUBSUB_URL ||
      process.env.NEXT_PUBLIC_PUBSUB_URL ||
      DEFAULT_EXTERNAL_PUBSUB_SERVICE_URL
  );

  log.info('Resolved external pubsub service URL', {
    configuredPubSubServiceUrl: process.env.PUBSUB_SERVICE_URL || null,
    configuredPubSubUrl: process.env.PUBSUB_URL || null,
    configuredPublicPubSubUrl: process.env.NEXT_PUBLIC_PUBSUB_URL || null,
    resolvedUrl,
  });

  return resolvedUrl;
}

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
  const channel = getChannelName(userId);

  try {
    log.info('Attempting local pubsub publish', {
      channel,
      userId: String(userId),
      eventType: event.type,
      event,
    });
    const redis = await getRedisClient();
    await redis.publish(channel, JSON.stringify(event));

    log.info('Published event', {
      type: event.type,
      channel,
      userId: String(userId),
    });
  } catch (error) {
    log.error('Local publish error', { error, channel, userId: String(userId) });
  }

  const externalPubSubUrl = getExternalPubSubServiceUrl();
  if (!externalPubSubUrl) {
    log.warn('Skipping external pubsub publish because no service URL is configured', {
      channel,
      userId: String(userId),
      eventType: event.type,
    });
    return;
  }

  try {
    log.info('Attempting external pubsub publish', {
      channel,
      userId: String(userId),
      eventType: event.type,
      url: externalPubSubUrl,
      event,
    });
    const response = await fetch(
      `${externalPubSubUrl}/api/publish/${encodeURIComponent(channel)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'whats91-chat',
          'X-User-ID': String(userId),
        },
        body: JSON.stringify({
          payload: event,
        }),
        cache: 'no-store',
      }
    );

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: ${responseText}`
      );
    }

    log.info('Published event to external pubsub service', {
      type: event.type,
      channel,
      userId: String(userId),
      url: externalPubSubUrl,
      responseStatus: response.status,
      responseText,
    });
  } catch (error) {
    log.error('External pubsub publish error', {
      error: error instanceof Error ? error.message : error,
      channel,
      userId: String(userId),
      url: externalPubSubUrl,
    });
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
  log.info('Preparing subscription', {
    channel,
    userId: String(userId),
    note: 'This subscription is only used by the local in-process pubsub path.',
  });
  const redisHandler = (message: string) => {
    try {
      const event = JSON.parse(message) as PubSubEvent;
      log.debug('Received pubsub message', {
        type: event.type,
        channel,
        userId: String(userId),
      });
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
  log.debug('Queueing new_message event', {
    userId: String(userId),
    conversationId: conversation.id,
    messageId: messageRecord.id,
    whatsappMessageId: messageRecord.whatsappMessageId,
    direction: messageRecord.direction,
  });
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
  log.debug('Queueing status_update event', {
    userId: String(userId),
    conversationId: data.conversationId,
    messageId: data.messageId,
    status: data.status,
  });
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
