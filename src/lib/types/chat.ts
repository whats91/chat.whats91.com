// ========================================
// WHATS91 CHAT - COMPREHENSIVE TYPE DEFINITIONS
// ========================================
// Types based on old Node.js implementation
// ========================================

// ========================================
// USER TYPES
// ========================================

export interface User {
  id: string;
  name: string;
  avatar?: string;
  phone: string;
  email?: string;
  status: 'online' | 'offline' | 'typing';
  lastSeen?: Date;
}

// ========================================
// MESSAGE TYPES
// ========================================

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageType = 
  | 'text' 
  | 'image' 
  | 'video' 
  | 'audio' 
  | 'document' 
  | 'sticker'
  | 'location' 
  | 'contacts' 
  | 'interactive'
  | 'button'
  | 'button_reply'
  | 'list_reply'
  | 'reaction'
  | 'template'
  | 'unknown';

export interface Message {
  id: string;
  conversationId: string;
  whatsappMessageId: string;
  senderId: string;
  fromPhone: string;
  toPhone: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  status: MessageStatus;
  timestamp: Date;
  replyTo?: string;
  
  // Media fields
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFilename?: string | null;
  mediaCaption?: string | null;
  
  // Rich content
  interactiveData?: Record<string, unknown> | null;
  locationData?: LocationData | null;
  contactData?: ContactData[] | null;
  
  // Raw payloads (IMPORTANT: Keep for rendering)
  incomingPayload?: Record<string, unknown> | null;
  outgoingPayload?: Record<string, unknown> | null;
  webhookData?: Record<string, unknown> | null;
  
  // Error handling
  errorMessage?: string | null;
  
  // Read status
  isRead: boolean;
  isPinned: boolean;
  isStarred: boolean;
  readAt?: Date | null;
  
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    thumbnail?: string;
  };
}

// ========================================
// CONVERSATION TYPES
// ========================================

export type ConversationStatus = 'active' | 'closed' | 'blocked';

export interface Conversation {
  id: string;
  userId: string;
  contactPhone: string;
  contactId?: string | null;
  contactName?: string | null;
  whatsappPhoneNumberId: string;
  
  // Last message info
  lastMessageId?: string | null;
  lastMessageContent?: string | null;
  lastMessageType?: MessageType | null;
  lastMessageAt?: Date | null;
  lastMessageDirection?: MessageDirection | null;
  
  // Stats
  unreadCount: number;
  totalMessages: number;
  
  // Status flags
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  isBlocked: boolean;
  status: ConversationStatus;
  
  // Metadata
  metaData?: Record<string, unknown> | null;
  
  // Relations
  participant?: User;
  lastMessage?: Message;
  typing?: {
    isTyping: boolean;
    userId?: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// ========================================
// CONVERSATION LIST ITEM (for API response)
// ========================================

export interface ConversationListItem {
  id: number;
  contactPhone: string;
  contactName: string | null;
  displayName: string;
  lastMessageContent: string | null;
  lastMessageType: string | null;
  lastMessageDirection: MessageDirection | null;
  lastMessageAt: Date | null;
  updatedAt: Date | null;
  lastMessageTimeAgo: string;
  unreadCount: number;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  isBlocked: boolean;
  status: ConversationStatus;
}

// ========================================
// LOCATION & CONTACT DATA
// ========================================

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactData {
  name?: {
    firstName?: string;
    lastName?: string;
    formattedName?: string;
  };
  phones?: Array<{
    phone?: string;
    type?: string;
    wa_id?: string;
  }>;
  emails?: Array<{
    email?: string;
    type?: string;
  }>;
}

// ========================================
// INTERACTIVE MESSAGE TYPES
// ========================================

export interface InteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface InteractiveList {
  type: 'list';
  body: {
    text: string;
  };
  action: {
    button: string;
    sections: Array<{
      title: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

export interface InteractiveCtaUrl {
  type: 'cta_url';
  body: {
    text: string;
  };
  action: {
    name: 'cta_url';
    parameters: {
      display_text: string;
      url: string;
    };
  };
}

export type InteractiveData = 
  | { type: 'button_reply'; button_reply: { id: string; title: string } }
  | { type: 'list_reply'; list_reply: { id: string; title: string; description?: string } }
  | InteractiveButton
  | InteractiveList
  | InteractiveCtaUrl;

// ========================================
// TEMPLATE TYPES
// ========================================

export interface MessageCategory {
  type: 'marketing' | 'utility' | 'authentication' | 'service';
  label: string;
  description: string;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: MessageCategory['type'];
  status: 'approved' | 'pending' | 'rejected';
  components: TemplateComponent[];
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  text?: string;
  parameters?: Record<string, unknown>[];
}

// ========================================
// MEDIA STORAGE
// ========================================

export interface MediaStorageRecord {
  id: number;
  userId: string;
  messageId: string;
  wasabiPath: string;
  mimeType: string | null;
  fileSize: number | null;
  originalFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ========================================
// CLOUD API SETUP
// ========================================

export interface CloudApiSetup {
  id: string;
  uid: string;
  userId: string;
  
  // WhatsApp Configuration
  facebookAppId?: string | null;
  whatsappAccessToken?: string | null;
  whatsappBusinessAccountId?: string | null;
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
  
  // Webhook
  webhookVerifiedAt?: Date | null;
  webhookMessagesFieldVerifiedAt?: Date | null;
  
  // Access flags
  accessChats: boolean;
  
  // Coexistence
  coexistenceEnabled: boolean;
  
  // Two-step verification
  twoStepVerificationEnabled: boolean;
  twoStepVerificationPin?: string | null;
  
  createdAt: Date;
  updatedAt: Date;
}

// ========================================
// TENANT TYPES
// ========================================

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  wabaId?: string;
  phoneNumberId?: string;
  tokenStatus: 'valid' | 'expired' | 'invalid' | 'not_configured';
  tokenExpiresAt?: Date;
  webhookStatus: 'verified' | 'pending' | 'failed' | 'not_configured';
  qualityRating?: 'high' | 'medium' | 'low';
  createdAt: Date;
}

// ========================================
// API RESPONSE TYPES
// ========================================

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: {
    items: T[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
  };
}

export interface ConversationListResponse {
  success: boolean;
  message: string;
  data: {
    conversations: ConversationListItem[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    summary: {
      totalConversations: number;
      unreadConversations: number;
    };
  };
}

export interface ConversationDetailResponse {
  success: boolean;
  message: string;
  data: {
    conversation: {
      id: number;
      displayName: string;
      contactPhone: string;
      contactName: string | null;
      isBlocked: boolean;
      status: ConversationStatus;
    };
    messages: Message[];
    pagination: {
      totalMessages: number;
      currentPage: number;
      messagesPerPage: number;
      hasMore: boolean;
    };
  };
}

export interface PinnedMessageResponse {
  success: boolean;
  message: string;
  data: {
    message: Message | null;
  } | null;
}

export interface StarredMessagesResponse {
  success: boolean;
  message: string;
  data: {
    messages: Message[];
  } | null;
}

export interface ConversationMediaResponse {
  success: boolean;
  message: string;
  data: {
    messages: Message[];
  } | null;
}

export interface ConversationTarget {
  id: string;
  source: 'conversation' | 'contact';
  conversationId: string | null;
  phone: string;
  displayName: string;
  contactName: string | null;
  lastMessageAt: Date | string | null;
}

export interface ConversationTargetListResponse {
  success: boolean;
  message: string;
  data: {
    targets: ConversationTarget[];
  } | null;
}

export interface StartConversationRequest {
  phone: string;
  contactName?: string | null;
}

export interface StartConversationResponse {
  success: boolean;
  message: string;
  data: {
    conversationId: string;
    displayName: string;
    contactPhone: string;
    contactName: string | null;
  } | null;
}

// ========================================
// WHATSAPP API TYPES
// ========================================

export interface WhatsAppMessagePayload {
  messaging_product: 'whatsapp';
  recipient_type?: 'individual';
  to: string;
  type: MessageType;
  text?: { body: string; preview_url?: boolean };
  image?: { id?: string; link?: string; caption?: string };
  video?: { id?: string; link?: string; caption?: string };
  audio?: { id?: string; link?: string; voice?: boolean };
  document?: { id?: string; link?: string; caption?: string; filename?: string };
  location?: LocationData;
  contacts?: ContactData[];
  interactive?: Record<string, unknown>;
  template?: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: 'header' | 'body' | 'button';
      parameters: Record<string, unknown>[];
    }>;
  };
}

export interface WhatsAppApiResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
  statuses?: Array<{
    id: string;
    status: string;
    timestamp: string;
    errors?: Array<{
      code: number;
      title: string;
      message?: string;
    }>;
  }>;
  error?: {
    code: number;
    message: string;
    type: string;
    error_subcode?: number;
  };
}

// ========================================
// WEBHOOK TYPES
// ========================================

export interface WebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: 'whatsapp';
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: {
          name?: string;
        };
        wa_id: string;
      }>;
      messages?: Array<{
        from: string;
        id: string;
        timestamp: string;
        type: string;
        text?: { body: string };
        image?: { id: string; mime_type: string; caption?: string };
        video?: { id: string; mime_type: string; caption?: string };
        audio?: { id: string; mime_type: string };
        document?: { id: string; mime_type: string; filename?: string; caption?: string };
        location?: LocationData;
        contacts?: ContactData[];
        interactive?: Record<string, unknown>;
        button?: Record<string, unknown>;
        context?: {
          from: string;
          id: string;
        };
        reaction?: {
          message_id: string;
          emoji: string;
        };
      }>;
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
        errors?: Array<{
          code: number;
          title: string;
          message?: string;
        }>;
      }>;
    };
    field: string;
  }>;
}

// ========================================
// EVENT TYPES FOR WEBHOOK-READY ARCHITECTURE
// ========================================

export type DomainEventType =
  | 'InboundMessageReceived'
  | 'MessageDeliveryUpdated'
  | 'ConversationCreatedOrMatched'
  | 'ConversationReadStateUpdated'
  | 'UserStatusChanged'
  | 'TypingIndicatorChanged';

export interface DomainEvent<T = unknown> {
  id: string;
  type: DomainEventType;
  timestamp: Date;
  payload: T;
  tenantId: string;
}

export interface InboundMessagePayload {
  message: Message;
  conversationId: string;
  from: string;
}

export interface MessageDeliveryPayload {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
  timestamp: Date;
}

export interface ConversationReadPayload {
  conversationId: string;
  readBy: string;
  timestamp: Date;
}

export interface UserStatusPayload {
  userId: string;
  status: User['status'];
  lastSeen?: Date;
}

export interface TypingIndicatorPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

// ========================================
// SEND MESSAGE REQUEST
// ========================================

export interface SendMessageRequest {
  messageType: MessageType;
  messageContent?: string;
  mediaUrl?: string;
  mediaUploadToken?: string;
  isVoiceMessage?: boolean;
  forwardSourceMessageId?: string;
  mediaCaption?: string;
  replyToMessageId?: string;
  interactiveData?: Record<string, unknown>;
  locationData?: LocationData;
  contactData?: ContactData[];
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: Record<string, unknown>[];
}

export interface SendMessageResponse {
  success: boolean;
  message: string;
  data?: {
    message: Message;
    whatsappMessageId: string;
    conversationLogged: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ========================================
// MEDIA UPLOAD RESPONSE
// ========================================

export interface MediaUploadResponse {
  success: boolean;
  message: string;
  data?: Array<{
    uploadToken: string;
    proxyUrl: string;
    mimeType: string;
    fileSize: number;
    originalFilename: string;
  }>;
}

// ========================================
// ERROR CODES (from old cloudMessageSender.js)
// ========================================

export const RETRYABLE_ERROR_CODES: Record<number, { delay: number; status: string }> = {
  131049: { delay: 720, status: 'ecosystem_limited' },  // 12h
  131048: { delay: 30, status: 'spam_rate_limited' },
  131056: { delay: 5, status: 'pair_rate_limited' },
  4: { delay: 1, status: 'rate_limited' },
  80007: { delay: 1, status: 'rate_limited' },
  130429: { delay: 1, status: 'rate_limited' },
  2: { delay: 5, status: 'offline' },
  131000: { delay: 5, status: 'offline' },
};

export const NON_RETRYABLE_ERROR_CODES: Record<number, string> = {
  190: 'token_expired',
  3: 'permission_issue',
  10: 'permission_issue',
  100: 'invalid_parameter',
  33: 'phone_number_deleted',
  131008: 'missing_parameter',
  131009: 'invalid_parameter_value',
  133010: 'phone_not_registered',
  131042: 'payment_issue',
  132001: 'template_not_exist',
  132015: 'template_paused',
  132016: 'template_disabled',
  368: 'policy_violation',
  131047: 're_engagement_outside_24h',
  131026: 'not_on_whatsapp',
  131021: 'user_opted_out',
  131031: 'user_blocked_business',
};
