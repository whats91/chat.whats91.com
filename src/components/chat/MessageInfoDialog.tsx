'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { fetchMessageInfo } from '@/lib/api/client';
import { formatDateInIst, formatTimeInIst } from '@/lib/time/ist';
import type { Message, MessageInfoResponse } from '@/lib/types/chat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, CheckCheck, Clock, Info, X } from 'lucide-react';

interface MessageInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: Message | null;
}

type MessageInfoData = NonNullable<MessageInfoResponse['data']>;

function formatMessageInfoTimestamp(value: string | Date | null): string {
  if (!value) {
    return 'Not available';
  }

  return `${formatDateInIst(value)} at ${formatTimeInIst(value)}`;
}

function StatusRow({
  label,
  value,
  icon,
  accentClassName,
}: {
  label: string;
  value: string | Date | null;
  icon: ReactNode;
  accentClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={accentClassName}>{icon}</span>
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{formatMessageInfoTimestamp(value)}</div>
        </div>
      </div>
    </div>
  );
}

export function MessageInfoDialog({
  open,
  onOpenChange,
  message,
}: MessageInfoDialogProps) {
  const [info, setInfo] = useState<MessageInfoData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !message) {
      return;
    }

    let cancelled = false;

    const loadInfo = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetchMessageInfo(message.conversationId, message.id);
        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setInfo(null);
          setError(response.message || 'Unable to load message info');
          return;
        }

        setInfo(response.data);
      } catch (loadError) {
        if (!cancelled) {
          setInfo(null);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load message info');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadInfo();

    return () => {
      cancelled = true;
    };
  }, [message, open]);

  const messagePreview = message?.content || `[${message?.type || 'message'}]`;
  const primaryLabel = info?.direction === 'inbound' ? 'Received' : 'Sent';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message Info</DialogTitle>
          <DialogDescription className="line-clamp-2 break-words">
            {messagePreview}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading message info...
            </div>
          ) : null}

          {!isLoading && error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!isLoading && !error && info ? (
            <>
              <StatusRow
                label={primaryLabel}
                value={info.sentAt}
                icon={<Clock className="h-4 w-4" />}
              />
              <StatusRow
                label="Delivered"
                value={info.deliveredAt}
                icon={<Check className="h-4 w-4" />}
              />
              <StatusRow
                label="Read"
                value={info.readAt}
                icon={<CheckCheck className="h-4 w-4" />}
                accentClassName={info.readAt ? 'text-[#53bdeb]' : undefined}
              />
              {info.failedAt || info.errorMessage ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium text-destructive">
                    <X className="h-4 w-4" />
                    Failed
                  </div>
                  <div className="text-xs text-destructive/90">
                    {formatMessageInfoTimestamp(info.failedAt)}
                  </div>
                  {info.errorMessage ? (
                    <div className="mt-2 text-xs text-destructive/90">{info.errorMessage}</div>
                  ) : null}
                </div>
              ) : null}
              <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <Info className="h-4 w-4" />
                  Current status
                </div>
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {info.status}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
