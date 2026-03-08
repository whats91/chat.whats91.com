import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { downloadAndCacheConversationMedia } from '@/server/media/conversation-media-service';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const userId = getCurrentUserId();
    const { messageId } = await params;

    const result = await downloadAndCacheConversationMedia({
      userId,
      messageId,
    });

    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        cached: result.success,
      },
      { status: result.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cache media',
      },
      { status: 500 }
    );
  }
}
