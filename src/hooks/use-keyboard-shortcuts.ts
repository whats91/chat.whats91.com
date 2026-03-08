'use client';

import { useEffect, useCallback } from 'react';
import { useChatStore, useShortcutsStore } from '@/stores/chatStore';

// Keyboard shortcuts mapping (WhatsApp Web style)
export const SHORTCUTS = {
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
} as const;

export function useKeyboardShortcuts() {
  const {
    selectedConversationId,
    isNewChatModalOpen,
    toggleNewChatModal,
    selectConversation,
    isRightPanelOpen,
    conversations,
  } = useChatStore();
  
  const { enabled: shortcutsEnabled } = useShortcutsStore();
  
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!shortcutsEnabled) return;
      
      // Check if we're in an input field
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      
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
        const searchInput = document.querySelector(
          'input[placeholder*="Search"]'
        ) as HTMLInputElement;
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
      
      // Next/Previous chat: Tab
      if (e.key === 'Tab' && !isCtrl) {
        e.preventDefault();
        const currentIndex = conversations.findIndex(
          (c) => c.id === selectedConversationId
        );
        const nextIndex = isShift
          ? (currentIndex - 1 + conversations.length) % conversations.length
          : (currentIndex + 1) % conversations.length;
        selectConversation(conversations[nextIndex]?.id);
        return;
      }
      
      // Archive chat: Ctrl/Cmd + E
      if (
        isCtrl &&
        e.key.toLowerCase() === SHORTCUTS.archiveChat.key &&
        selectedConversationId
      ) {
        e.preventDefault();
        void useChatStore.getState().archiveConversation(selectedConversationId);
        return;
      }
      
      // Pin chat: Ctrl/Cmd + P
      if (
        isCtrl &&
        e.key.toLowerCase() === SHORTCUTS.pinChat.key &&
        selectedConversationId
      ) {
        e.preventDefault();
        void useChatStore.getState().pinConversation(selectedConversationId);
        return;
      }
      
      // Mute chat: Ctrl/Cmd + M
      if (
        isCtrl &&
        e.key.toLowerCase() === SHORTCUTS.muteChat.key &&
        selectedConversationId
      ) {
        e.preventDefault();
        useChatStore.getState().muteConversation(selectedConversationId);
        return;
      }
    },
    [
      shortcutsEnabled,
      isNewChatModalOpen,
      toggleNewChatModal,
      selectedConversationId,
      isRightPanelOpen,
      conversations,
      selectConversation,
    ]
  );
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  return { shortcuts: SHORTCUTS };
}

// Format shortcut for display
export function formatShortcut(shortcut: (typeof SHORTCUTS)[keyof typeof SHORTCUTS]): string {
  const parts: string[] = [];
  if (shortcut.ctrl) {
    parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
  }
  if (shortcut.shift) {
    parts.push('Shift');
  }
  parts.push(shortcut.key.toUpperCase());
  return parts.join(' + ');
}
