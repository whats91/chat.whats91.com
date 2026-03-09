import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

/**
 * Individual Conversation API Route Handler
 * 
 * GET /api/conversations/:id - Get conversation with messages
 * PATCH /api/conversations/:id - Update conversation details
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
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    
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

// PATCH - Update conversation details
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const body = await request.json().catch(() => null);
    const contactName = typeof body?.contactName === 'string' ? body.contactName : '';

    const result = await conversationController.updateConversationName(
      parseInt(id),
      auth.user.id,
      contactName
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] PATCH /conversations/:id error:', error);
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
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
    
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
