import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import type { StartConversationRequest } from '@/lib/types/chat';
import { requireOwnerRouteUser } from '@/server/auth/route-auth';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartConversationRequest;
    const auth = await requireOwnerRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;

    if (!body.phone?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Phone is required', data: null },
        { status: 400 }
      );
    }

    const result = await conversationController.startConversation({
      userId,
      phone: body.phone,
      contactName: body.contactName,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[API] POST /conversations/start error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', data: null },
      { status: 500 }
    );
  }
}
