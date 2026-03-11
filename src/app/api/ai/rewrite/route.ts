import { NextRequest, NextResponse } from 'next/server';

// Dependency note:
// Request/response changes here must stay aligned with:
// - src/lib/types/ai.ts
// - src/lib/api/client.ts
// - src/server/ai/gemini-rewrite.ts
// - src/components/chat/MessageRewritePopover.tsx

import {
  AI_TRANSLATION_LANGUAGE_OPTIONS,
  type AssistMessageRequest,
  type AssistMessageResponse,
} from '@/lib/types/ai';
import { requireAuthenticatedRouteUser } from '@/server/auth/route-auth';
import { rewriteMessageWithGemini } from '@/server/ai/gemini-rewrite';
import { Logger } from '@/lib/logger';

const log = new Logger('AIRoute');
const VALID_TRANSLATION_CODES = new Set(AI_TRANSLATION_LANGUAGE_OPTIONS.map((option) => option.code));

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedRouteUser();
    if ('response' in auth) {
      return auth.response;
    }

    const body = (await request.json().catch(() => null)) as AssistMessageRequest | null;
    const text = body?.text?.trim() || '';
    const conversationId = body?.conversationId?.trim() || undefined;
    const mode = body?.mode === 'translate' ? 'translate' : 'rewrite';
    const targetLanguage = body?.targetLanguage || 'en';

    if (!text) {
      return NextResponse.json<AssistMessageResponse>(
        {
          success: false,
          message: 'Message text is required',
        },
        { status: 400 }
      );
    }

    if (text.length > 4000) {
      return NextResponse.json<AssistMessageResponse>(
        {
          success: false,
          message: 'Message text is too long to process',
        },
        { status: 400 }
      );
    }

    if (mode === 'translate' && !VALID_TRANSLATION_CODES.has(targetLanguage)) {
      return NextResponse.json<AssistMessageResponse>(
        {
          success: false,
          message: 'Unsupported translation language',
        },
        { status: 400 }
      );
    }

    const data = await rewriteMessageWithGemini({
      text,
      conversationId,
      userId: auth.user.id,
      mode,
      targetLanguage,
    });

    return NextResponse.json<AssistMessageResponse>({
      success: true,
      message:
        mode === 'translate'
          ? 'Translation generated successfully'
          : 'Rewrite generated successfully',
      data,
    });
  } catch (error) {
    log.error('POST /api/ai/rewrite error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json<AssistMessageResponse>(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to process the AI request',
      },
      { status: 500 }
    );
  }
}
