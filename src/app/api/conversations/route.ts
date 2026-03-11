import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

/**
 * Conversations API Route Handler
 * 
 * GET /api/conversations - Get conversation list
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20)
 * - search: Search term
 * - status: Filter by status (active, closed, blocked, all)
 * - archived: Show archived conversations (default: false)
 * - unreadOnly: Show only unread conversations (default: false)
 */

// GET - List conversations
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    
    const result = await conversationController.getConversations({
      userId,
      teamMemberId: auth.user.teamMemberId,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '20'),
      search: searchParams.get('search') || undefined,
      status: searchParams.get('status') || 'active',
      archived: searchParams.get('archived') === 'true',
      unreadOnly: searchParams.get('unreadOnly') === 'true',
      labelId: searchParams.get('labelId') || undefined,
    });
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
    
  } catch (error) {
    console.error('[API] GET /conversations error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
