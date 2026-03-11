import { NextRequest, NextResponse } from 'next/server';

// Dependency note:
// Request/response changes here must stay aligned with:
// - src/lib/types/ai.ts
// - src/lib/api/client.ts
// - src/server/ai/gemini-rewrite.ts
// - src/components/chat/MessageRewritePopover.tsx

import type { RewriteMessageRequest, RewriteMessageResponse } from '@/lib/types/ai';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { rewriteMessageWithGemini } from '@/server/ai/gemini-rewrite';
import { Logger } from '@/lib/logger';

const log = new Logger('AIRoute');

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const body = (await request.json().catch(() => null)) as RewriteMessageRequest | null;
    const text = body?.text?.trim() || '';
    const conversationId = body?.conversationId?.trim() || undefined;

    if (!text) {
      return NextResponse.json<RewriteMessageResponse>(
        {
          success: false,
          message: 'Message text is required',
        },
        { status: 400 }
      );
    }

    if (text.length > 4000) {
      return NextResponse.json<RewriteMessageResponse>(
        {
          success: false,
          message: 'Message text is too long to rewrite',
        },
        { status: 400 }
      );
    }

    const data = await rewriteMessageWithGemini({
      text,
      conversationId,
      userId: auth.user.id,
    });

    return NextResponse.json<RewriteMessageResponse>({
      success: true,
      message: 'Rewrite generated successfully',
      data,
    });
  } catch (error) {
    log.error('POST /api/ai/rewrite error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json<RewriteMessageResponse>(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to generate rewrites',
      },
      { status: 500 }
    );
  }
}
