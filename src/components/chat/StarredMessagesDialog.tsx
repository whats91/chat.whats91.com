'use client';

import { useEffect, useState } from 'react';
import { fetchStarredMessages } from '@/lib/api/client';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import { formatTimeInIst } from '@/lib/time/ist';
import type { Message } from '@/lib/types/chat';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Pin, Star } from 'lucide-react';

interface StarredMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationName: string;
}

function normalizeMessage(message: Message): Message {
  return {
    ...message,
    timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
    readAt: message.readAt ? new Date(message.readAt) : null,
  };
}

function getMessagePreview(message: Message): string {
  const resolved = resolveMessageForRendering(message);

  return (
    resolved.content ||
    resolved.mediaCaption ||
    resolved.mediaFilename ||
    resolved.locationData?.name ||
    `[${resolved.type}]`
  );
}

export function StarredMessagesDialog({
  open,
  onOpenChange,
  conversationId,
  conversationName,
}: StarredMessagesDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetchStarredMessages(conversationId, { limit: 200 });
        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setMessages([]);
          setError(response.message || 'Unable to load starred messages');
          return;
        }

        setMessages(response.data.messages.map(normalizeMessage));
      } catch (loadError) {
        if (!cancelled) {
          setMessages([]);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load starred messages');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [conversationId, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Starred Messages</DialogTitle>
          <DialogDescription>{conversationName}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Loading starred messages...
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="py-10 text-center text-sm text-destructive">{error}</div>
            ) : null}

            {!isLoading && !error && messages.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No starred messages in this chat yet.
              </div>
            ) : null}

            {!isLoading && !error
              ? messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'rounded-lg border p-3',
                      message.direction === 'outbound' ? 'bg-primary/5' : 'bg-muted/40'
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">
                          {message.direction === 'outbound' ? 'You' : 'Contact'}
                        </Badge>
                        {message.isPinned ? (
                          <span className="inline-flex items-center gap-1">
                            <Pin className="h-3 w-3" />
                            <span>Pinned</span>
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Star className="h-3 w-3 fill-current" />
                          <span>Starred</span>
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeInIst(message.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm leading-6 break-words">{getMessagePreview(message)}</p>
                  </div>
                ))
              : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
