import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';

/**
 * Mark Conversation as Read API Route Handler
 * 
 * POST /api/conversations/:id/read - Mark all messages as read
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // TODO: Get userId from auth session
    const userId = request.headers.get('x-user-id') || '1';
    
    const result = await conversationController.markAsRead(parseInt(id), userId);
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
    
  } catch (error) {
    console.error('[API] POST /conversations/:id/read error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
