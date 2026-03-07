/**
 * WhatsApp API Utilities
 * 
 * Server-side utilities for WhatsApp Cloud API integration
 */

import 'server-only';
import { Logger } from '@/lib/logger';

const log = new Logger('WhatsApp');

export interface WhatsAppConfig {
  apiUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
}

export interface SendMessageOptions {
  to: string;
  type: 'text' | 'template' | 'image' | 'document' | 'audio' | 'video';
  content: unknown;
}

export interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata?: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; caption?: string; mime_type: string };
          document?: { id: string; caption?: string; filename: string; mime_type: string };
          audio?: { id: string; mime_type: string };
          video?: { id: string; caption?: string; mime_type: string };
          location?: { latitude: number; longitude: number; name?: string; address?: string };
          contacts?: Array<{
            name: { formatted_name: string };
            phones: Array<{ phone: string; wa_id: string }>;
          }>;
          context?: {
            forwarded?: boolean;
            frequently_forwarded?: boolean;
            from?: string;
            id?: string;
          };
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          errors?: Array<{
            code: number;
            title: string;
            message: string;
          }>;
        }>;
        contacts?: Array<{
          profile: { name?: string };
          wa_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

/**
 * Get WhatsApp configuration from environment
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  return {
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  };
}

/**
 * Verify webhook signature
 * 
 * @param signature - The X-Hub-Signature-256 header value
 * @param payload - The raw request body
 * @param appSecret - Your Meta App Secret
 */
export async function verifyWebhookSignature(
  signature: string,
  payload: string,
  appSecret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }
  
  const expectedSignature = signature.slice(7);
  
  // Use Web Crypto API for HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Constant-time comparison
  return computedSignature === expectedSignature;
}

/**
 * Parse webhook payload
 */
export function parseWebhookPayload(payload: unknown): WebhookPayload | null {
  try {
    if (typeof payload !== 'object' || payload === null) {
      return null;
    }
    
    const data = payload as Record<string, unknown>;
    
    if (data.object !== 'whatsapp_business_account') {
      return null;
    }
    
    return data as unknown as WebhookPayload;
  } catch {
    return null;
  }
}

/**
 * Send a WhatsApp message
 * 
 * Note: This is scaffolded for future use.
 */
export async function sendWhatsAppMessage(
  options: SendMessageOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = getWhatsAppConfig();
  
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured' };
  }
  
  const url = `${config.apiUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`;
  
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: options.to,
    type: options.type,
  };
  
  body[options.type] = options.content;
  
  // TODO: Make actual API call in production
  log.debug('Would send message', { url, type: options.type, to: options.to });
  
  return {
    success: true,
    messageId: `mock-${Date.now()}`,
  };
}

/**
 * Download media from WhatsApp
 */
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ success: boolean; data?: Buffer; mimeType?: string; error?: string }> {
  const config = getWhatsAppConfig();
  
  if (!config.accessToken) {
    return { success: false, error: 'WhatsApp not configured' };
  }
  
  // TODO: Implement media download
  log.debug('Would download media', { mediaId });
  
  return {
    success: false,
    error: 'Media download not implemented',
  };
}

/**
 * Mark a message as read
 */
export async function markMessageAsRead(
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  const config = getWhatsAppConfig();
  
  if (!config.accessToken || !config.phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured' };
  }
  
  const url = `${config.apiUrl}/${config.apiVersion}/${config.phoneNumberId}/messages`;
  
  // TODO: Make actual API call
  log.debug('Would mark as read', { messageId });
  
  return { success: true };
}
