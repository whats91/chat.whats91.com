// Event types and event application logic for webhook-ready architecture

import type {
  DomainEvent,
  Conversation,
  Message,
  User,
  InboundMessagePayload,
  MessageDeliveryPayload,
  ConversationReadPayload,
  UserStatusPayload,
  TypingIndicatorPayload,
} from '../types/chat';

// Re-export types
export type {
  DomainEvent,
  Conversation,
  Message,
  User,
  InboundMessagePayload,
  MessageDeliveryPayload,
  ConversationReadPayload,
  UserStatusPayload,
  TypingIndicatorPayload,
};

// Event application functions - these will be used to update UI state
// when real webhooks are connected

export function applyInboundMessage(
  conversation: Conversation,
  message: Message
): Conversation {
  return {
    ...conversation,
    lastMessage: message,
    unreadCount: conversation.unreadCount + 1,
    updatedAt: message.timestamp,
  };
}

export function applyMessageDelivery(
  message: Message,
  status: Message['status'],
  timestamp: Date
): Message {
  return {
    ...message,
    status,
    timestamp,
  };
}

export function applyReadState(
  conversation: Conversation,
  _readBy: string
): Conversation {
  return {
    ...conversation,
    unreadCount: 0,
  };
}

export function applyUserStatus(
  user: User,
  status: User['status'],
  lastSeen?: Date
): User {
  return {
    ...user,
    status,
    lastSeen: lastSeen ?? user.lastSeen,
  };
}

export function applyTypingIndicator(
  conversation: Conversation,
  userId: string,
  isTyping: boolean
): Conversation {
  return {
    ...conversation,
    typing: {
      isTyping,
      userId: isTyping ? userId : undefined,
    },
    participant: isTyping
      ? { ...conversation.participant, status: 'typing' }
      : conversation.participant,
  };
}

// Event factory functions
export function createInboundMessageEvent(
  message: Message,
  conversationId: string,
  from: string,
  tenantId: string
): DomainEvent<InboundMessagePayload> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'InboundMessageReceived',
    timestamp: new Date(),
    tenantId,
    payload: {
      message,
      conversationId,
      from,
    },
  };
}

export function createMessageDeliveryEvent(
  messageId: string,
  conversationId: string,
  status: Message['status'],
  tenantId: string
): DomainEvent<MessageDeliveryPayload> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'MessageDeliveryUpdated',
    timestamp: new Date(),
    tenantId,
    payload: {
      messageId,
      conversationId,
      status,
      timestamp: new Date(),
    },
  };
}

export function createReadStateEvent(
  conversationId: string,
  readBy: string,
  tenantId: string
): DomainEvent<ConversationReadPayload> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'ConversationReadStateUpdated',
    timestamp: new Date(),
    tenantId,
    payload: {
      conversationId,
      readBy,
      timestamp: new Date(),
    },
  };
}

export function createUserStatusEvent(
  userId: string,
  status: User['status'],
  tenantId: string,
  lastSeen?: Date
): DomainEvent<UserStatusPayload> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'UserStatusChanged',
    timestamp: new Date(),
    tenantId,
    payload: {
      userId,
      status,
      lastSeen,
    },
  };
}

export function createTypingIndicatorEvent(
  conversationId: string,
  userId: string,
  isTyping: boolean,
  tenantId: string
): DomainEvent<TypingIndicatorPayload> {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'TypingIndicatorChanged',
    timestamp: new Date(),
    tenantId,
    payload: {
      conversationId,
      userId,
      isTyping,
    },
  };
}
