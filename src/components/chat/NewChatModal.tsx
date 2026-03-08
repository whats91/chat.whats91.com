'use client';

import { ConversationTargetPickerDialog } from '@/components/chat/ConversationTargetPickerDialog';
import { startConversation } from '@/lib/api/client';
import type { ConversationTarget } from '@/lib/types/chat';
import { toast } from '@/hooks/use-toast';
import { useChatStore } from '@/stores/chatStore';

interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewChatModal({ open, onOpenChange }: NewChatModalProps) {
  const { selectConversation, loadConversations } = useChatStore();

  const handleSelect = async (target: ConversationTarget) => {
    let conversationId = target.conversationId;

    if (!conversationId) {
      const response = await startConversation({
        phone: target.phone,
        contactName: target.contactName,
      });

      if (!response.success || !response.data) {
        toast({
          title: 'Unable to start chat',
          description: response.message || 'The conversation could not be opened.',
          variant: 'destructive',
        });
        throw new Error(response.message || 'Unable to start chat');
      }

      conversationId = response.data.conversationId;
    }

    await loadConversations();
    await selectConversation(conversationId);
    onOpenChange(false);
  };

  return (
    <ConversationTargetPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Chat"
      description="Pick a recent conversation or any saved contact."
      onSelect={handleSelect}
    />
  );
}
