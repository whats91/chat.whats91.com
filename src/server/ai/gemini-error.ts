import 'server-only';

// Dependency note:
// Gemini error normalization changes here must stay aligned with:
// - src/lib/types/ai.ts
// - src/server/ai/gemini-rewrite.ts
// - src/app/api/ai/rewrite/route.ts
// - src/components/chat/MessageRewritePopover.tsx

import type { AssistMessageErrorCode } from '@/lib/types/ai';

interface GeminiErrorLike {
  message?: string;
  status?: string;
  details?: unknown[];
}

interface GeminiPromptFeedbackLike {
  blockReason?: string;
}

export interface AssistErrorDescriptor {
  code: AssistMessageErrorCode;
  message: string;
  retryable: boolean;
  statusCode: number;
  providerMessage?: string | null;
  providerStatus?: string | null;
}

export class GeminiAssistError extends Error {
  readonly code: AssistMessageErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly providerMessage?: string | null;
  readonly providerStatus?: string | null;

  constructor(descriptor: AssistErrorDescriptor) {
    super(descriptor.message);
    this.name = 'GeminiAssistError';
    this.code = descriptor.code;
    this.userMessage = descriptor.message;
    this.retryable = descriptor.retryable;
    this.statusCode = descriptor.statusCode;
    this.providerMessage = descriptor.providerMessage;
    this.providerStatus = descriptor.providerStatus;
  }
}

function buildError(
  code: AssistMessageErrorCode,
  message: string,
  retryable: boolean,
  statusCode: number,
  providerMessage?: string | null,
  providerStatus?: string | null
): GeminiAssistError {
  return new GeminiAssistError({
    code,
    message,
    retryable,
    statusCode,
    providerMessage,
    providerStatus,
  });
}

function toLower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function inferQuotaCode(message: string): AssistMessageErrorCode {
  const lower = message.toLowerCase();

  if (lower.includes('per day') || lower.includes('daily') || lower.includes('rpd')) {
    return 'quota_rpd';
  }

  if (
    lower.includes('token') ||
    lower.includes('tokens per minute') ||
    lower.includes('tpm')
  ) {
    return 'quota_tpm';
  }

  return 'quota_rpm';
}

export function createInvalidRequestError(message: string): GeminiAssistError {
  return buildError('invalid_request', message, false, 400);
}

export function normalizeGeminiFetchError(error: unknown): GeminiAssistError {
  if (error instanceof GeminiAssistError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return buildError(
        'service_timeout',
        'AI took too long to respond. Try a shorter message.',
        true,
        504,
        error.message
      );
    }

    if (
      error.message.includes('fetch failed') ||
      error.message.includes('network') ||
      error.message.includes('Failed to fetch')
    ) {
      return buildError(
        'service_unavailable',
        'AI service is unavailable right now. Please try again shortly.',
        true,
        503,
        error.message
      );
    }
  }

  return buildError(
    'unknown_ai_error',
    'AI could not process this request right now. Please try again.',
    true,
    500,
    error instanceof Error ? error.message : null
  );
}

export function normalizeGeminiHttpError(
  statusCode: number,
  errorPayload: GeminiErrorLike | null
): GeminiAssistError {
  const providerMessage = errorPayload?.message || null;
  const providerStatus = errorPayload?.status || null;
  const messageLower = toLower(providerMessage);
  const statusLower = toLower(providerStatus);

  if (
    messageLower.includes('reported as leaked') ||
    messageLower.includes('use another api key')
  ) {
    return buildError(
      'api_key_blocked',
      'AI service is temporarily unavailable.',
      false,
      403,
      providerMessage,
      providerStatus
    );
  }

  if (
    statusCode === 429 ||
    statusLower === 'resource_exhausted' ||
    messageLower.includes('quota') ||
    messageLower.includes('rate limit')
  ) {
    const quotaCode = inferQuotaCode(providerMessage || '');
    const quotaMessage =
      quotaCode === 'quota_rpd'
        ? "Today's AI quota has been reached. Please try again tomorrow."
        : quotaCode === 'quota_tpm'
          ? 'This message is too large for the current AI quota. Try shortening it.'
          : 'AI is temporarily unavailable due to usage limits. Please try again later.';

    return buildError(quotaCode, quotaMessage, true, 429, providerMessage, providerStatus);
  }

  if (
    statusCode === 400 &&
    (statusLower === 'failed_precondition' ||
      messageLower.includes('not available in your country') ||
      messageLower.includes('billing'))
  ) {
    return buildError(
      'billing_required',
      'AI assistance is not available for this project right now.',
      false,
      400,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode === 400 || statusLower === 'invalid_argument') {
    return buildError(
      'invalid_request',
      'AI request is invalid. Please try a shorter or simpler message.',
      false,
      400,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode === 403 || statusLower === 'permission_denied' || statusLower === 'unauthenticated') {
    return buildError(
      'permission_denied',
      'AI service is not configured correctly. Please contact support.',
      false,
      403,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode === 404 || statusLower === 'not_found') {
    return buildError(
      'resource_not_found',
      'The AI resource could not be found. Please try again later.',
      false,
      404,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode === 504 || statusLower === 'deadline_exceeded') {
    return buildError(
      'service_timeout',
      'AI took too long to respond. Try a shorter message.',
      true,
      504,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode === 503 || statusLower === 'unavailable') {
    return buildError(
      'service_unavailable',
      'AI service is busy right now. Please try again shortly.',
      true,
      503,
      providerMessage,
      providerStatus
    );
  }

  if (statusCode >= 500 || statusLower === 'internal') {
    return buildError(
      'service_internal',
      'AI service had a temporary issue. Please try again shortly.',
      true,
      500,
      providerMessage,
      providerStatus
    );
  }

  return buildError(
    'unknown_ai_error',
    'AI could not process this request right now. Please try again.',
    true,
    statusCode || 500,
    providerMessage,
    providerStatus
  );
}

export function normalizeGeminiPromptBlock(
  promptFeedback: GeminiPromptFeedbackLike | null | undefined
): GeminiAssistError | null {
  const blockReason = promptFeedback?.blockReason?.toUpperCase();
  if (!blockReason) {
    return null;
  }

  if (blockReason === 'SAFETY') {
    return buildError(
      'prompt_blocked_safety',
      "This message can't be processed by AI. Try rephrasing it.",
      false,
      400,
      blockReason
    );
  }

  if (
    blockReason === 'BLOCKLIST' ||
    blockReason === 'PROHIBITED_CONTENT' ||
    blockReason === 'IMAGE_SAFETY'
  ) {
    return buildError(
      'prompt_blocked_policy',
      'This message contains restricted content for AI processing.',
      false,
      400,
      blockReason
    );
  }

  return buildError(
    'prompt_blocked_other',
    'AI could not process this message. Try rephrasing it.',
    false,
    400,
    blockReason
  );
}

export function normalizeGeminiFinishReason(finishReason: string | null | undefined): GeminiAssistError | null {
  const reason = finishReason?.toUpperCase();
  if (!reason || reason === 'STOP') {
    return null;
  }

  if (reason === 'MAX_TOKENS') {
    return buildError(
      'candidate_max_tokens',
      'AI response was cut off. Try a shorter message.',
      true,
      400,
      reason
    );
  }

  if (reason === 'SAFETY') {
    return buildError(
      'candidate_safety',
      "AI couldn't rewrite this safely. Try rephrasing it.",
      false,
      400,
      reason
    );
  }

  if (reason === 'RECITATION') {
    return buildError(
      'candidate_recitation',
      'AI could not generate a safe variation for this message. Try changing the wording.',
      false,
      400,
      reason
    );
  }

  if (reason === 'LANGUAGE') {
    return buildError(
      'candidate_language',
      'This language is not currently supported for AI processing.',
      false,
      400,
      reason
    );
  }

  if (reason === 'SPII') {
    return buildError(
      'candidate_spii',
      'AI could not process sensitive personal information in this message.',
      false,
      400,
      reason
    );
  }

  if (reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') {
    return buildError(
      'candidate_policy',
      'This message contains restricted content for AI processing.',
      false,
      400,
      reason
    );
  }

  return buildError(
    'candidate_other',
    'AI could not complete this request. Please try again.',
    true,
    400,
    reason
  );
}

export function createEmptyResponseError(): GeminiAssistError {
  return buildError(
    'empty_model_response',
    'AI returned an empty response. Please try again.',
    true,
    502
  );
}

export function createInvalidModelOutputError(message: string): GeminiAssistError {
  return buildError(
    'invalid_model_output',
    'AI returned an invalid response. Please try again.',
    true,
    502,
    message
  );
}
