import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/config/current-user';
import { conversationController } from '@/server/controllers/conversation-controller';
import type { StartConversationRequest } from '@/lib/types/chat';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartConversationRequest;
    const userId = getCurrentUserId();

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
