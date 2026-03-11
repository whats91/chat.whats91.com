/**
 * Dependency note:
 * Changes here must stay aligned with:
 * - src/lib/api/client.ts
 * - src/app/api/ai/rewrite/route.ts
 * - src/server/ai/gemini-rewrite.ts
 * - src/components/chat/MessageRewritePopover.tsx
 */

export type MessageAssistMode = 'rewrite' | 'translate';

export interface TranslationLanguageOption {
  code: string;
  label: string;
  nativeLabel?: string;
}

export const AI_TRANSLATION_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം' },
  { code: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ' },
  { code: 'ur', label: 'Urdu', nativeLabel: 'اردو' },
  { code: 'ne', label: 'Nepali', nativeLabel: 'नेपाली' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية' },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย' },
] as const satisfies readonly TranslationLanguageOption[];

export type TranslationLanguageCode =
  (typeof AI_TRANSLATION_LANGUAGE_OPTIONS)[number]['code'];

export interface AssistMessageRequest {
  text: string;
  conversationId?: string;
  mode: MessageAssistMode;
  targetLanguage?: TranslationLanguageCode;
}

export interface RewriteMessageChoices {
  professional: string;
  alternative: string;
}

export interface TranslationMessageResult {
  translated: string;
  targetLanguage: TranslationLanguageCode;
  targetLanguageLabel: string;
}

export interface AssistMessageResult {
  mode: MessageAssistMode;
  model: string;
  rewrite?: RewriteMessageChoices;
  translation?: TranslationMessageResult;
}

export interface AssistMessageResponse {
  success: boolean;
  message: string;
  data?: AssistMessageResult;
}
