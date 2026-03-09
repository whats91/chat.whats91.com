import { NextRequest, NextResponse } from 'next/server';
import { conversationController } from '@/server/controllers/conversation-controller';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { getExcelContentType } from '@/server/export/chat-excel';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const result = await conversationController.exportConversationExcel(parseInt(id, 10), auth.user.id);

    if (!result.success || !result.data) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.message === 'Conversation not found' ? 404 : 400 }
      );
    }

    return new NextResponse(new Uint8Array(result.data.buffer).buffer, {
      status: 200,
      headers: {
        'Content-Type': getExcelContentType(),
        'Content-Disposition': `attachment; filename="${result.data.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API] GET /conversations/:id/export error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
