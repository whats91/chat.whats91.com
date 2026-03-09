export type PubSubEventType = 'new_message' | 'status_update' | 'conversation_update';

export interface PubSubEvent {
  type: PubSubEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface PubSubNewMessageEvent extends PubSubEvent {
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
      isPinned?: boolean;
      isStarred?: boolean;
      incomingPayload?: Record<string, unknown> | null;
      outgoingPayload?: Record<string, unknown> | null;
    };
  };
}

export interface PubSubStatusUpdateEvent extends PubSubEvent {
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

export interface PubSubConversationUpdateEvent extends PubSubEvent {
  type: 'conversation_update';
  data: {
    conversationId: number;
    userId: string;
    updates: Record<string, unknown>;
  };
}

export interface LegacyPubSubStatusPayload {
  type: 'status';
  messageId: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | string;
  conversationId?: number | string;
}

export interface LegacyPubSubMessagePayload {
  type: string;
  messageId?: string;
  timestamp?: string | number;
  from?: string;
  to?: string;
  direction?: 'inbound' | 'outbound';
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | string;
  contactName?: string;
  contactPhone?: string;
  businessPhoneNumber?: string;
  conversation?: {
    id?: number | string;
    unreadCount?: number;
    totalMessages?: number;
    lastMessageAt?: string;
  } | null;
  messageRecord?: {
    id?: number | string;
    messageContent?: string | null;
    messageType?: string | null;
    timestamp?: string;
    outgoingPayload?: Record<string, unknown> | string | null;
    incomingPayload?: Record<string, unknown> | string | null;
  } | null;
  content?: {
    type?: string;
    text?: string | null;
    payload?: Record<string, unknown> | string | null;
    media?: {
      url?: string | null;
      mimeType?: string | null;
      filename?: string | null;
      caption?: string | null;
    } | null;
    interactive?: Record<string, unknown> | null;
    location?: Record<string, unknown> | null;
    contacts?: Record<string, unknown>[] | null;
  } | null;
  webhook?: Record<string, unknown> | string | null;
  source?: string;
  processedAt?: string;
}

export type PubSubClientPayload =
  | PubSubNewMessageEvent
  | PubSubStatusUpdateEvent
  | PubSubConversationUpdateEvent
  | LegacyPubSubStatusPayload
  | LegacyPubSubMessagePayload;

export type PubSubTransportEnvelope =
  | {
      type: 'connected';
      channel?: string;
      clientId?: string;
    }
  | {
      type: 'subscribed';
      channel: string;
      subscriberId: string;
    }
  | {
      type: 'message';
      id: string;
      channel: string;
      payload: PubSubClientPayload;
    }
  | {
      type: 'error';
      message: string;
    };
