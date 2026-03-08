import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = getCurrentUserId();

    const result = await conversationController.getConversationTargets({
      userId,
      search: searchParams.get('search') || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] GET /conversations/contacts error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', data: null },
      { status: 500 }
    );
  }
}
