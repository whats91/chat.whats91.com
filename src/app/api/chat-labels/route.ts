import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const result = await conversationController.getUserChatLabels(auth.user.id);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] GET /chat-labels error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
