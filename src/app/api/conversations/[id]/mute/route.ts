import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getCurrentUserId();

    const result = await conversationController.toggleMute(parseInt(id, 10), userId);

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] PATCH /conversations/:id/mute error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
