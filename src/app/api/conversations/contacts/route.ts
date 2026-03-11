import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }
    const userId = auth.user.id;

    const result = await conversationController.getConversationTargets({
      userId,
      teamMemberId: auth.user.teamMemberId,
      search: searchParams.get('search') || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
      serviceWindowOnly: searchParams.get('serviceWindowOnly') === 'true',
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
