import { NextResponse } from 'next/server';
import { downloadAndCacheConversationMedia } from '@/server/media/conversation-media-service';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;
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
