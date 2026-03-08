import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import type { SendMessageRequest } from '@/lib/types/chat';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

/**
 * Conversation Messages API Route Handler
 * 
 * POST /api/conversations/:id/messages - Send a message
 */

// POST - Send a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: SendMessageRequest = await request.json();
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    
    // Validate required fields
    if (!body.messageType) {
      return NextResponse.json(
        { success: false, message: 'Missing required field: messageType' },
        { status: 400 }
      );
    }
    
    // Validate content based on type
    if (body.messageType === 'text' && !body.messageContent) {
      return NextResponse.json(
        { success: false, message: 'Text messages require messageContent' },
        { status: 400 }
      );
    }
    
    if (
      ['image', 'video', 'document', 'audio', 'sticker'].includes(body.messageType) &&
      !body.mediaUrl &&
      !body.mediaUploadToken &&
      !body.forwardSourceMessageId
    ) {
      return NextResponse.json(
        { success: false, message: 'Media messages require mediaUrl, mediaUploadToken, or forwardSourceMessageId' },
        { status: 400 }
      );
    }
    
    if (body.messageType === 'template' && !body.templateName) {
      return NextResponse.json(
        { success: false, message: 'Template messages require templateName' },
        { status: 400 }
      );
    }
    
    const result = await conversationController.sendMessage({
      conversationId: parseInt(id),
      userId,
      messageData: body,
    });
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
    
  } catch (error) {
    console.error('[API] POST /conversations/:id/messages error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
