'use client';

import { useEffect, useState } from 'react';
import { fetchConversationMedia } from '@/lib/api/client';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import { formatTimeInIst } from '@/lib/time/ist';
import type { Message } from '@/lib/types/chat';
import { MessageBubbleContent } from '@/components/chat/MessageBubbleContent';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ConversationMediaDialogProps {
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

export function ConversationMediaDialog({
  open,
  onOpenChange,
  conversationId,
  conversationName,
}: ConversationMediaDialogProps) {
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

        const response = await fetchConversationMedia(conversationId, { limit: 300 });
        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setMessages([]);
          setError(response.message || 'Unable to load conversation media');
          return;
        }

        setMessages(response.data.messages.map(normalizeMessage));
      } catch (loadError) {
        if (!cancelled) {
          setMessages([]);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load conversation media');
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Media, Links, and Documents</DialogTitle>
          <DialogDescription>{conversationName}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Loading conversation media and links...
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="py-10 text-center text-sm text-destructive">{error}</div>
            ) : null}

            {!isLoading && !error && messages.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No media, links, or documents found in this conversation yet.
              </div>
            ) : null}

            {!isLoading && !error
              ? messages.map((message) => {
                  const resolved = resolveMessageForRendering(message);
                  const isOwn = message.direction === 'outbound';

                  return (
                    <div key={message.id} className="rounded-lg border p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">{isOwn ? 'You' : 'Contact'}</Badge>
                          <Badge variant="outline" className="capitalize">
                            {resolved.type}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatTimeInIst(message.timestamp)}
                        </span>
                      </div>
                      <MessageBubbleContent message={message} isOwn={isOwn} />
                    </div>
                  );
                })
              : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
