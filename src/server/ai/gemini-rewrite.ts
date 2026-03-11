import 'server-only';

// Dependency note:
// Gemini request/response changes here must stay aligned with:
// - src/app/api/ai/rewrite/route.ts
// - src/lib/types/ai.ts
// - src/components/chat/MessageRewritePopover.tsx

import { Logger } from '@/lib/logger';
import {
  AI_TRANSLATION_LANGUAGE_OPTIONS,
  type AssistMessageResult,
  type MessageAssistMode,
  type TranslationLanguageCode,
} from '@/lib/types/ai';
import {
  createEmptyResponseError,
  createInvalidModelOutputError,
  normalizeGeminiFetchError,
  normalizeGeminiFinishReason,
  normalizeGeminiHttpError,
  normalizeGeminiPromptBlock,
} from '@/server/ai/gemini-error';

const log = new Logger('GeminiRewrite');
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 15_000;

interface AssistMessageInput {
  text: string;
  conversationId?: string;
  userId: string;
  mode: MessageAssistMode;
  targetLanguage?: TranslationLanguageCode;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

function getTargetLanguageLabel(code: TranslationLanguageCode): string {
  const match = AI_TRANSLATION_LANGUAGE_OPTIONS.find((option) => option.code === code);
  if (match) {
    return match.label;
  }

  return code;
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  return apiKey;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

function getGeminiBaseUrl(): string {
  return process.env.GEMINI_API_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL;
}

function getTimeoutMs(): number {
  const raw = Number(process.env.GEMINI_REWRITE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function getTemperature(mode: MessageAssistMode): number {
  const envKey =
    mode === 'translate'
      ? process.env.GEMINI_TRANSLATE_TEMPERATURE
      : process.env.GEMINI_REWRITE_TEMPERATURE;
  const raw = Number(envKey);
  if (Number.isFinite(raw)) {
    return raw;
  }

  return mode === 'translate' ? 0.3 : 0.7;
}

function getTopP(): number {
  const raw = Number(process.env.GEMINI_REWRITE_TOP_P);
  return Number.isFinite(raw) ? raw : 0.9;
}

function getMaxOutputTokens(mode: MessageAssistMode): number {
  const rewriteRaw = Number(process.env.GEMINI_REWRITE_MAX_OUTPUT_TOKENS);
  const translateRaw = Number(process.env.GEMINI_TRANSLATE_MAX_OUTPUT_TOKENS);

  const rewriteFallback = Number.isFinite(rewriteRaw) && rewriteRaw > 0 ? Math.floor(rewriteRaw) : 800;
  const translateFallback =
    Number.isFinite(translateRaw) && translateRaw > 0 ? Math.floor(translateRaw) : 600;

  return mode === 'translate' ? translateFallback : rewriteFallback;
}

function buildRewritePrompt(text: string): string {
  return [
    'You rewrite WhatsApp chat drafts for customer communication.',
    'Return exactly one JSON object with keys "professional" and "alternative".',
    'Rules:',
    '- Keep the original language used by the user. Do not translate unless the input is mixed and translation is required for clarity.',
    '- Preserve names, phone numbers, URLs, dates, currencies, amounts, order IDs, and placeholders exactly.',
    '- Keep the meaning unchanged.',
    '- "professional" should be polished, respectful, and business-appropriate.',
    '- "alternative" should be a different natural variation with the same intent.',
    '- Do not wrap the JSON in markdown fences.',
    '',
    'User draft:',
    text,
  ].join('\n');
}

function buildTranslationPrompt(text: string, targetLanguageLabel: string): string {
  return [
    'You translate WhatsApp chat drafts for customer communication.',
    'Return exactly one JSON object with the key "translated".',
    `Translate the message into ${targetLanguageLabel}.`,
    'Rules:',
    '- Preserve names, phone numbers, URLs, dates, currencies, amounts, order IDs, and placeholders exactly.',
    '- Preserve the original meaning and tone.',
    '- Keep the output natural and ready to send in chat.',
    '- Do not add explanation, notes, or markdown fences.',
    '',
    'User draft:',
    text,
  ].join('\n');
}

function extractCandidateText(payload: GeminiGenerateContentResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return text;
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseRewriteResponse(rawText: string): AssistMessageResult['rewrite'] {
  const cleaned = stripMarkdownFence(rawText);
  const jsonCandidate = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    throw createInvalidModelOutputError('Gemini returned an invalid rewrite payload');
  }

  const professional =
    typeof (parsed as { professional?: unknown }).professional === 'string'
      ? (parsed as { professional: string }).professional.trim()
      : '';
  const alternativeSource =
    (parsed as { alternative?: unknown; alternate?: unknown; variation?: unknown }).alternative ??
    (parsed as { alternate?: unknown }).alternate ??
    (parsed as { variation?: unknown }).variation;
  const alternative = typeof alternativeSource === 'string' ? alternativeSource.trim() : '';

  if (!professional || !alternative) {
    throw createInvalidModelOutputError('Gemini response is missing rewrite variants');
  }

  return {
    professional,
    alternative,
  };
}

function parseTranslationResponse(
  rawText: string,
  targetLanguage: TranslationLanguageCode
): AssistMessageResult['translation'] {
  const cleaned = stripMarkdownFence(rawText);
  const jsonCandidate = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    throw createInvalidModelOutputError('Gemini returned an invalid translation payload');
  }

  const translatedSource =
    (parsed as { translated?: unknown; translation?: unknown }).translated ??
    (parsed as { translation?: unknown }).translation;
  const translated = typeof translatedSource === 'string' ? translatedSource.trim() : '';

  if (!translated) {
    throw createInvalidModelOutputError('Gemini response is missing translated text');
  }

  return {
    translated,
    targetLanguage,
    targetLanguageLabel: getTargetLanguageLabel(targetLanguage),
  };
}

export async function rewriteMessageWithGemini(
  input: AssistMessageInput
): Promise<AssistMessageResult> {
  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();
  const baseUrl = getGeminiBaseUrl();
  const timeoutMs = getTimeoutMs();
  const targetLanguage = input.targetLanguage || 'en';
  const targetLanguageLabel = getTargetLanguageLabel(targetLanguage);

  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              input.mode === 'translate'
                ? buildTranslationPrompt(input.text, targetLanguageLabel)
                : buildRewritePrompt(input.text),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: getTemperature(input.mode),
      topP: getTopP(),
      maxOutputTokens: getMaxOutputTokens(input.mode),
      candidateCount: 1,
    },
  };

  log.info('Requesting Gemini rewrite', {
    userId: input.userId,
    conversationId: input.conversationId || null,
    model,
    mode: input.mode,
    targetLanguage: input.mode === 'translate' ? targetLanguage : null,
    inputLength: input.text.length,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = (await response.json().catch(() => null)) as GeminiGenerateContentResponse | null;

    if (!response.ok) {
      const normalizedError = normalizeGeminiHttpError(response.status, payload?.error || null);

      log.error('Gemini rewrite request failed', {
        userId: input.userId,
        conversationId: input.conversationId || null,
        model,
        mode: input.mode,
        status: response.status,
        errorCode: normalizedError.code,
        error: normalizedError.providerMessage || normalizedError.userMessage,
      });

      throw normalizedError;
    }

    const promptBlock = normalizeGeminiPromptBlock(payload?.promptFeedback);
    if (promptBlock) {
      throw promptBlock;
    }

    const rawText = payload ? extractCandidateText(payload) : '';
    if (!rawText) {
      throw createEmptyResponseError();
    }

    const finishReason = payload?.candidates?.[0]?.finishReason;
    if (input.mode === 'translate') {
      const translation = parseTranslationResponse(rawText, targetLanguage);
      const finishReasonError = normalizeGeminiFinishReason(finishReason);
      if (finishReasonError && finishReasonError.code !== 'candidate_max_tokens') {
        throw finishReasonError;
      }

      if (finishReasonError?.code === 'candidate_max_tokens') {
        log.warn('Gemini translation hit MAX_TOKENS but returned valid output', {
          userId: input.userId,
          conversationId: input.conversationId || null,
          model,
          mode: input.mode,
        });
      }

      return {
        mode: 'translate',
        model,
        translation,
      };
    }

    const rewrite = parseRewriteResponse(rawText);
    const finishReasonError = normalizeGeminiFinishReason(finishReason);
    if (finishReasonError && finishReasonError.code !== 'candidate_max_tokens') {
      throw finishReasonError;
    }

    if (finishReasonError?.code === 'candidate_max_tokens') {
      log.warn('Gemini rewrite hit MAX_TOKENS but returned valid output', {
        userId: input.userId,
        conversationId: input.conversationId || null,
        model,
        mode: input.mode,
      });
    }

    return {
      mode: 'rewrite',
      model,
      rewrite,
    };
  } catch (error) {
    const normalizedError = normalizeGeminiFetchError(error);

    log.error('Gemini assist failed', {
      userId: input.userId,
      conversationId: input.conversationId || null,
      model,
      mode: input.mode,
      errorCode: normalizedError.code,
      error: normalizedError.providerMessage || normalizedError.userMessage,
    });

    throw normalizedError;
  }
}
