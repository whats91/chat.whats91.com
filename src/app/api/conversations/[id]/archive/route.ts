import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';

/**
 * Toggle Archive Conversation API Route Handler
 * 
 * PATCH /api/conversations/:id/archive - Toggle archive status
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // TODO: Get userId from auth session
    const userId = request.headers.get('x-user-id') || '1';
    
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
