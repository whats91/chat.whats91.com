import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

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
    const conversationNotes =
      typeof body?.conversationNotes === 'string' ? body.conversationNotes : '';

    const result = await conversationController.updateConversationNotes(
      parseInt(id),
      auth.user.id,
      conversationNotes
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] PATCH /conversations/:id/notes error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
