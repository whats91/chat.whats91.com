'use client';

import { useEffect } from 'react';
import { Check, Loader2, Mic, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useVoiceRecorder } from '@/hooks/use-voice-recorder';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface VoiceMessageButtonProps {
  conversationId: string;
  disabled?: boolean;
  className?: string;
  onSent?: () => Promise<void> | void;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function VoiceMessageButton({
  conversationId,
  disabled = false,
  className,
  onSent,
}: VoiceMessageButtonProps) {
  const recorder = useVoiceRecorder({
    conversationId,
    disabled,
    onSent,
  });

  useEffect(() => {
    if (recorder.state === 'error' && recorder.error) {
      toast({
        title: 'Voice note failed',
        description: recorder.error,
        variant: 'destructive',
      });
    }
  }, [recorder.error, recorder.state]);

  const tooltipLabel =
    recorder.state === 'recording'
      ? `Stop and send voice note (${formatDuration(recorder.durationSeconds)})`
      : recorder.state === 'processing'
        ? 'Processing voice note'
        : recorder.state === 'sent'
          ? 'Voice note sent'
          : recorder.state === 'error'
            ? recorder.error || 'Voice note failed'
            : 'Record voice note';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 flex-shrink-0',
              recorder.state === 'recording' && 'text-destructive animate-pulse',
              recorder.state === 'sent' && 'text-emerald-600',
              recorder.state === 'error' && 'text-destructive',
              className
            )}
            disabled={disabled || !recorder.isSupported || recorder.state === 'processing'}
            onClick={() => void recorder.toggleRecording()}
            aria-pressed={recorder.state === 'recording'}
            aria-label={tooltipLabel}
          >
            {recorder.state === 'processing' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : recorder.state === 'sent' ? (
              <Check className="h-5 w-5" />
            ) : recorder.state === 'error' ? (
              <TriangleAlert className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default VoiceMessageButton;
