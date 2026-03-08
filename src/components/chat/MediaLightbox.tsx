'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { isRenderableMediaUrl } from '@/lib/media/conversation-media';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import type { Message } from '@/lib/types/chat';
import { cn } from '@/lib/utils';
import { Download, Forward, X } from 'lucide-react';

interface MediaLightboxProps {
  open: boolean;
  message: Message | null;
  onOpenChange: (open: boolean) => void;
  onForward?: (message: Message) => void;
}

function buildDownloadFilename(message: Message, fallbackType: string): string {
  if (message.mediaFilename?.trim()) {
    return message.mediaFilename.trim();
  }

  const safeType = fallbackType || 'media';
  return `${safeType}-${message.id}`;
}

export function MediaLightbox({
  open,
  message,
  onOpenChange,
  onForward,
}: MediaLightboxProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const resolved = useMemo(() => (message ? resolveMessageForRendering(message) : null), [message]);

  const canRender =
    resolved &&
    ['image', 'video', 'sticker'].includes(resolved.type) &&
    isRenderableMediaUrl(resolved.mediaUrl);
  const canForward = resolved && ['image', 'video', 'sticker'].includes(resolved.type);
  const caption = resolved?.mediaCaption || (resolved?.content && !/^\[[^\]]+\]$/.test(resolved.content) ? resolved.content : null);

  const handleDownload = async () => {
    if (!resolved?.mediaUrl || !message || isDownloading) {
      return;
    }

    try {
      setIsDownloading(true);

      const response = await fetch(resolved.mediaUrl, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = buildDownloadFilename(message, resolved.type);
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    } catch (error) {
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Unable to download this media right now.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open && Boolean(message)} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 border-0 bg-black/95 p-0 text-white shadow-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Media viewer</DialogTitle>
        </DialogHeader>

        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {resolved?.mediaFilename || (resolved ? resolved.type[0].toUpperCase() + resolved.type.slice(1) : 'Media')}
              </p>
              {caption ? (
                <p className="mt-1 max-w-2xl text-sm text-white/75">
                  {caption}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {canForward && message && onForward ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/10 hover:text-white"
                  onClick={() => onForward(message)}
                >
                  <Forward className="h-5 w-5" />
                  <span className="sr-only">Forward media</span>
                </Button>
              ) : null}

              {canRender ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/10 hover:text-white"
                  disabled={isDownloading}
                  onClick={() => {
                    void handleDownload();
                  }}
                >
                  <Download className="h-5 w-5" />
                  <span className="sr-only">Download media</span>
                </Button>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-5 w-5" />
                <span className="sr-only">Close viewer</span>
              </Button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center p-6 pt-2">
            {canRender && resolved ? (
              resolved.type === 'video' ? (
                <video
                  src={resolved.mediaUrl!}
                  controls
                  autoPlay
                  className="max-h-[82vh] max-w-[92vw] rounded-lg bg-black"
                />
              ) : (
                <img
                  src={resolved.mediaUrl!}
                  alt={caption || resolved.type}
                  className={cn(
                    'max-h-[82vh] max-w-[92vw] rounded-lg bg-black/20 object-contain',
                    resolved.type === 'sticker' && 'p-4'
                  )}
                />
              )
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
                This media cannot be previewed here.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
