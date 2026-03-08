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

export type PubSubClientPayload =
  | PubSubNewMessageEvent
  | PubSubStatusUpdateEvent
  | PubSubConversationUpdateEvent;

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
