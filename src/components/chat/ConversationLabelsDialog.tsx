'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchConversationLabels } from '@/lib/api/client';
import type { ChatLabel } from '@/lib/types/chat';
import { useChatStore } from '@/stores/chatStore';
import { toast } from '@/hooks/use-toast';
import { Loader2, Tag } from 'lucide-react';

interface ConversationLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationName: string;
}

export function ConversationLabelsDialog({
  open,
  onOpenChange,
  conversationId,
  conversationName,
}: ConversationLabelsDialogProps) {
  const updateConversationLabels = useChatStore((state) => state.updateConversationLabels);
  const [availableLabels, setAvailableLabels] = useState<ChatLabel[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) {
      setAvailableLabels([]);
      setSelectedLabelIds([]);
      setIsLoading(false);
      setIsSaving(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadLabels = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetchConversationLabels(conversationId);

        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setAvailableLabels([]);
          setSelectedLabelIds([]);
          setError(response.message || 'Unable to load labels');
          return;
        }

        setAvailableLabels(response.data.availableLabels || []);
        setSelectedLabelIds((response.data.assignedLabels || []).map((label) => label.id));
      } catch (loadError) {
        if (!cancelled) {
          setAvailableLabels([]);
          setSelectedLabelIds([]);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load labels');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadLabels();

    return () => {
      cancelled = true;
    };
  }, [conversationId, open, reloadToken]);

  const selectedCount = selectedLabelIds.length;
  const hasLabels = availableLabels.length > 0;
  const selectedLabelNames = useMemo(
    () =>
      availableLabels
        .filter((label) => selectedLabelIds.includes(label.id))
        .map((label) => label.name),
    [availableLabels, selectedLabelIds]
  );

  const toggleLabelSelection = (labelId: string) => {
    setSelectedLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId]
    );
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      await updateConversationLabels(conversationId, selectedLabelIds);
      toast({
        title: 'Labels updated',
        description:
          selectedLabelIds.length > 0
            ? `${selectedLabelIds.length} label${selectedLabelIds.length === 1 ? '' : 's'} assigned to ${conversationName}.`
            : `All labels removed from ${conversationName}.`,
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save labels');
      toast({
        title: 'Unable to update labels',
        description: saveError instanceof Error ? saveError.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85vh,42rem)] w-[min(32rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Manage labels</DialogTitle>
          <DialogDescription>
            Assign one or more labels to {conversationName}.
          </DialogDescription>
          {selectedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Selected: {selectedLabelNames.join(', ')}
            </p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 border-y border-border/70">
          <ScrollArea className="h-full overscroll-contain px-3 py-3">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading labels...</span>
              </div>
            ) : error ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAvailableLabels([]);
                    setSelectedLabelIds([]);
                    setError(null);
                    setIsLoading(false);
                    setReloadToken((current) => current + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : !hasLabels ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
                <Tag className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No labels available</p>
                  <p className="text-xs text-muted-foreground">
                    Create labels for this WhatsApp number first, then assign them here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {availableLabels.map((label) => {
                  const isSelected = selectedLabelIds.includes(label.id);

                  return (
                    <button
                      key={label.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-3 text-left transition-colors hover:bg-accent/70"
                      onClick={() => toggleLabelSelection(label.id)}
                    >
                      <Checkbox checked={isSelected} className="pointer-events-none" />
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{label.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {label.phoneNumber}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            {isSaving ? 'Saving...' : 'Save labels'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
