export const MEDIA_MESSAGE_TYPES = new Set([
  'image',
  'video',
  'audio',
  'document',
  'sticker',
]);

export function buildConversationMediaProxyUrl(messageId: string | number): string {
  return `/api/conversations/media/${encodeURIComponent(String(messageId))}`;
}

export function isMetaProtectedMediaUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return (
    /lookaside\.fbsbx\.com\/whatsapp_business\/attachments/i.test(value) ||
    /graph\.facebook\.com/i.test(value)
  );
}

export function isRenderableMediaUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return /^(https?:\/\/|blob:|data:|\/(?!\/))/i.test(value);
}
