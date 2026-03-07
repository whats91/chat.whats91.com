/**
 * WhatsApp Types
 * 
 * Type definitions for WhatsApp Cloud API
 */

export interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  type: MessageType;
  text?: TextMessage;
  image?: MediaMessage;
  document?: DocumentMessage;
  audio?: AudioMessage;
  video?: VideoMessage;
  location?: LocationMessage;
  contacts?: ContactMessage[];
  sticker?: StickerMessage;
  reaction?: ReactionMessage;
  context?: MessageContext;
  errors?: WhatsAppError[];
}

export type MessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive'
  | 'button'
  | 'template';

export interface TextMessage {
  body: string;
  preview_url?: boolean;
}

export interface MediaMessage {
  id?: string;
  link?: string;
  caption?: string;
  mime_type?: string;
  sha256?: string;
}

export interface DocumentMessage extends MediaMessage {
  filename?: string;
}

export interface AudioMessage extends MediaMessage {
  voice?: boolean;
}

// Video message is the same as MediaMessage but semantically different
export type VideoMessage = MediaMessage;

export interface LocationMessage {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactMessage {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    suffix?: string;
    prefix?: string;
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
  addresses?: Array<{
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    country_code?: string;
    type?: string;
  }>;
  org?: {
    company?: string;
    department?: string;
    title?: string;
  };
  urls?: Array<{
    url?: string;
    type?: string;
  }>;
}

export interface StickerMessage {
  id: string;
  animated?: boolean;
  mime_type: string;
  sha256: string;
}

export interface ReactionMessage {
  message_id: string;
  emoji: string;
}

export interface MessageContext {
  forwarded?: boolean;
  frequently_forwarded?: boolean;
  from?: string;
  id?: string;
  referred_product?: {
    catalog_id: string;
    product_retailer_id: string;
  };
}

export interface MessageStatus {
  id: string;
  status: MessageStatusType;
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin: {
      type: 'business_initiated' | 'user_initiated' | 'referral_conversion';
    };
    expiration_timestamp?: string;
  };
  pricing?: {
    billable: boolean;
    pricing_model: 'CBP' | 'PMP'; // Conversation-based pricing deprecated, now PMP (Per-message pricing)
    category: 'marketing' | 'utility' | 'authentication' | 'service';
  };
  errors?: WhatsAppError[];
}

export type MessageStatusType = 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  error_data?: {
    details: string;
  };
}

// Message sending types
export interface SendTextMessageRequest {
  type: 'text';
  to: string;
  text: {
    body: string;
    preview_url?: boolean;
  };
}

export interface SendTemplateMessageRequest {
  type: 'template';
  to: string;
  template: {
    name: string;
    language: {
      code: string;
      policy?: 'deterministic';
    };
    components?: TemplateComponent[];
  };
}

export interface SendMediaMessageRequest {
  type: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  to: string;
  [key: string]: unknown; // The media object (image, document, etc.)
}

export type SendMessageRequest =
  | SendTextMessageRequest
  | SendTemplateMessageRequest
  | SendMediaMessageRequest;

export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: number;
  parameters: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  currency?: {
    fallback_value: string;
    code: string;
    amount_1000: number;
  };
  date_time?: {
    fallback_value: string;
    day_of_week?: number;
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    calendar?: 'GREGORIAN';
  };
  image?: {
    id?: string;
    link?: string;
    caption?: string;
  };
  document?: {
    id?: string;
    link?: string;
    caption?: string;
    filename?: string;
  };
  video?: {
    id?: string;
    link?: string;
    caption?: string;
  };
}

// Phone number info
export interface PhoneNumberInfo {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating?: 'HIGH' | 'MEDIUM' | 'LOW';
  code_verification_status?: 'EXPIRED' | 'NOT_VERIFIED' | 'VERIFIED';
  account_mode?: 'LIVE' | 'SANDBOX';
  new_name_status?: 'APPROVED' | 'PENDING' | 'REJECTED';
  status?: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';
  threading_state?: 'OPEN' | 'CLOSED';
}

// Business profile
export interface BusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  industry?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}
