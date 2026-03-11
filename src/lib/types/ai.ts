/**
 * Dependency note:
 * Changes here must stay aligned with:
 * - src/lib/api/client.ts
 * - src/app/api/ai/rewrite/route.ts
 * - src/server/ai/gemini-rewrite.ts
 * - src/components/chat/MessageRewritePopover.tsx
 */

export interface RewriteMessageRequest {
  text: string;
  conversationId?: string;
}

export interface RewriteMessageChoices {
  professional: string;
  alternative: string;
  model: string;
}

export interface RewriteMessageResponse {
  success: boolean;
  message: string;
  data?: RewriteMessageChoices;
}
