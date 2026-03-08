import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

/**
 * Toggle Archive Conversation API Route Handler
 * 
 * PATCH /api/conversations/:id/archive - Toggle archive status
 */

export async function PATCH(
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
    
    const result = await conversationController.toggleArchive(parseInt(id), userId);
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
    
  } catch (error) {
    console.error('[API] PATCH /conversations/:id/archive error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
