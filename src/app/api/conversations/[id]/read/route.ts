import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

/**
 * Mark Conversation as Read API Route Handler
 * 
 * POST /api/conversations/:id/read - Mark all messages as read
 */

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    
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
