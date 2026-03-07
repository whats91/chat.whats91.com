import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { findCloudApiSetupByPhoneNumberId } from '@/server/db/cloud-api-setup';
import type { WebhookEntry } from '@/lib/types/chat';
import { Logger } from '@/lib/logger';

const log = new Logger('Webhook');

/**
 * WhatsApp Webhook Route Handler
 * 
 * Handles:
 * 1. GET - Webhook verification handshake
 * 2. POST - Incoming webhook events from WhatsApp Cloud API
 * 
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 */

// Webhook verification handshake
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  
  // Verify token from environment
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'mock_verify_token';
  
  // Check if mode and token are correct
  if (mode === 'subscribe' && token === verifyToken) {
    log.info('Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }
  
  log.warn('Verification failed');
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  );
}

// Incoming webhook events
export async function POST(request: NextRequest) {
  try {
    // TODO: Implement signature verification using X-Hub-Signature-256
    // const signature = request.headers.get('x-hub-signature-256');
    // const appSecret = process.env.WHATSAPP_APP_SECRET;
    
    // Parse the request body
    const body: WebhookEntry = await request.json();
    
    // Validate webhook structure
    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json(
        { error: 'Invalid webhook object' },
        { status: 400 }
      );
    }
    
    // Process entries
    const entries = body.entry || [];
    
    for (const entry of entries) {
      const changes = entry.changes || [];
      
      for (const change of changes) {
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        
        if (!phoneNumberId) continue;
        
        // Find the CloudApiSetup for this phone number
        const cloudSetup = await findCloudApiSetupByPhoneNumberId(phoneNumberId);
        
        if (!cloudSetup || !cloudSetup.accessChats) {
          log.debug('No CloudApiSetup found or chats disabled', { phoneNumberId });
          continue;
        }
        
        const userId = String(cloudSetup.userId);
        
        // Handle incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            const messageType = message.type || 'text';
            
            // Extract message content based on type
            let messageContent: string | undefined;
            let mediaId: string | undefined;
            let mediaMimeType: string | undefined;
            
            switch (messageType) {
              case 'text':
                messageContent = message.text?.body;
                break;
              case 'image':
                messageContent = message.image?.caption || '[Image]';
                mediaId = message.image?.id;
                mediaMimeType = message.image?.mime_type;
                break;
              case 'video':
                messageContent = message.video?.caption || '[Video]';
                mediaId = message.video?.id;
                mediaMimeType = message.video?.mime_type;
                break;
              case 'audio':
                messageContent = '[Audio]';
                mediaId = message.audio?.id;
                mediaMimeType = message.audio?.mime_type;
                break;
              case 'document':
                messageContent = message.document?.filename || '[Document]';
                mediaId = message.document?.id;
                mediaMimeType = message.document?.mime_type;
                break;
              case 'location':
                messageContent = `[Location] ${message.location?.name || ''}`;
                break;
              case 'contacts':
                const contact = message.contacts?.[0];
                messageContent = contact?.name?.formatted_name || '[Contact]';
                break;
              case 'interactive':
                const interactive = message.interactive;
                if (interactive?.button_reply) {
                  messageContent = interactive.button_reply.title;
                } else if (interactive?.list_reply) {
                  messageContent = interactive.list_reply.title;
                } else {
                  messageContent = '[Interactive]';
                }
                break;
              case 'button':
                messageContent = message.button?.text || '[Button]';
                break;
              case 'reaction':
                messageContent = `👍 Reacted to a message`;
                break;
              default:
                messageContent = `[${messageType}]`;
            }
            
            // Process the message
            await conversationController.processIncomingMessage({
              userId,
              phoneNumberId,
              fromPhone: message.from,
              whatsappMessageId: message.id,
              messageType,
              messageContent,
              mediaId,
              mediaMimeType,
              incomingPayload: message as unknown as Record<string, unknown>,
            });
            
            log.info('Processed message', { id: message.id, type: messageType });
          }
        }
        
        // Handle status updates
        if (value.statuses) {
          for (const statusUpdate of value.statuses) {
            const status = statusUpdate.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
            
            let errorMessage: string | undefined;
            if (status === 'failed' && statusUpdate.errors?.length) {
              errorMessage = statusUpdate.errors[0].message;
            }
            
            await conversationController.updateMessageStatus(
              statusUpdate.id,
              status,
              statusUpdate.errors?.[0]?.code?.toString(),
              errorMessage
            );
            
            log.debug('Status update', { id: statusUpdate.id, status });
          }
        }
      }
    }
    
    // Always return 200 to acknowledge receipt
    return NextResponse.json({ success: true }, { status: 200 });
    
  } catch (error) {
    log.error('Error processing webhook', { error: error instanceof Error ? error.message : error });
    
    // Return 500 for actual errors
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
