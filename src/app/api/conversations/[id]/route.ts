import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

/**
 * Individual Conversation API Route Handler
 * 
 * GET /api/conversations/:id - Get conversation with messages
 * DELETE /api/conversations/:id - Delete conversation
 */

// GET - Get conversation by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    
    const userId = getCurrentUserId();
    
    const result = await conversationController.getConversationById({
      conversationId: parseInt(id),
      userId,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '50'),
      beforeMessageId: searchParams.get('beforeMessageId') || undefined,
    });
    
    return NextResponse.json(result, { status: result.success ? 200 : 404 });
    
  } catch (error) {
    console.error('[API] GET /conversations/:id error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete conversation
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const userId = getCurrentUserId();
    
    const result = await conversationController.delete(parseInt(id), userId);
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
    
  } catch (error) {
    console.error('[API] DELETE /conversations/:id error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
