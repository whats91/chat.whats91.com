'use client';

// Dependency note:
// Live-event, notification, and shell-layout changes here usually require
// matching updates in:
// - src/hooks/use-pubsub.ts
// - src/lib/pubsub/client.ts
// - src/lib/types/pubsub.ts
// - src/stores/chatStore.ts
// - src/lib/notifications/service.ts
// - public/sw.js

import { useEffect, useCallback, useRef, useState } from 'react';
import type { Message } from '@/lib/types/chat';
import type {
  LegacyPubSubMessagePayload,
  LegacyPubSubStatusPayload,
  PubSubClientPayload,
  PubSubNewMessageEvent,
  PubSubStatusUpdateEvent,
} from '@/lib/types/pubsub';
import { useChatStore, useShortcutsStore } from '@/stores/chatStore';
import { ChatList } from '@/components/chat/ChatList';
import { ConversationView } from '@/components/chat/ConversationView';
import { RightInfoPanel } from '@/components/chat/RightInfoPanel';
import { NewChatModal } from '@/components/chat/NewChatModal';
import { getCurrentUserId } from '@/lib/config/current-user';
import { usePubSub } from '@/hooks/use-pubsub';
import { debugPubSub, logPubSubPayload } from '@/lib/pubsub/debug';
import { getNotificationPreferences } from '@/lib/notifications/preferences';
import { collectNotificationEnvironmentSnapshot, debugNotification } from '@/lib/notifications/debug';
import {
  getPermissionState as getNotificationPermissionState,
  isSecureNotificationContext,
  showMessageNotification,
  showPermissionGrantedNotification,
  showStatusNotification,
} from '@/lib/notifications/service';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotifications } from '@/hooks/use-notifications';
import { useServiceWorker } from '@/hooks/use-service-worker';

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

function ensureHttps(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  return url.replace(/^http:\/\//i, 'https://');
}

function normalizePayloadObject(
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  return value;
}

function parsePubSubTimestamp(
  ...candidates: Array<string | number | Date | null | undefined>
): Date {
  for (const candidate of candidates) {
    const parsed = parsePubSubTimestampCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return new Date();
}

function parsePubSubTimestampCandidate(
  candidate: string | number | Date | null | undefined
): Date | null {
  if (candidate instanceof Date) {
    return Number.isFinite(candidate.getTime()) ? candidate : null;
  }

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    const epochMilliseconds = candidate > 1e12 ? candidate : candidate * 1000;
    const parsed = new Date(epochMilliseconds);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const numericValue = Number(trimmed);
      if (Number.isFinite(numericValue)) {
        const epochMilliseconds = trimmed.length >= 13 ? numericValue : numericValue * 1000;
        const parsed = new Date(epochMilliseconds);
        if (Number.isFinite(parsed.getTime())) {
          return parsed;
        }
      }
    }

    const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

function parseLatestPubSubTimestamp(
  ...candidates: Array<string | number | Date | null | undefined>
): Date {
  let latestTimestamp: Date | null = null;

  for (const candidate of candidates) {
    const parsed = parsePubSubTimestampCandidate(candidate);
    if (!parsed) {
      continue;
    }

    if (!latestTimestamp || parsed.getTime() > latestTimestamp.getTime()) {
      latestTimestamp = parsed;
    }
  }

  return latestTimestamp || new Date();
}

function isLegacyStatusPayload(
  payload: PubSubClientPayload
): payload is LegacyPubSubStatusPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'messageId' in payload &&
      typeof payload.messageId === 'string' &&
      'status' in payload &&
      typeof payload.status === 'string' &&
      (('type' in payload && payload.type === 'status') ||
        ('eventType' in payload && payload.eventType === 'status_update'))
  );
}

function isLegacyMessagePayload(
  payload: PubSubClientPayload
): payload is LegacyPubSubMessagePayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'conversation' in payload &&
      'messageRecord' in payload &&
      payload.conversation &&
      payload.messageRecord
  );
}

function mapPubSubMessageToChatMessage(event: PubSubNewMessageEvent): Message {
  const userId = getCurrentUserId();
  const { conversation, messageRecord } = event.data;
  const contactPhone = conversation.contactPhone;
  const sortTimestamp = parseLatestPubSubTimestamp(event.timestamp, messageRecord.timestamp);

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
    timestamp: parsePubSubTimestamp(messageRecord.timestamp, event.timestamp),
    mediaUrl: messageRecord.mediaUrl || null,
    mediaMimeType: messageRecord.mediaMimeType || null,
    mediaFilename: messageRecord.mediaFilename || null,
    incomingPayload: messageRecord.incomingPayload || null,
    outgoingPayload: messageRecord.outgoingPayload || null,
    errorMessage: null,
    isRead: messageRecord.direction === 'outbound',
    isPinned: Boolean(messageRecord.isPinned),
    isStarred: Boolean(messageRecord.isStarred),
    metadata: {
      sortTimestamp: sortTimestamp.toISOString(),
    },
  };
}

function mapLegacyPubSubPayloadToChatMessage(
  payload: LegacyPubSubMessagePayload
): Message | null {
  const conversationId = payload.conversation?.id;
  const messageId = payload.messageRecord?.id;

  if (conversationId === undefined || messageId === undefined) {
    return null;
  }

  const userId = getCurrentUserId();
  const direction = payload.direction === 'outbound' ? 'outbound' : 'inbound';
  const media = payload.content?.media;
  const messageType = (payload.messageRecord?.messageType ||
    payload.type ||
    payload.content?.type ||
    'text') as Message['type'];
  const incomingPayload =
    normalizePayloadObject(payload.messageRecord?.incomingPayload) ||
    (direction === 'inbound' ? normalizePayloadObject(payload.webhook) : null);
  const outgoingPayload =
    normalizePayloadObject(payload.messageRecord?.outgoingPayload) ||
    (direction === 'outbound'
      ? normalizePayloadObject(payload.content?.payload)
      : null);
  const sortTimestamp = parseLatestPubSubTimestamp(
    payload.processedAt,
    payload.conversation?.lastMessageAt,
    payload.messageRecord?.timestamp,
    payload.timestamp
  );

  return {
    id: String(messageId),
    conversationId: String(conversationId),
    whatsappMessageId:
      payload.messageId || String(payload.messageRecord?.id || messageId),
    senderId:
      direction === 'inbound'
        ? String(payload.contactPhone || payload.from || '')
        : userId,
    fromPhone:
      direction === 'inbound'
        ? String(payload.from || payload.contactPhone || '')
        : userId,
    toPhone:
      direction === 'outbound'
        ? String(payload.to || payload.businessPhoneNumber || '')
        : userId,
    direction,
    type: messageType,
    content:
      payload.messageRecord?.messageContent ??
      payload.content?.text ??
      media?.caption ??
      null,
    status: (payload.status ||
      (direction === 'outbound' ? 'sent' : 'delivered')) as Message['status'],
    timestamp: parsePubSubTimestamp(
      payload.messageRecord?.timestamp,
      payload.timestamp,
      payload.processedAt
    ),
    mediaUrl: ensureHttps(media?.url || null),
    mediaMimeType: media?.mimeType || null,
    mediaFilename: media?.filename || null,
    mediaCaption: media?.caption || null,
    interactiveData: payload.content?.interactive || null,
    locationData: (payload.content?.location || null) as Message['locationData'],
    contactData: (payload.content?.contacts || null) as Message['contactData'],
    incomingPayload,
    outgoingPayload,
    webhookData: normalizePayloadObject(payload.webhook),
    errorMessage: null,
    isRead: direction === 'outbound',
    isPinned: false,
    isStarred: false,
    metadata: {
      sortTimestamp: sortTimestamp.toISOString(),
    },
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
    setConversationTyping,
  } = useChatStore();
  const isMobile = useIsMobile();
  const currentUserId = getCurrentUserId();
  const pendingIncomingTimersRef = useRef(new Map<string, number>());
  const pendingTypingCountsRef = useRef(new Map<string, number>());
  const autoPermissionAttemptedRef = useRef(false);
  const interactionRetryBoundRef = useRef(false);
  const {
    supported: notificationsSupported,
    permission: notificationPermission,
    requestPermission: requestNotificationPermission,
  } = useNotifications();

  useServiceWorker({ registerOnMount: true });

  const clearConversationTypingIfIdle = useCallback(
    (conversationId: string, userId?: string, contactPhone?: string, contactName?: string | null) => {
      const pendingCount = pendingTypingCountsRef.current.get(conversationId) || 0;
      if (pendingCount > 0) {
        return;
      }

      setConversationTyping({
        conversationId,
        isTyping: false,
        userId,
        contactPhone,
        contactName,
      });
    },
    [setConversationTyping]
  );

  const maybeShowIncomingNotification = useCallback(
    async (message: Message) => {
      const preferences = getNotificationPreferences();
      if (!preferences.newMessages) {
        debugPubSub('Skipped incoming notification because new message alerts are disabled', {
          conversationId: message.conversationId,
          messageId: message.id,
        });
        return;
      }

      if (!getNotificationPermissionState().granted) {
        debugPubSub('Skipped incoming notification because browser permission is not granted', {
          conversationId: message.conversationId,
          messageId: message.id,
        });
        return;
      }

      const conversation = useChatStore
        .getState()
        .conversations.find((item) => item.id === message.conversationId);

      if (conversation?.isMuted) {
        debugPubSub('Skipped incoming notification because conversation is muted', {
          conversationId: message.conversationId,
          messageId: message.id,
        });
        return;
      }

      const contactPhone =
        conversation?.participant?.phone ||
        conversation?.contactPhone ||
        message.fromPhone ||
        message.toPhone;
      const contactName =
        conversation?.participant?.name || conversation?.contactName || null;

      if (!contactPhone) {
        return;
      }

      debugNotification('Showing incoming message notification', {
        conversationId: message.conversationId,
        messageId: message.id,
        messageType: message.type,
        contactName,
        contactPhone,
      });

      await showMessageNotification({
        conversationId: Number(message.conversationId),
        contactName,
        contactPhone,
        messageContent: message.content,
        messageType: message.type,
        icon: conversation?.participant?.avatar,
        silent: !preferences.sound,
        onClick: () => {
          selectConversation(message.conversationId);
        },
      });
    },
    [selectConversation]
  );

  const maybeShowStatusNotification = useCallback(
    async (messageId: string, conversationId: string | number, status: string) => {
      const preferences = getNotificationPreferences();
      if (!preferences.deliveryStatus || !getNotificationPermissionState().granted) {
        return;
      }

      const conversationKey = String(conversationId);
      const conversation = useChatStore
        .getState()
        .conversations.find((item) => item.id === conversationKey);

      if (!conversation || conversation.isMuted) {
        return;
      }

      debugNotification('Showing status notification', {
        conversationId: conversationKey,
        messageId,
        status,
      });

      await showStatusNotification({
        messageId,
        conversationId: Number(conversationKey),
        contactName: conversation.participant?.name || conversation.contactName || null,
        status,
      });
    },
    []
  );

  const scheduleInboundMessage = useCallback(
    (message: Message) => {
      const conversationId = String(message.conversationId);
      const timerKey = `${conversationId}:${message.whatsappMessageId || message.id}`;

      if (pendingIncomingTimersRef.current.has(timerKey)) {
        return;
      }

      const conversation = useChatStore
        .getState()
        .conversations.find((item) => item.id === conversationId);
      const contactPhone =
        conversation?.participant?.phone ||
        conversation?.contactPhone ||
        message.fromPhone;
      const contactName =
        conversation?.participant?.name || conversation?.contactName || null;

      pendingTypingCountsRef.current.set(
        conversationId,
        (pendingTypingCountsRef.current.get(conversationId) || 0) + 1
      );

      setConversationTyping({
        conversationId,
        isTyping: true,
        userId: message.senderId,
        contactPhone,
        contactName,
      });

      const timeoutId = window.setTimeout(() => {
        pendingIncomingTimersRef.current.delete(timerKey);
        pendingTypingCountsRef.current.set(
          conversationId,
          Math.max((pendingTypingCountsRef.current.get(conversationId) || 1) - 1, 0)
        );

        clearConversationTypingIfIdle(
          conversationId,
          message.senderId,
          contactPhone,
          contactName
        );

        handleNewMessage({
          conversationId,
          message,
        });

        void maybeShowIncomingNotification(message);
      }, 700);

      pendingIncomingTimersRef.current.set(timerKey, timeoutId);
    },
    [clearConversationTypingIfIdle, handleNewMessage, maybeShowIncomingNotification, setConversationTyping]
  );

  const handlePubSubPayload = useCallback(
    (payload: PubSubClientPayload) => {
      logPubSubPayload(payload);

      if (payload.type === 'new_message') {
        const event = payload as PubSubNewMessageEvent;
        debugPubSub('AppShell forwarding new_message to store', {
          conversationId: event.data.conversation.id,
          messageId: event.data.messageRecord.id,
          whatsappMessageId: event.data.messageRecord.whatsappMessageId,
          event,
        });
        const message = mapPubSubMessageToChatMessage(event);
        if (message.direction === 'inbound') {
          scheduleInboundMessage(message);
          return;
        }

        handleNewMessage({
          conversationId: event.data.conversation.id,
          message,
        });
        return;
      }

      if (payload.type === 'status_update') {
        const event = payload as PubSubStatusUpdateEvent;
        debugPubSub('AppShell forwarding status_update to store', {
          conversationId: event.data.conversationId,
          messageId: event.data.messageId,
          status: event.data.status,
          event,
        });
        handleStatusUpdate({
          messageId: event.data.messageId,
          status: event.data.status,
          conversationId: event.data.conversationId,
          timestamp: event.data.timestamp,
        });
        void maybeShowStatusNotification(
          event.data.messageId,
          event.data.conversationId,
          event.data.status
        );
        return;
      }

      if (isLegacyStatusPayload(payload)) {
        debugPubSub('AppShell forwarding legacy status payload to store', {
          payload,
        });
        handleStatusUpdate({
          messageId: payload.messageId,
          status: payload.status,
          conversationId: payload.conversationId || '0',
          timestamp: payload.timestamp || payload.processedAt || null,
        });
        void maybeShowStatusNotification(
          payload.messageId,
          payload.conversationId || '0',
          payload.status
        );
        return;
      }

      if (isLegacyMessagePayload(payload)) {
        const legacyMessage = mapLegacyPubSubPayloadToChatMessage(payload);
        if (!legacyMessage) {
          debugPubSub('Legacy pubsub payload could not be normalized', {
            payload,
          });
          return;
        }

        debugPubSub('AppShell forwarding legacy message payload to store', {
          conversationId: legacyMessage.conversationId,
          messageId: legacyMessage.id,
          whatsappMessageId: legacyMessage.whatsappMessageId,
          payload,
        });
        if (legacyMessage.direction === 'inbound') {
          scheduleInboundMessage(legacyMessage);
          return;
        }

        handleNewMessage({
          conversationId: legacyMessage.conversationId,
          message: legacyMessage,
        });
        return;
      }

      debugPubSub('AppShell ignored unsupported pubsub payload', {
        payload,
      });
    },
    [handleNewMessage, handleStatusUpdate, maybeShowStatusNotification, scheduleInboundMessage]
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

  useEffect(() => {
    let cancelled = false;

    const logEnvironment = async () => {
      const snapshot = await collectNotificationEnvironmentSnapshot();
      if (!cancelled) {
        debugNotification('AppShell notification environment snapshot', snapshot);
        if (snapshot.pushManagerSupported && !snapshot.pushSubscription) {
          debugNotification('No PushManager subscription is registered for this app instance', {
            displayMode: snapshot.displayMode,
            serviceWorkerScope: snapshot.serviceWorkerScope,
          });
        }
      }
    };

    void logEnvironment();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notificationsSupported) {
      debugNotification('Automatic permission request skipped because notifications are unsupported');
      return;
    }

    if (!isSecureNotificationContext()) {
      debugNotification('Automatic permission request skipped because the page is not running in a secure context');
      return;
    }

    if (!notificationPermission.default || autoPermissionAttemptedRef.current) {
      return;
    }

    autoPermissionAttemptedRef.current = true;
    debugNotification('Attempting automatic notification permission request on chat shell load', {
      permission: notificationPermission,
    });

    const timeoutId = window.setTimeout(async () => {
      const granted = await requestNotificationPermission();
      debugNotification('Automatic notification permission request completed', {
        granted,
        permission: getNotificationPermissionState(),
      });

      if (granted) {
        await showPermissionGrantedNotification();
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notificationPermission, notificationsSupported, requestNotificationPermission]);

  useEffect(() => {
    if (!notificationsSupported || !notificationPermission.default || interactionRetryBoundRef.current) {
      return;
    }

    const retryPermissionRequest = async () => {
      debugNotification('Retrying notification permission request from first user interaction');
      interactionRetryBoundRef.current = true;

      window.removeEventListener('pointerdown', retryPermissionRequest);
      window.removeEventListener('keydown', retryPermissionRequest);

      const granted = await requestNotificationPermission();
      debugNotification('Interaction-based notification permission request completed', {
        granted,
        permission: getNotificationPermissionState(),
      });

      if (granted) {
        await showPermissionGrantedNotification();
      }
    };

    window.addEventListener('pointerdown', retryPermissionRequest, { once: true });
    window.addEventListener('keydown', retryPermissionRequest, { once: true });

    return () => {
      window.removeEventListener('pointerdown', retryPermissionRequest);
      window.removeEventListener('keydown', retryPermissionRequest);
    };
  }, [notificationPermission, notificationsSupported, requestNotificationPermission]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get('conversation');
    if (!conversationId) {
      return;
    }

    selectConversation(conversationId);
    params.delete('conversation');
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [selectConversation]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'open-conversation' || !event.data.conversationId) {
        return;
      }

      selectConversation(String(event.data.conversationId));
      window.focus();
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [selectConversation]);

  useEffect(() => {
    return () => {
      pendingIncomingTimersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      pendingIncomingTimersRef.current.clear();
      pendingTypingCountsRef.current.clear();
    };
  }, []);
  
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
    </>
  );
}

function DesktopShell() {
  const { selectedConversationId, isRightPanelOpen } = useChatStore();
  const desktopShellRef = useRef<HTMLDivElement | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  const clampSidebarWidth = useCallback(
    (requestedWidth: number) => {
      const rootRect = desktopShellRef.current?.getBoundingClientRect();
      const containerWidth = rootRect?.width || (typeof window !== 'undefined' ? window.innerWidth : 1440);
      const minSidebarWidth = 320;
      const minMainContentWidth = isRightPanelOpen ? 720 : 520;
      const maxSidebarWidth = Math.max(minSidebarWidth, containerWidth - minMainContentWidth);

      return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, requestedWidth));
    },
    [isRightPanelOpen]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedWidth = window.localStorage.getItem('whats91.desktop.sidebar-width');
    if (!storedWidth) {
      return;
    }

    const parsedWidth = Number(storedWidth);
    if (!Number.isFinite(parsedWidth)) {
      return;
    }

    setSidebarWidth(clampSidebarWidth(parsedWidth));
  }, [clampSidebarWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      'whats91.desktop.sidebar-width',
      String(Math.round(sidebarWidth))
    );
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDraggingSidebar) {
      return;
    }

    const rootElement = desktopShellRef.current;

    const handlePointerMove = (event: PointerEvent) => {
      const rootRect = rootElement?.getBoundingClientRect();
      const containerLeft = rootRect?.left || 0;
      const nextWidth = clampSidebarWidth(event.clientX - containerLeft);

      setSidebarWidth(nextWidth);
    };

    const stopDragging = () => {
      setIsDraggingSidebar(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [clampSidebarWidth, isDraggingSidebar]);
  
  return (
    <>
      <div ref={desktopShellRef} className="flex h-full flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className="h-full flex-shrink-0 border-r"
          style={{ width: `${sidebarWidth}px` }}
        >
          <ChatList />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat list"
          className={cn(
            'group relative z-10 hidden w-3 flex-shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent md:flex'
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsDraggingSidebar(true);
          }}
        >
          <div
            className={cn(
              'w-px bg-border transition-colors group-hover:bg-primary/50',
              isDraggingSidebar ? 'bg-primary/60' : ''
            )}
          />
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
