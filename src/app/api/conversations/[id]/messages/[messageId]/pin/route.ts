import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id, messageId } = await params;
    const userId = getCurrentUserId();

    const result = await conversationController.toggleMessagePinned(
      parseInt(id, 10),
      parseInt(messageId, 10),
      userId
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] PATCH /conversations/:id/messages/:messageId/pin error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
