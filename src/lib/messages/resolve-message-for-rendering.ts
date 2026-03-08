'use client';

import { buildConversationMediaProxyUrl, isMetaProtectedMediaUrl, isRenderableMediaUrl } from '@/lib/media/conversation-media';
import type { ContactData, LocationData, Message, MessageType } from '@/lib/types/chat';

type JsonObject = Record<string, unknown>;

export interface RenderableMessage {
  type: MessageType;
  content: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaCaption: string | null;
  interactiveData: JsonObject | null;
  locationData: LocationData | null;
  contactData: ContactData[] | null;
  reactionData: JsonObject | null;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMaybeJson<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value as T;
}

function parseObject(value: unknown): JsonObject | null {
  const parsed = parseMaybeJson(value);
  return isObject(parsed) ? parsed : null;
}

function parseArray<T>(value: unknown): T[] | null {
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? (parsed as T[]) : null;
}

function firstItem<T>(value: unknown): T | null {
  return Array.isArray(value) && value.length > 0 ? (value[0] as T) : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMessageType(value: unknown): MessageType {
  const rawType = String(value || 'text').toLowerCase();

  if (rawType === 'contact') return 'contacts';
  if (rawType === 'pdf') return 'document';
  if (rawType === 'voice') return 'audio';

  const validTypes: MessageType[] = [
    'text',
    'image',
    'video',
    'audio',
    'document',
    'sticker',
    'location',
    'contacts',
    'interactive',
    'button',
    'button_reply',
    'list_reply',
    'reaction',
    'template',
    'unknown',
  ];

  return validTypes.includes(rawType as MessageType) ? (rawType as MessageType) : 'unknown';
}

function extractMetaMessageNode(payload: unknown): JsonObject | null {
  const parsedPayload = parseObject(payload);
  if (!parsedPayload) return null;

  const entry = firstItem<JsonObject>(parsedPayload.entry);
  const change = firstItem<JsonObject>(entry?.changes);
  const changeValue = parseObject(change?.value);
  const valueMessage = firstItem<JsonObject>(changeValue?.messages);
  if (valueMessage) return valueMessage;

  const nestedValue = parseObject(parsedPayload.value);
  const nestedValueMessage = firstItem<JsonObject>(nestedValue?.messages);
  if (nestedValueMessage) return nestedValueMessage;

  const directMessage = firstItem<JsonObject>(parsedPayload.messages);
  if (directMessage) return directMessage;

  const directMessageObject = parseObject(parsedPayload.message);
  if (directMessageObject) return directMessageObject;

  if (
    parsedPayload.type ||
    parsedPayload.text ||
    parsedPayload.image ||
    parsedPayload.video ||
    parsedPayload.audio ||
    parsedPayload.document ||
    parsedPayload.sticker ||
    parsedPayload.location ||
    parsedPayload.contacts ||
    parsedPayload.interactive ||
    parsedPayload.button ||
    parsedPayload.list_reply ||
    parsedPayload.reaction ||
    parsedPayload.template
  ) {
    return parsedPayload;
  }

  return null;
}

function inferPayloadType(messageNode: JsonObject | null): MessageType | 'audio' {
  if (!messageNode) return 'unknown';
  if (messageNode.type) return normalizeMessageType(messageNode.type);
  if (messageNode.text) return 'text';
  if (messageNode.image) return 'image';
  if (messageNode.video) return 'video';
  if (messageNode.audio) return 'audio';
  if (messageNode.document) return 'document';
  if (messageNode.sticker) return 'sticker';
  if (messageNode.location) return 'location';
  if (messageNode.contacts) return 'contacts';
  if (messageNode.interactive) return 'interactive';
  if (messageNode.button) return 'button';
  if (messageNode.list_reply) return 'list_reply';
  if (messageNode.reaction) return 'reaction';
  if (messageNode.template) return 'template';
  return 'unknown';
}

function normalizeTemplateParam(param: unknown): string | null {
  const parsed = parseObject(param);
  if (!parsed) return null;

  if (getString(parsed.text)) return getString(parsed.text);
  if (getString(parsed.payload)) return getString(parsed.payload);

  const dateTime = parseObject(parsed.date_time);
  if (getString(dateTime?.fallback_value)) return getString(dateTime?.fallback_value);

  const currency = parseObject(parsed.currency);
  if (getString(currency?.fallback_value)) return getString(currency?.fallback_value);

  return null;
}

function extractTemplateBodyText(template: JsonObject): string {
  const components = Array.isArray(template.components) ? template.components : [];
  const bodyComponent = components.find((component) => {
    const parsed = parseObject(component);
    return String(parsed?.type || '').toLowerCase() === 'body';
  });

  const body = parseObject(bodyComponent);
  const parameters = Array.isArray(body?.parameters) ? body.parameters : [];
  const textParts = parameters.map(normalizeTemplateParam).filter((value): value is string => Boolean(value));
  return textParts.join(' ').trim();
}

function extractTemplateButtons(template: JsonObject): Array<Record<string, unknown>> {
  const components = Array.isArray(template.components) ? template.components : [];

  return components
    .map((component) => parseObject(component))
    .filter((component): component is JsonObject => Boolean(component))
    .filter((component) => String(component.type || '').toLowerCase() === 'button')
    .map((component, index) => {
      const parameters = Array.isArray(component.parameters) ? component.parameters : [];
      const label =
        parameters.map(normalizeTemplateParam).filter((value): value is string => Boolean(value))[0] ||
        `Button ${index + 1}`;

      return {
        id: component.index ?? String(index),
        title: label,
        type: component.sub_type || 'button',
        parameters,
      };
    });
}

function resolveBaseContent(message: Message): string {
  if (getString(message.content)) return message.content!.trim();
  if (getString(message.mediaCaption)) return message.mediaCaption!.trim();
  return '';
}

function applyMediaPayload(
  normalized: RenderableMessage,
  nextType: MessageType,
  mediaPayload: unknown
): void {
  const media = parseObject(mediaPayload) || {};
  const payloadMediaUrl = getString(media.link) || getString(media.url) || getString(media.id) || null;

  normalized.type = nextType;
  // The DB-backed media URL is the durable source of truth. Outgoing payload links are often
  // temporary signed URLs used only for the initial Meta send, so they should not override Wasabi.
  normalized.mediaUrl = normalized.mediaUrl || payloadMediaUrl;
  normalized.mediaMimeType = getString(media.mime_type) || getString(media.mimeType) || normalized.mediaMimeType;
  normalized.mediaFilename = getString(media.filename) || normalized.mediaFilename;
  normalized.mediaCaption = getString(media.caption) || normalized.mediaCaption;

  if (!normalized.content) {
    if (nextType === 'image') normalized.content = normalized.mediaCaption || '[Image]';
    if (nextType === 'video') normalized.content = normalized.mediaCaption || '[Video]';
    if (nextType === 'audio') normalized.content = '[Audio]';
    if (nextType === 'document') {
      normalized.content = normalized.mediaFilename ? `[Document: ${normalized.mediaFilename}]` : '[Document]';
    }
    if (nextType === 'sticker') normalized.content = '[Sticker]';
  }
}

function shouldUseMediaProxy(message: Message, normalized: RenderableMessage): boolean {
  if (!message.id) {
    return false;
  }

  if (!['image', 'video', 'audio', 'document', 'sticker'].includes(normalized.type)) {
    return false;
  }

  if (!normalized.mediaUrl) {
    return true;
  }

  return isMetaProtectedMediaUrl(normalized.mediaUrl) || !isRenderableMediaUrl(normalized.mediaUrl);
}

export function resolveMessageForRendering(message: Message): RenderableMessage {
  const normalized: RenderableMessage = {
    type: normalizeMessageType(message.type),
    content: resolveBaseContent(message),
    mediaUrl: getString(message.mediaUrl) || null,
    mediaMimeType: getString(message.mediaMimeType) || null,
    mediaFilename: getString(message.mediaFilename) || getString(message.metadata?.fileName) || null,
    mediaCaption: getString(message.mediaCaption) || null,
    interactiveData: parseObject(message.interactiveData),
    locationData: (parseObject(message.locationData) as LocationData | null) || null,
    contactData: parseArray<ContactData>(message.contactData),
    reactionData: null,
  };

  const incomingPayload = parseObject(message.incomingPayload);
  const outgoingPayload = parseObject(message.outgoingPayload);
  const selectedPayload =
    message.direction === 'inbound'
      ? incomingPayload || outgoingPayload
      : outgoingPayload || incomingPayload;

  const payloadMessage = extractMetaMessageNode(selectedPayload);
  if (!payloadMessage) {
    return normalized;
  }

  const payloadType = inferPayloadType(payloadMessage);

  switch (payloadType) {
    case 'text': {
      const textPayload = parseObject(payloadMessage.text);
      normalized.type = 'text';
      normalized.content = getString(textPayload?.body) || normalized.content || '';
      break;
    }

    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      applyMediaPayload(normalized, payloadType, payloadMessage[payloadType]);
      break;

    case 'location':
      normalized.type = 'location';
      normalized.locationData = (parseObject(payloadMessage.location) as LocationData | null) || normalized.locationData;
      normalized.content = normalized.content || '[Location]';
      break;

    case 'contacts':
      normalized.type = 'contacts';
      normalized.contactData = parseArray<ContactData>(payloadMessage.contacts) || normalized.contactData;
      normalized.content = normalized.content || '[Contact]';
      break;

    case 'reaction': {
      const reaction = parseObject(payloadMessage.reaction);
      normalized.type = 'reaction';
      normalized.reactionData = reaction;
      normalized.content = getString(reaction?.emoji) || normalized.content || '[Reaction]';
      break;
    }

    case 'button': {
      const button = parseObject(payloadMessage.button) || {};
      normalized.type = 'button';
      normalized.interactiveData = {
        type: 'button',
        ...button,
      };
      normalized.content =
        getString(button.text) ||
        getString(button.payload) ||
        normalized.content ||
        '[Button Reply]';
      break;
    }

    case 'list_reply': {
      const listReply = parseObject(payloadMessage.list_reply) || {};
      normalized.type = 'list_reply';
      normalized.interactiveData = {
        type: 'list_reply',
        ...listReply,
      };
      normalized.content =
        getString(listReply.title) ||
        getString(listReply.description) ||
        normalized.content ||
        '[List Reply]';
      break;
    }

    case 'interactive': {
      const interactive = parseObject(payloadMessage.interactive) || {};
      const interactiveType = String(interactive.type || '').toLowerCase();

      if (interactiveType === 'button_reply') {
        const buttonReply = parseObject(interactive.button_reply) || {};
        normalized.type = 'button_reply';
        normalized.interactiveData = {
          type: 'button_reply',
          ...buttonReply,
        };
        normalized.content = getString(buttonReply.title) || normalized.content || '[Button Reply]';
      } else if (interactiveType === 'list_reply') {
        const listReply = parseObject(interactive.list_reply) || {};
        normalized.type = 'list_reply';
        normalized.interactiveData = {
          type: 'list_reply',
          ...listReply,
        };
        normalized.content =
          getString(listReply.title) ||
          getString(listReply.description) ||
          normalized.content ||
          '[List Reply]';
      } else {
        const body = parseObject(interactive.body);
        normalized.type = 'interactive';
        normalized.interactiveData = interactive;
        normalized.content = getString(body?.text) || normalized.content || '[Interactive Message]';
      }
      break;
    }

    case 'template': {
      const template = parseObject(payloadMessage.template) || {};
      const templateText = extractTemplateBodyText(template);
      normalized.type = 'template';
      normalized.interactiveData = {
        type: 'template',
        template_name: getString(template.name),
        language: template.language || null,
        components: Array.isArray(template.components) ? template.components : [],
        buttons: extractTemplateButtons(template),
      };
      normalized.content =
        normalized.content ||
        templateText ||
        (getString(template.name) ? `[Template: ${getString(template.name)}]` : '[Template]');
      break;
    }

    default:
      break;
  }

  if (shouldUseMediaProxy(message, normalized)) {
    normalized.mediaUrl = buildConversationMediaProxyUrl(message.id);
  }

  return normalized;
}
