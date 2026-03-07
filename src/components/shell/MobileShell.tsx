'use client';

import { ChatList } from '@/components/chat/ChatList';
import { ConversationView } from '@/components/chat/ConversationView';
import { useChatStore } from '@/stores/chatStore';

export function MobileShell() {
  const { selectedConversationId, selectConversation } = useChatStore();
  
  const handleBack = () => {
    selectConversation(null);
  };
  
  return selectedConversationId ? (
    <div className="flex-1 flex flex-col">
      <ConversationView
        conversationId={selectedConversationId}
        onBack={handleBack}
        showBackButton
      />
    </div>
  ) : (
    <div className="flex-1">
      <ChatList />
    </div>
  );
}
