import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getCurrentUserId();

    const result = await conversationController.getPinnedMessage(parseInt(id, 10), userId);

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] GET /conversations/:id/messages/pinned error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
