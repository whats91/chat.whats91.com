const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const parseMaybeJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch {
      return null;
    }
  }
  return value;
};

const parseJsonField = (value, fallback = null) => {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) {
    return fallback;
  }
  return parsed;
};

const isRenderableMediaUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  return /^(https?:\/\/|blob:|data:|\/(?!\/))/i.test(value);
};

const isMetaProtectedMediaUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  return (
    /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(value) ||
    /graph\.facebook\.com/i.test(value)
  );
};

const getApiBaseUrl = () => {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL || '';
  return String(fromEnv).replace(/\/$/, '');
};

const firstItem = (value) => (Array.isArray(value) && value.length > 0 ? value[0] : null);

export const parsePayloadObject = (payload) => {
  const parsed = parseMaybeJson(payload);
  return isObject(parsed) ? parsed : null;
};

const extractMetaMessageNode = (payload) => {
  const parsedPayload = parsePayloadObject(payload);
  if (!parsedPayload) return null;

  const entry = firstItem(parsedPayload.entry);
  const change = firstItem(entry?.changes);
  const valueMessage = firstItem(change?.value?.messages);
  if (valueMessage) return valueMessage;

  const nestedValueMessage = firstItem(parsedPayload.value?.messages);
  if (nestedValueMessage) return nestedValueMessage;

  const directMessage = firstItem(parsedPayload.messages);
  if (directMessage) return directMessage;

  if (isObject(parsedPayload.message)) {
    return parsedPayload.message;
  }

  if (
    parsedPayload.type ||
    parsedPayload.text ||
    parsedPayload.image ||
    parsedPayload.video ||
    parsedPayload.audio ||
    parsedPayload.document ||
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
};

const inferType = (messageNode) => {
  if (!isObject(messageNode)) return 'text';
  if (messageNode.type) return String(messageNode.type);
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
  return 'text';
};

const normalizeTemplateParam = (param) => {
  if (!isObject(param)) return null;
  if (typeof param.text === 'string' && param.text.trim()) return param.text.trim();
  if (typeof param.payload === 'string' && param.payload.trim()) return param.payload.trim();
  if (typeof param?.date_time?.fallback_value === 'string' && param.date_time.fallback_value.trim()) {
    return param.date_time.fallback_value.trim();
  }
  if (typeof param?.currency?.fallback_value === 'string' && param.currency.fallback_value.trim()) {
    return param.currency.fallback_value.trim();
  }
  return null;
};

const extractTemplateBodyText = (template) => {
  const components = Array.isArray(template?.components) ? template.components : [];
  const bodyComponent = components.find(
    (component) => String(component?.type || '').toLowerCase() === 'body'
  );
  const params = Array.isArray(bodyComponent?.parameters) ? bodyComponent.parameters : [];
  const textParts = params.map(normalizeTemplateParam).filter(Boolean);
  return textParts.join(' ').trim();
};

const extractTemplateButtons = (template) => {
  const components = Array.isArray(template?.components) ? template.components : [];
  return components
    .filter((component) => String(component?.type || '').toLowerCase() === 'button')
    .map((component, index) => {
      const parameters = Array.isArray(component?.parameters) ? component.parameters : [];
      const label =
        parameters
          .map(normalizeTemplateParam)
          .filter(Boolean)[0] || `Button ${index + 1}`;

      return {
        id: component?.index ?? `${index}`,
        title: label,
        type: component?.sub_type || 'button',
        parameters
      };
    });
};

const normalizeLegacyMessage = (message = {}) => {
  const rawType = String(message.message_type || 'text').toLowerCase();
  const normalizedType = rawType === 'contact' ? 'contacts' : rawType === 'pdf' ? 'document' : rawType;

  return {
    ...message,
    message_type: normalizedType,
    message_content: message.message_content || '',
    media_url: message.media_url || null,
    media_mime_type: message.media_mime_type || null,
    media_filename: message.media_filename || null,
    media_caption: message.media_caption || null,
    location_data: parseJsonField(message.location_data, null),
    contact_data: parseJsonField(message.contact_data, null),
    interactive_data: parseJsonField(message.interactive_data, null),
    reaction_data: parseJsonField(message.reaction_data, null),
    media_id: null,
    payload: null,
    payload_type: null,
    payload_message: null
  };
};

const applyMediaData = (normalized, mediaType, mediaPayload) => {
  const media = isObject(mediaPayload) ? mediaPayload : {};
  const payloadUrl = media.link || media.url || null;
  const legacyUrl = normalized.media_url || null;

  normalized.message_type = mediaType;
  normalized.media_id = media.id || normalized.media_id || null;
  normalized.media_url =
    payloadUrl ||
    (isRenderableMediaUrl(legacyUrl) ? legacyUrl : null) ||
    legacyUrl ||
    normalized.media_id ||
    null;
  normalized.media_mime_type = media.mime_type || media.mimeType || normalized.media_mime_type;
  normalized.media_caption = media.caption || normalized.media_caption;
  normalized.media_filename = media.filename || normalized.media_filename;

  if (!normalized.message_content) {
    if (mediaType === 'image') normalized.message_content = normalized.media_caption || '[Image]';
    if (mediaType === 'video') normalized.message_content = normalized.media_caption || '[Video]';
    if (mediaType === 'audio' || mediaType === 'voice') normalized.message_content = '[Audio]';
    if (mediaType === 'document') {
      normalized.message_content = normalized.media_filename
        ? `[Document: ${normalized.media_filename}]`
        : '[Document]';
    }
    if (mediaType === 'sticker') normalized.message_content = '[Sticker]';
  }
};

export const resolveMessageForRendering = (message = {}) => {
  const normalized = normalizeLegacyMessage(message);
  const direction = String(message.direction || '').toLowerCase();

  const incomingPayload = parsePayloadObject(message.incoming_payload ?? message.incomingPayload);
  const outgoingPayload = parsePayloadObject(
    message.outgoing_payload ?? message.outgoingPayload ?? message.payload
  );
  const selectedPayload = direction === 'inbound' ? incomingPayload : outgoingPayload;

  if (!selectedPayload) {
    return normalized;
  }

  const payloadMessage = extractMetaMessageNode(selectedPayload);
  if (!payloadMessage) {
    return normalized;
  }

  const payloadType = inferType(payloadMessage).toLowerCase();
  normalized.payload = selectedPayload;
  normalized.payload_message = payloadMessage;
  normalized.payload_type = payloadType;

  switch (payloadType) {
    case 'text':
      normalized.message_type = 'text';
      normalized.message_content = payloadMessage?.text?.body || normalized.message_content || '';
      break;

    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
    case 'voice':
      applyMediaData(normalized, payloadType === 'voice' ? 'audio' : payloadType, payloadMessage[payloadType]);
      break;

    case 'location':
      normalized.message_type = 'location';
      normalized.location_data = payloadMessage.location || normalized.location_data;
      if (!normalized.message_content) normalized.message_content = '[Location]';
      break;

    case 'contacts':
      normalized.message_type = 'contacts';
      normalized.contact_data = payloadMessage.contacts || normalized.contact_data;
      if (!normalized.message_content) normalized.message_content = '[Contact]';
      break;

    case 'reaction':
      normalized.message_type = 'reaction';
      normalized.reaction_data = payloadMessage.reaction || normalized.reaction_data;
      normalized.message_content =
        payloadMessage?.reaction?.emoji || normalized.message_content || '[Reaction]';
      break;

    case 'button':
      normalized.message_type = 'button';
      normalized.interactive_data = {
        type: 'button',
        ...(payloadMessage.button || {})
      };
      normalized.message_content =
        payloadMessage?.button?.text ||
        payloadMessage?.button?.payload ||
        normalized.message_content ||
        '[Button Reply]';
      break;

    case 'list_reply':
      normalized.message_type = 'list_reply';
      normalized.interactive_data = {
        type: 'list_reply',
        ...(payloadMessage.list_reply || {})
      };
      normalized.message_content =
        payloadMessage?.list_reply?.title ||
        payloadMessage?.list_reply?.description ||
        normalized.message_content ||
        '[List Reply]';
      break;

    case 'interactive': {
      const interactive = payloadMessage.interactive || {};
      const interactiveType = String(interactive.type || '').toLowerCase();

      if (interactiveType === 'button_reply') {
        normalized.message_type = 'button_reply';
        normalized.interactive_data = {
          type: 'button_reply',
          ...(interactive.button_reply || {})
        };
        normalized.message_content =
          interactive?.button_reply?.title || normalized.message_content || '[Button Reply]';
      } else if (interactiveType === 'list_reply') {
        normalized.message_type = 'list_reply';
        normalized.interactive_data = {
          type: 'list_reply',
          ...(interactive.list_reply || {})
        };
        normalized.message_content =
          interactive?.list_reply?.title ||
          interactive?.list_reply?.description ||
          normalized.message_content ||
          '[List Reply]';
      } else {
        normalized.message_type = 'interactive';
        normalized.interactive_data = interactive;
        normalized.message_content =
          interactive?.body?.text || normalized.message_content || '[Interactive Message]';
      }
      break;
    }

    case 'template': {
      const template = payloadMessage.template || {};
      const templateText = extractTemplateBodyText(template);
      normalized.message_type = 'template';
      normalized.interactive_data = {
        type: 'template',
        template_name: template.name || null,
        language: template.language || null,
        components: Array.isArray(template.components) ? template.components : [],
        buttons: extractTemplateButtons(template)
      };
      normalized.message_content =
        normalized.message_content ||
        templateText ||
        (template.name ? `[Template: ${template.name}]` : '[Template]');
      break;
    }

    default:
      break;
  }

  const shouldUseProxyMedia =
    !!normalized.media_url &&
    (isMetaProtectedMediaUrl(normalized.media_url) || !isRenderableMediaUrl(normalized.media_url));

  // Always use internal database ID for media proxy
  const proxyMessageId = message.id;

  if (proxyMessageId && shouldUseProxyMedia) {
    const apiBaseUrl = getApiBaseUrl();
    const encodedMessageId = encodeURIComponent(String(proxyMessageId));
    normalized.media_url = apiBaseUrl
      ? `${apiBaseUrl}/api/conversations/media/${encodedMessageId}`
      : `/api/conversations/media/${encodedMessageId}`;
  }

  return normalized;
};
