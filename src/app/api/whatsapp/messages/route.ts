import { NextRequest, NextResponse } from 'next/server';

/**
 * WhatsApp Messages API Route Handler
 * 
 * Handles sending messages via WhatsApp Cloud API
 * 
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

interface SendMessageRequest {
  to: string;
  type: 'text' | 'template' | 'image' | 'document' | 'audio' | 'video';
  content: string | TemplateMessage | MediaMessage;
  recipientType?: 'individual';
}

interface TemplateMessage {
  name: string;
  language: {
    code: string;
    policy?: 'deterministic';
  };
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: string; [key: string]: unknown }>;
  }>;
}

interface MediaMessage {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

// POST - Send a message
export async function POST(request: NextRequest) {
  try {
    const body: SendMessageRequest = await request.json();
    
    // Validate required fields
    if (!body.to || !body.type) {
      return NextResponse.json(
        { error: 'Missing required fields: to, type' },
        { status: 400 }
      );
    }
    
    // Get configuration from environment
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
    const apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com';
    
    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: 'WhatsApp configuration not set' },
        { status: 503 }
      );
    }
    
    // Build the message payload
    const messagePayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: body.recipientType || 'individual',
      to: body.to,
      type: body.type,
    };
    
    // Add content based on type
    switch (body.type) {
      case 'text':
        messagePayload.text = {
          preview_url: false,
          body: body.content,
        };
        break;
      case 'template':
        messagePayload.template = body.content;
        break;
      case 'image':
      case 'document':
      case 'audio':
      case 'video':
        messagePayload[body.type] = body.content;
        break;
    }
    
    // TODO: In production, make the actual API call
    // const response = await fetch(
    //   `${apiUrl}/${apiVersion}/${phoneNumberId}/messages`,
    //   {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${accessToken}`,
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify(messagePayload),
    //   }
    // );
    
    // For now, return a mock response
    const mockResponse = {
      messaging_product: 'whatsapp',
      contacts: [
        {
          input: body.to,
          wa_id: body.to.replace(/\D/g, ''),
        },
      ],
      messages: [
        {
          id: `wamid.HBgM${Date.now()}`,
        },
      ],
    };
    
    return NextResponse.json(mockResponse, { status: 200 });
    
  } catch (error) {
    console.error('[Messages] Error sending message:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

// GET - List messages (placeholder)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const conversationId = searchParams.get('conversationId');
  
  // TODO: Implement message listing from database
  return NextResponse.json(
    {
      messages: [],
      conversationId,
      pagination: {
        hasMore: false,
        nextCursor: null,
      },
    },
    { status: 200 }
  );
}
