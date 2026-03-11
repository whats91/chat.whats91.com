'use client';

// Dependency note:
// Rewrite UI changes here must stay aligned with:
// - src/lib/api/client.ts
// - src/lib/types/ai.ts
// - src/app/api/ai/rewrite/route.ts
// - src/server/ai/gemini-rewrite.ts

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { rewriteMessageDraft } from '@/lib/api/client';
import type { RewriteMessageChoices } from '@/lib/types/ai';
import { cn } from '@/lib/utils';
import { Loader2, RefreshCcw, Sparkles } from 'lucide-react';

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
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<RewriteMessageChoices | null>(null);
  const [lastRequestedText, setLastRequestedText] = useState('');
  const trimmedText = useMemo(() => text.trim(), [text]);

  const generateRewrites = async () => {
    if (!trimmedText || disabled) {
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await rewriteMessageDraft({
        text: trimmedText,
        conversationId,
      });

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Unable to rewrite the message');
      }

      setChoices(response.data);
      setLastRequestedText(trimmedText);
    } catch (error) {
      setChoices(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to rewrite the message');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !trimmedText || disabled) {
      return;
    }

    if (choices && lastRequestedText === trimmedText) {
      return;
    }

    void generateRewrites();
  }, [choices, disabled, lastRequestedText, open, trimmedText]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!trimmedText) {
      setChoices(null);
      setErrorMessage(null);
      setLastRequestedText('');
    }
  }, [open, trimmedText]);

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
            <p className="text-sm font-semibold text-foreground">Rewrite with AI</p>
            <p className="text-xs text-muted-foreground">
              Generates two polished versions in the same language as your draft.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={disabled || !trimmedText || isLoading}
            onClick={() => void generateRewrites()}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>

        {!trimmedText ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            Type a message first to generate rewrites.
          </div>
        ) : null}

        {trimmedText && isLoading ? (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-card/60 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating rewrite suggestions...
          </div>
        ) : null}

        {trimmedText && !isLoading && errorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-4 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {choices && !isLoading ? (
          <div className="space-y-3">
            <RewriteCard
              title="Professional"
              value={choices.professional}
              onApply={() => handleApply(choices.professional)}
            />
            <RewriteCard
              title="Alternative"
              value={choices.alternative}
              onApply={() => handleApply(choices.alternative)}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
