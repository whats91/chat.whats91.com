import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = getCurrentUserId();
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '250', 10);

    const result = await conversationController.getConversationMediaMessages(
      parseInt(id, 10),
      userId,
      limit
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load conversation media',
      },
      { status: 500 }
    );
  }
}
