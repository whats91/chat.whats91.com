import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import type { SendMessageRequest } from '@/lib/types/chat';

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
    
    // TODO: Get userId from auth session
    const userId = request.headers.get('x-user-id') || '1';
    
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
    
    if (['image', 'video', 'document', 'audio'].includes(body.messageType) && !body.mediaUrl && !body.mediaUploadToken) {
      return NextResponse.json(
        { success: false, message: 'Media messages require mediaUrl or mediaUploadToken' },
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
