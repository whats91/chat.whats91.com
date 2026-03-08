'use client';

import { useEffect, useCallback } from 'react';
import type { Message } from '@/lib/types/chat';
import type {
  PubSubClientPayload,
  PubSubNewMessageEvent,
  PubSubStatusUpdateEvent,
} from '@/lib/types/pubsub';
import { useChatStore, useShortcutsStore } from '@/stores/chatStore';
import { ChatList } from '@/components/chat/ChatList';
import { ConversationView } from '@/components/chat/ConversationView';
import { RightInfoPanel } from '@/components/chat/RightInfoPanel';
import { NewChatModal } from '@/components/chat/NewChatModal';
import { VersionFooter } from '@/components/common/VersionFooter';
import { getCurrentUserId } from '@/lib/config/current-user';
import { usePubSub } from '@/hooks/use-pubsub';
import { debugPubSub } from '@/lib/pubsub/debug';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

// Keyboard shortcuts mapping (WhatsApp Web style)
const SHORTCUTS = {
  newChat: { key: 'n', ctrl: true, shift: false, description: 'New chat' },
  searchChat: { key: 'f', ctrl: true, shift: false, description: 'Search chat' },
  nextChat: { key: 'Tab', ctrl: false, shift: false, description: 'Next chat' },
  prevChat: { key: 'Tab', ctrl: false, shift: true, description: 'Previous chat' },
  focusComposer: { key: 'Enter', ctrl: false, shift: false, description: 'Focus message composer' },
  closePanel: { key: 'Escape', ctrl: false, shift: false, description: 'Close panel/modal' },
  archiveChat: { key: 'e', ctrl: true, shift: false, description: 'Archive chat' },
  pinChat: { key: 'p', ctrl: true, shift: false, description: 'Pin/unpin chat' },
  muteChat: { key: 'm', ctrl: true, shift: false, description: 'Mute/unmute chat' },
  deleteChat: { key: 'Backspace', ctrl: true, shift: false, description: 'Delete chat' },
};

function mapPubSubMessageToChatMessage(event: PubSubNewMessageEvent): Message {
  const userId = getCurrentUserId();
  const { conversation, messageRecord } = event.data;
  const contactPhone = conversation.contactPhone;

  return {
    id: String(messageRecord.id),
    conversationId: String(conversation.id),
    whatsappMessageId: messageRecord.whatsappMessageId,
    senderId: messageRecord.direction === 'inbound' ? contactPhone : userId,
    fromPhone: messageRecord.direction === 'inbound' ? contactPhone : userId,
    toPhone: messageRecord.direction === 'outbound' ? contactPhone : userId,
    direction: messageRecord.direction,
    content: messageRecord.messageContent,
    type: messageRecord.messageType as Message['type'],
    status: messageRecord.status as Message['status'],
    timestamp: new Date(messageRecord.timestamp),
    mediaUrl: messageRecord.mediaUrl || null,
    mediaMimeType: messageRecord.mediaMimeType || null,
    mediaFilename: messageRecord.mediaFilename || null,
    incomingPayload: messageRecord.incomingPayload || null,
    outgoingPayload: messageRecord.outgoingPayload || null,
    errorMessage: null,
    isRead: messageRecord.direction === 'outbound',
    isPinned: Boolean(messageRecord.isPinned),
    isStarred: Boolean(messageRecord.isStarred),
  };
}

export function AppShell() {
  const {
    selectedConversationId,
    isNewChatModalOpen,
    toggleNewChatModal,
    selectConversation,
    isRightPanelOpen,
    conversations,
    handleNewMessage,
    handleStatusUpdate,
    setSocketConnected,
  } = useChatStore();
  const isMobile = useIsMobile();
  const currentUserId = getCurrentUserId();

  const handlePubSubPayload = useCallback(
    (payload: PubSubClientPayload) => {
      debugPubSub('AppShell received payload', {
        payloadType: payload.type,
      });

      if (payload.type === 'new_message') {
        const event = payload as PubSubNewMessageEvent;
        debugPubSub('AppShell forwarding new_message to store', {
          conversationId: event.data.conversation.id,
          messageId: event.data.messageRecord.id,
          whatsappMessageId: event.data.messageRecord.whatsappMessageId,
        });
        handleNewMessage({
          conversationId: event.data.conversation.id,
          message: mapPubSubMessageToChatMessage(event),
        });
        return;
      }

      if (payload.type === 'status_update') {
        const event = payload as PubSubStatusUpdateEvent;
        debugPubSub('AppShell forwarding status_update to store', {
          conversationId: event.data.conversationId,
          messageId: event.data.messageId,
          status: event.data.status,
        });
        handleStatusUpdate({
          messageId: event.data.messageId,
          status: event.data.status,
          conversationId: event.data.conversationId,
        });
      }
    },
    [handleNewMessage, handleStatusUpdate]
  );

  usePubSub({
    userId: currentUserId,
    autoConnect: Boolean(currentUserId),
    onMessage: handlePubSubPayload,
    onConnectionChange: setSocketConnected,
  });
  
  // Keyboard shortcuts handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Check if we're in an input field
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Handle shortcuts
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      
      // New chat: Ctrl/Cmd + N
      if (isCtrl && e.key.toLowerCase() === SHORTCUTS.newChat.key) {
        e.preventDefault();
        toggleNewChatModal();
        return;
      }
      
      // Search: Ctrl/Cmd + F
      if (isCtrl && e.key.toLowerCase() === SHORTCUTS.searchChat.key) {
        e.preventDefault();
        // Focus search input
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
        searchInput?.focus();
        return;
      }
      
      // Escape: Close modals/panels
      if (e.key === 'Escape') {
        if (isNewChatModalOpen) {
          toggleNewChatModal();
        } else if (isRightPanelOpen) {
          useChatStore.getState().toggleRightPanel();
        }
        return;
      }
      
      // Don't process other shortcuts when typing
      if (isInputFocused) return;
      
      // Next chat: Tab
      if (e.key === 'Tab' && !isCtrl) {
        e.preventDefault();
        const currentIndex = conversations.findIndex(c => c.id === selectedConversationId);
        const nextIndex = isShift
          ? (currentIndex - 1 + conversations.length) % conversations.length
          : (currentIndex + 1) % conversations.length;
        selectConversation(conversations[nextIndex]?.id);
        return;
      }
      
      // Archive chat: Ctrl/Cmd + E
      if (isCtrl && e.key.toLowerCase() === SHORTCUTS.archiveChat.key && selectedConversationId) {
        e.preventDefault();
        void useChatStore.getState().archiveConversation(selectedConversationId);
        return;
      }
      
      // Pin chat: Ctrl/Cmd + P
      if (isCtrl && e.key.toLowerCase() === SHORTCUTS.pinChat.key && selectedConversationId) {
        e.preventDefault();
        void useChatStore.getState().pinConversation(selectedConversationId);
        return;
      }
      
      // Mute chat: Ctrl/Cmd + M
      if (isCtrl && e.key.toLowerCase() === SHORTCUTS.muteChat.key && selectedConversationId) {
        e.preventDefault();
        void useChatStore.getState().muteConversation(selectedConversationId);
        return;
      }
    },
    [isNewChatModalOpen, toggleNewChatModal, selectedConversationId, isRightPanelOpen, conversations, selectConversation]
  );
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  return (
    <>
      <div className="h-screen flex overflow-hidden">
        {isMobile ? (
          <MobileShell />
        ) : (
          <DesktopShell />
        )}
      </div>
      
      <NewChatModal open={isNewChatModalOpen} onOpenChange={toggleNewChatModal} />
      <VersionFooter />
    </>
  );
}

function DesktopShell() {
  const { selectedConversationId, isRightPanelOpen } = useChatStore();
  
  return (
    <>
      {/* Sidebar */}
      <div className="w-96 border-r flex-shrink-0 h-full">
        <ChatList />
      </div>
      
      {/* Main Content - h-full is critical for child height calculation */}
      <div className="flex-1 h-full flex overflow-hidden">
        {selectedConversationId ? (
          <>
            <div className="flex-1 h-full flex flex-col overflow-hidden">
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

function MobileShell() {
  const { selectedConversationId, selectConversation } = useChatStore();
  
  const handleBack = () => {
    selectConversation(null);
  };
  
  return selectedConversationId ? (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      <ConversationView
        conversationId={selectedConversationId}
        onBack={handleBack}
        showBackButton
      />
    </div>
  ) : (
    <div className="flex-1 h-full">
      <ChatList />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-muted/30 text-muted-foreground p-8">
      <div className="w-32 h-32 mb-6">
        <img src="/images/icon.png" alt="Whats91" className="w-full h-full object-contain" />
      </div>
      <h2 className="text-2xl font-light mb-2 text-foreground">Whats91 Chat</h2>
      <p className="text-center max-w-sm">
        Send and receive WhatsApp messages without keeping your phone online.
        <br />
        Use WhatsApp Business on up to 4 linked devices and 1 phone at the same time.
      </p>
      <div className="mt-8 text-xs text-muted-foreground/60">
        <p>🔒 End-to-end encrypted</p>
      </div>
    </div>
  );
}

// Export shortcuts for documentation/help
export { SHORTCUTS };
