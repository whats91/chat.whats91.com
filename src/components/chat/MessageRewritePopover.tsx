'use client';

// Dependency note:
// AI assist UI changes here must stay aligned with:
// - src/lib/api/client.ts
// - src/lib/types/ai.ts
// - src/app/api/ai/rewrite/route.ts
// - src/server/ai/gemini-rewrite.ts

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { assistMessageDraft } from '@/lib/api/client';
import {
  AI_TRANSLATION_LANGUAGE_OPTIONS,
  type AssistMessageResult,
  type MessageAssistMode,
  type TranslationLanguageCode,
} from '@/lib/types/ai';
import { cn } from '@/lib/utils';
import { Languages, Loader2, RefreshCcw, Sparkles } from 'lucide-react';

interface MessageRewritePopoverProps {
  text: string;
  conversationId: string;
  disabled?: boolean;
  onApply: (value: string) => void;
  buttonClassName?: string;
  iconClassName?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
}

interface RewriteCardProps {
  title: string;
  value: string;
  onApply: () => void;
}

function RewriteCard({ title, value, onApply }: RewriteCardProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={onApply}>
          Use this
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">{value}</p>
    </div>
  );
}

function getLanguageDisplayName(language: (typeof AI_TRANSLATION_LANGUAGE_OPTIONS)[number]): string {
  return 'nativeLabel' in language && language.nativeLabel
    ? `${language.label} (${language.nativeLabel})`
    : language.label;
}

export function MessageRewritePopover({
  text,
  conversationId,
  disabled = false,
  onApply,
  buttonClassName,
  iconClassName,
  contentClassName,
  align = 'end',
}: MessageRewritePopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MessageAssistMode>('rewrite');
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguageCode>('en');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AssistMessageResult | null>(null);
  const [lastRequestedKey, setLastRequestedKey] = useState('');
  const trimmedText = useMemo(() => text.trim(), [text]);
  const rewriteResult = result?.mode === 'rewrite' ? result.rewrite ?? null : null;
  const translationResult = result?.mode === 'translate' ? result.translation ?? null : null;
  const requestKey = useMemo(
    () => `${mode}:${targetLanguage}:${trimmedText}`,
    [mode, targetLanguage, trimmedText]
  );

  const generateAssistResult = async () => {
    if (!trimmedText || disabled) {
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await assistMessageDraft({
        text: trimmedText,
        conversationId,
        mode,
        targetLanguage: mode === 'translate' ? targetLanguage : undefined,
      });

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Unable to process the message');
      }

      setResult(response.data);
      setLastRequestedKey(requestKey);
    } catch (error) {
      setResult(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to process the message');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !trimmedText || disabled) {
      return;
    }

    if (result && lastRequestedKey === requestKey) {
      return;
    }

    void generateAssistResult();
  }, [disabled, lastRequestedKey, open, requestKey, result, trimmedText]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!trimmedText) {
      setResult(null);
      setErrorMessage(null);
      setLastRequestedKey('');
    }
  }, [open, trimmedText]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setResult(null);
    setErrorMessage(null);
  }, [mode, open, targetLanguage]);

  const handleApply = (value: string) => {
    onApply(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !trimmedText}
          className={cn('h-7 w-7 rounded-full', buttonClassName)}
        >
          <Sparkles className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className={cn('w-[min(26rem,calc(100vw-1rem))] space-y-3 p-3', contentClassName)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">AI assist</p>
            <p className="text-xs text-muted-foreground">
              Rewrite or translate the current draft without leaving the composer.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={disabled || !trimmedText || isLoading}
            onClick={() => void generateAssistResult()}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as MessageAssistMode)}
          className="gap-3"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rewrite">Rewrite</TabsTrigger>
            <TabsTrigger value="translate">Translate</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'translate' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Target language</p>
            <Select
              value={targetLanguage}
              onValueChange={(value) => setTargetLanguage(value as TranslationLanguageCode)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {AI_TRANSLATION_LANGUAGE_OPTIONS.map((language) => (
                  <SelectItem key={language.code} value={language.code}>
                    <span className="flex items-center gap-2">
                      <Languages className="h-3.5 w-3.5 opacity-60" />
                      <span>{getLanguageDisplayName(language)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {!trimmedText ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            Type a message first to use AI assist.
          </div>
        ) : null}

        {trimmedText && isLoading ? (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-card/60 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {mode === 'translate' ? 'Generating translation...' : 'Generating rewrite suggestions...'}
          </div>
        ) : null}

        {trimmedText && !isLoading && errorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-4 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {rewriteResult && !isLoading ? (
          <div className="space-y-3">
            <RewriteCard
              title="Professional"
              value={rewriteResult.professional}
              onApply={() => handleApply(rewriteResult.professional)}
            />
            <RewriteCard
              title="Alternative"
              value={rewriteResult.alternative}
              onApply={() => handleApply(rewriteResult.alternative)}
            />
          </div>
        ) : null}

        {translationResult && !isLoading ? (
          <RewriteCard
            title={`Translated to ${translationResult.targetLanguageLabel}`}
            value={translationResult.translated}
            onApply={() => handleApply(translationResult.translated)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
