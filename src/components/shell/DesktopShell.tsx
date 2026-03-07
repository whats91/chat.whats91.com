'use client';

import { ChatList } from '@/components/chat/ChatList';
import { ConversationView } from '@/components/chat/ConversationView';
import { RightInfoPanel } from '@/components/chat/RightInfoPanel';
import { useChatStore } from '@/stores/chatStore';

export function DesktopShell() {
  const { selectedConversationId, isRightPanelOpen } = useChatStore();
  
  return (
    <>
      {/* Sidebar */}
      <div className="w-96 border-r flex-shrink-0">
        <ChatList />
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex">
        {selectedConversationId ? (
          <>
            <div className="flex-1 flex flex-col">
              <ConversationView conversationId={selectedConversationId} />
            </div>
            {isRightPanelOpen && (
              <RightInfoPanel conversationId={selectedConversationId} />
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-muted/30 text-muted-foreground p-8">
      <div className="w-64 h-64 mb-8 opacity-20">
        <svg viewBox="0 0 200 200" fill="currentColor">
          <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="8" />
          <path d="M60 100 L85 125 L140 70" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-2xl font-light mb-2">WhatsApp Web</h2>
      <p className="text-center max-w-sm">
        Send and receive messages without keeping your phone online.
        <br />
        Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
      </p>
      <div className="mt-8 text-xs text-muted-foreground/60">
        <p>🔒 End-to-end encrypted</p>
      </div>
    </div>
  );
}
