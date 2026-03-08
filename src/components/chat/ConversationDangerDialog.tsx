'use client';

import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useChatStore } from '@/stores/chatStore';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConversationDangerDialogProps {
  action: 'clear' | 'delete' | null;
  conversationId: string | null;
  conversationName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConversationDangerDialog({
  action,
  conversationId,
  conversationName,
  open,
  onOpenChange,
}: ConversationDangerDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { clearConversation, deleteConversation } = useChatStore();

  if (!action || !conversationId) {
    return null;
  }

  const isClearAction = action === 'clear';
  const title = isClearAction ? 'Clear chat?' : 'Delete conversation?';
  const description = isClearAction
    ? `This removes all messages for ${conversationName || 'this contact'} under the current user only. The conversation stays in the list.`
    : `This removes the conversation and all messages for ${conversationName || 'this contact'} under the current user only.`;
  const confirmLabel = isClearAction ? 'Clear chat' : 'Delete conversation';

  const handleConfirm = async () => {
    if (!conversationId) {
      return;
    }

    try {
      setIsPending(true);

      if (isClearAction) {
        await clearConversation(conversationId);
      } else {
        await deleteConversation(conversationId);
      }

      onOpenChange(false);
      toast({
        title: isClearAction ? 'Chat cleared' : 'Conversation deleted',
        description: conversationName || undefined,
      });
    } catch (error) {
      toast({
        title: isClearAction ? 'Unable to clear chat' : 'Unable to delete conversation',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? 'Working...' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
