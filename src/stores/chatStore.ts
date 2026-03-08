/**
 * Global chat store using Zustand
 * 
 * Connected to real database via API
 * Real-time updates via Socket.io
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Conversation, Message, SendMessageRequest } from '@/lib/types/chat';
import {
  clearConversation as apiClearConversation,
  deleteConversation as apiDeleteConversation,
  fetchConversations,
  fetchConversation,
  sendMessage as apiSendMessage,
  toggleArchive as apiToggleArchive,
  toggleBlock as apiToggleBlock,
  toggleMessagePinned as apiToggleMessagePinned,
  toggleMessageStarred as apiToggleMessageStarred,
  toggleMute as apiToggleMute,
  togglePin as apiTogglePin,
} from '@/lib/api/client';
import { getCurrentUserId } from '@/lib/config/current-user';
import { mockLabels } from '@/lib/mock/data';
import { debugPubSub } from '@/lib/pubsub/debug';

interface ChatLabel {
  id: string;
  name: string;
  color: string;
}

function toMessageDate(value: Message['timestamp'] | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function compareMessages(left: Message, right: Message): number {
  const timestampDiff = toMessageDate(left.timestamp).getTime() - toMessageDate(right.timestamp).getTime();
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const leftId = Number(left.id);
  const rightId = Number(right.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return leftId - rightId;
  }

  return String(left.id).localeCompare(String(right.id));
}

function sortMessagesChronologically(messages: Message[]): Message[] {
  return [...messages].sort(compareMessages);
}

function deduplicateMessages(messages: Message[]): Message[] {
  const messageMap = new Map<string, Message>();

  for (const message of messages) {
    const dedupeKey = message.whatsappMessageId
      ? `wa:${message.whatsappMessageId}`
      : `id:${message.id}`;
    const previous = messageMap.get(dedupeKey);

    if (!previous) {
      messageMap.set(dedupeKey, message);
      continue;
    }

    const previousIsTemp = String(previous.id).startsWith('temp-');
    const currentIsTemp = String(message.id).startsWith('temp-');

    if (previousIsTemp && !currentIsTemp) {
      messageMap.set(dedupeKey, message);
      continue;
    }

    if (!previousIsTemp && currentIsTemp) {
      continue;
    }

    messageMap.set(dedupeKey, compareMessages(previous, message) <= 0 ? message : previous);
  }

  return sortMessagesChronologically(Array.from(messageMap.values()));
}

function findOptimisticMessageMatch(messages: Message[], incomingMessage: Message): Message | null {
  if (incomingMessage.direction !== 'outbound') {
    return null;
  }

  return (
    [...messages]
      .reverse()
      .find((message) => {
        if (!String(message.id).startsWith('temp-') || message.status !== 'pending') {
          return false;
        }

        return (
          message.direction === incomingMessage.direction &&
          message.type === incomingMessage.type &&
          message.content === incomingMessage.content &&
          (message.mediaUrl || null) === (incomingMessage.mediaUrl || null)
        );
      }) || null
  );
}

interface ConversationListQuery {
  search: string;
  archived: boolean;
  unreadOnly: boolean;
  status: string;
  limit: number;
}

interface LoadConversationsOptions extends Partial<ConversationListQuery> {
  page?: number;
  append?: boolean;
}

const DEFAULT_CONVERSATION_LIST_QUERY: ConversationListQuery = {
  search: '',
  archived: false,
  unreadOnly: false,
  status: 'active',
  limit: 20,
};

function toConversationDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  if (value) {
    return new Date(value);
  }

  return new Date(0);
}

function compareConversations(left: Conversation, right: Conversation): number {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }

  const timestampDiff =
    toConversationDate(right.updatedAt).getTime() - toConversationDate(left.updatedAt).getTime();
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const leftId = Number(left.id);
  const rightId = Number(right.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return rightId - leftId;
  }

  return String(right.id).localeCompare(String(left.id));
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort(compareConversations);
}

function mergeConversationPages(existing: Conversation[], incoming: Conversation[]): Conversation[] {
  const conversationMap = new Map(existing.map((conversation) => [conversation.id, conversation]));

  for (const conversation of incoming) {
    const previous = conversationMap.get(conversation.id);
    conversationMap.set(conversation.id, previous ? { ...previous, ...conversation } : conversation);
  }

  return sortConversations(Array.from(conversationMap.values()));
}

function mapConversationListItemToConversation(conv: Awaited<ReturnType<typeof fetchConversations>>['data']['conversations'][number]): Conversation {
  return {
    id: String(conv.id),
    userId: getCurrentUserId(),
    contactPhone: conv.contactPhone,
    contactName: conv.contactName,
    whatsappPhoneNumberId: '',
    lastMessageId: conv.lastMessageContent ? `last-${conv.id}` : null,
    lastMessageContent: conv.lastMessageContent,
    lastMessageType: (conv.lastMessageType || 'text') as Message['type'],
    lastMessageAt: conv.lastMessageAt ? new Date(conv.lastMessageAt) : null,
    lastMessageDirection: conv.lastMessageDirection,
    participant: {
      id: String(conv.id),
      name: conv.displayName,
      phone: conv.contactPhone,
      status: 'offline',
      avatar: undefined,
    },
    lastMessage: conv.lastMessageContent
      ? {
          id: `last-${conv.id}`,
          conversationId: String(conv.id),
          whatsappMessageId: `last-${conv.id}`,
          senderId: conv.lastMessageDirection === 'inbound' ? String(conv.id) : getCurrentUserId(),
          fromPhone: conv.contactPhone,
          toPhone: '',
          direction: conv.lastMessageDirection || 'outbound',
          content: conv.lastMessageContent,
          type: (conv.lastMessageType || 'text') as Message['type'],
          status: 'read',
          timestamp: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(),
          isRead: true,
          isPinned: false,
          isStarred: false,
        }
      : undefined,
    unreadCount: conv.unreadCount,
    totalMessages: 0,
    isPinned: conv.isPinned,
    isArchived: conv.isArchived,
    isMuted: conv.isMuted,
    isBlocked: conv.isBlocked,
    status: conv.status,
    metaData: null,
    createdAt: new Date(),
    updatedAt: conv.lastMessageAt
      ? new Date(conv.lastMessageAt)
      : conv.updatedAt
        ? new Date(conv.updatedAt)
        : new Date(),
  };
}

interface ChatState {
  // Conversations
  conversations: Conversation[];
  selectedConversationId: string | null;
  labels: ChatLabel[];
  searchQuery: string;
  isLoadingConversations: boolean;
  conversationsError: string | null;
  hasMoreConversations: boolean;
  conversationListQuery: ConversationListQuery;
  
  // Messages
  messagesByConversation: Map<string, Message[]>;
  isLoadingMessages: boolean;
  messagesError: string | null;
  hasMoreMessages: boolean;
  
  // UI State
  isRightPanelOpen: boolean;
  isNewChatModalOpen: boolean;
  isSearchFocused: boolean;
  
  // Connection state
  isSocketConnected: boolean;
  
  // Pagination
  currentPage: number;
  totalPages: number;
  totalItems: number;
  
  // Actions
  loadConversations: (options?: LoadConversationsOptions) => Promise<void>;
  loadMoreConversations: () => Promise<void>;
  loadMessages: (conversationId: string, page?: number) => Promise<void>;
  selectConversation: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleRightPanel: () => void;
  toggleNewChatModal: () => void;
  setSearchFocused: (focused: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  
  // Message Actions
  sendMessage: (conversationId: string, content: string, type?: string, mediaUrl?: string) => Promise<void>;
  markAsRead: (conversationId: string) => void;
  
  // Conversation Actions
  pinConversation: (id: string) => Promise<void>;
  archiveConversation: (id: string) => Promise<void>;
  muteConversation: (id: string) => Promise<void>;
  blockConversation: (id: string) => Promise<void>;
  clearConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  toggleMessagePinned: (conversationId: string, messageId: string) => Promise<void>;
  toggleMessageStarred: (conversationId: string, messageId: string) => Promise<void>;
  
  // Real-time updates
  handleNewMessage: (data: { conversationId: string | number; message: Message }) => void;
  handleStatusUpdate: (data: { messageId: string; status: string; conversationId: string | number }) => void;
  
  // Getters
  getSelectedConversation: () => Conversation | null;
  getMessages: (conversationId: string) => Message[];
  getFilteredConversations: () => Conversation[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // Initial state
      conversations: [],
      selectedConversationId: null,
      labels: mockLabels,
      searchQuery: '',
      isLoadingConversations: false,
      conversationsError: null,
      hasMoreConversations: false,
      conversationListQuery: DEFAULT_CONVERSATION_LIST_QUERY,
      messagesByConversation: new Map(),
      isLoadingMessages: false,
      messagesError: null,
      hasMoreMessages: false,
      isRightPanelOpen: false,
      isNewChatModalOpen: false,
      isSearchFocused: false,
      isSocketConnected: false,
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      
      // Load conversations from API
      loadConversations: async (options = {}) => {
        const state = get();
        const page = options.page ?? 1;
        const append = options.append ?? false;
        const query: ConversationListQuery = {
          ...state.conversationListQuery,
          ...options,
          search: options.search ?? state.conversationListQuery.search,
          archived: options.archived ?? state.conversationListQuery.archived,
          unreadOnly: options.unreadOnly ?? state.conversationListQuery.unreadOnly,
          status: options.status ?? state.conversationListQuery.status,
          limit: options.limit ?? state.conversationListQuery.limit,
        };

        set({ isLoadingConversations: true, conversationsError: null });
        
        try {
          const response = await fetchConversations({
            page,
            limit: query.limit,
            search: query.search || undefined,
            archived: query.archived,
            unreadOnly: query.unreadOnly,
            status: query.status,
          });
          
          if (response.success && response.data) {
            const incomingConversations = response.data.conversations.map(mapConversationListItemToConversation);

            set((currentState) => ({
              conversations: append
                ? mergeConversationPages(currentState.conversations, incomingConversations)
                : sortConversations(incomingConversations),
              currentPage: response.data.pagination.currentPage,
              totalPages: response.data.pagination.totalPages,
              totalItems: response.data.pagination.totalItems,
              hasMoreConversations: response.data.pagination.hasNextPage,
              conversationListQuery: query,
              isLoadingConversations: false,
            }));
          } else {
            set({ 
              conversationsError: response.message || 'Failed to load conversations',
              isLoadingConversations: false 
            });
          }
        } catch (error) {
          set({ 
            conversationsError: error instanceof Error ? error.message : 'Unknown error',
            isLoadingConversations: false 
          });
        }
      },

      loadMoreConversations: async () => {
        const state = get();

        if (state.isLoadingConversations || !state.hasMoreConversations) {
          return;
        }

        await get().loadConversations({
          ...state.conversationListQuery,
          page: state.currentPage + 1,
          append: true,
        });
      },
      
      // Load messages for a conversation
      loadMessages: async (conversationId: string, page = 1) => {
        set({ isLoadingMessages: true, messagesError: null });
        
        try {
          const response = await fetchConversation(conversationId, { page, limit: 50 });
          
          if (response.success && response.data) {
            // Transform API messages
            const messages: Message[] = response.data.messages.map(msg => ({
              id: msg.id,
              conversationId: msg.conversationId,
              whatsappMessageId: msg.whatsappMessageId,
              senderId: msg.direction === 'inbound' ? msg.fromPhone : getCurrentUserId(),
              fromPhone: msg.fromPhone,
              toPhone: msg.toPhone,
              direction: msg.direction,
              type: msg.type as Message['type'],
              content: msg.content,
              status: msg.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
              timestamp: new Date(msg.timestamp),
              replyTo: msg.replyTo,
              mediaUrl: msg.mediaUrl,
              mediaMimeType: msg.mediaMimeType,
              mediaFilename: msg.mediaFilename,
              mediaCaption: msg.mediaCaption,
              interactiveData: msg.interactiveData,
              locationData: msg.locationData,
              contactData: msg.contactData,
              webhookData: msg.webhookData,
              errorMessage: msg.errorMessage,
              isRead: msg.isRead,
              isPinned: Boolean(msg.isPinned),
              isStarred: Boolean(msg.isStarred),
              readAt: msg.readAt ? new Date(msg.readAt) : undefined,
              incomingPayload: msg.incomingPayload,
              outgoingPayload: msg.outgoingPayload,
            }));
            
            set((state) => {
              const newMap = new Map(state.messagesByConversation);
              const existing = newMap.get(conversationId) || [];
              // Prepend older messages if loading more
              const allMessages = page > 1 ? [...messages, ...existing] : messages;
              newMap.set(conversationId, sortMessagesChronologically(allMessages));
              
              return {
                messagesByConversation: newMap,
                conversations: state.conversations.map((conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        isBlocked: response.data.conversation.isBlocked,
                        status: response.data.conversation.status,
                      }
                    : conversation
                ),
                hasMoreMessages: response.data.pagination.hasMore,
                isLoadingMessages: false,
              };
            });
          } else {
            set({ 
              messagesError: response.message || 'Failed to load messages',
              isLoadingMessages: false 
            });
          }
        } catch (error) {
          set({ 
            messagesError: error instanceof Error ? error.message : 'Unknown error',
            isLoadingMessages: false 
          });
        }
      },
      
      selectConversation: async (id) => {
        const prevId = get().selectedConversationId;

        if (prevId === id) {
          if (id !== null) {
            get().loadMessages(id);
            get().markAsRead(id);
          }
          return;
        }

        set({ selectedConversationId: id, isRightPanelOpen: false });
        
        // Unsubscribe from previous conversation
        if (prevId !== null) {
          try {
            const { unsubscribeFromConversation } = await import('@/lib/socket/client');
            unsubscribeFromConversation(prevId);
          } catch (e) {
            // Socket not available
          }
        }
        
        if (id !== null) {
          // Subscribe to new conversation
          try {
            const { subscribeToConversation } = await import('@/lib/socket/client');
            subscribeToConversation(id);
          } catch (e) {
            // Socket not available
          }
          
          // Load messages
          get().loadMessages(id);
          
          // Mark as read
          get().markAsRead(id);
        }
      },
      
      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
      toggleNewChatModal: () => set((state) => ({ isNewChatModalOpen: !state.isNewChatModalOpen })),
      setSearchFocused: (focused) => set({ isSearchFocused: focused }),
      setSocketConnected: (connected) => set({ isSocketConnected: connected }),
      
      // Send message
      sendMessage: async (conversationId, content, type = 'text', mediaUrl) => {
        // Optimistically add message
        const tempId = `temp-${Date.now()}`;
        const tempMessage: Message = {
          id: tempId,
          conversationId,
          whatsappMessageId: tempId,
          senderId: getCurrentUserId(),
          fromPhone: '',
          toPhone: '',
          direction: 'outbound',
          type: type as Message['type'],
          content,
          status: 'pending',
          timestamp: new Date(),
          isRead: false,
          isPinned: false,
          isStarred: false,
          mediaUrl,
        };
        
        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          newMap.set(conversationId, sortMessagesChronologically([...messages, tempMessage]));
          return { messagesByConversation: newMap };
        });
        
        try {
          const messageData: SendMessageRequest = {
            messageType: type as any,
            messageContent: content,
            mediaUrl,
          };
          
          const response = await apiSendMessage(conversationId, messageData);
          
          if (response.success && response.data) {
            // Replace temp message with real one
            set((state) => {
              const newMap = new Map(state.messagesByConversation);
              const messages = newMap.get(conversationId) || [];
              const updatedMessages = messages.map(m =>
                m.id === tempId
                  ? {
                      ...m,
                      id: String(response.data!.message.id),
                      whatsappMessageId: response.data!.whatsappMessageId,
                      status: 'sent' as const,
                    }
                  : m
              );
              newMap.set(conversationId, deduplicateMessages(updatedMessages));
              return { messagesByConversation: newMap };
            });
          } else {
            // Mark as failed
            set((state) => {
              const newMap = new Map(state.messagesByConversation);
              const messages = newMap.get(conversationId) || [];
              const updatedMessages = messages.map(m => 
                m.id === tempId ? { ...m, status: 'failed' as const } : m
              );
              newMap.set(conversationId, sortMessagesChronologically(updatedMessages));
              return { messagesByConversation: newMap };
            });
          }
        } catch (error) {
          // Mark as failed
          set((state) => {
            const newMap = new Map(state.messagesByConversation);
            const messages = newMap.get(conversationId) || [];
            const updatedMessages = messages.map(m => 
              m.id === tempId ? { ...m, status: 'failed' as const } : m
            );
            newMap.set(conversationId, sortMessagesChronologically(updatedMessages));
            return { messagesByConversation: newMap };
          });
        }
      },
      
      markAsRead: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.map(conv => 
            conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
          ),
        }));
      },
      
      pinConversation: async (id) => {
        try {
          const response = await apiTogglePin(id);
          if (!response.success) {
            throw new Error(response.message || 'Failed to update pin state');
          }

          set((state) => ({
            conversations: sortConversations(
              state.conversations.map((conv) =>
                conv.id === id
                  ? { ...conv, isPinned: response.data?.isPinned ?? !conv.isPinned }
                  : conv
              )
            ),
          }));
        } catch (error) {
          set({
            conversationsError: error instanceof Error ? error.message : 'Failed to update pin state',
          });
        }
      },
      
      archiveConversation: async (id) => {
        try {
          const response = await apiToggleArchive(id);
          if (!response.success) {
            throw new Error(response.message || 'Failed to update archive state');
          }

          const nextArchivedState = response.data?.isArchived;

          set((state) => {
            return {
              conversations: sortConversations(
                state.conversations.map((conv) =>
                  conv.id === id
                    ? { ...conv, isArchived: nextArchivedState ?? !conv.isArchived }
                    : conv
                )
              ),
            };
          });
        } catch (error) {
          set({
            conversationsError: error instanceof Error ? error.message : 'Failed to update archive state',
          });
        }
      },
      
      muteConversation: async (id) => {
        try {
          const response = await apiToggleMute(id);
          if (!response.success) {
            throw new Error(response.message || 'Failed to update mute state');
          }

          set((state) => ({
            conversations: state.conversations.map((conv) =>
              conv.id === id
                ? { ...conv, isMuted: response.data?.isMuted ?? !conv.isMuted }
                : conv
            ),
          }));
        } catch (error) {
          set({
            conversationsError: error instanceof Error ? error.message : 'Failed to update mute state',
          });
        }
      },

      blockConversation: async (id) => {
        try {
          const response = await apiToggleBlock(id);
          if (!response.success) {
            throw new Error(response.message || 'Failed to update block state');
          }

          set((state) => ({
            conversations: state.conversations.map((conv) =>
              conv.id === id
                ? { ...conv, isBlocked: response.data?.isBlocked ?? !conv.isBlocked }
                : conv
            ),
          }));
        } catch (error) {
          set({
            conversationsError: error instanceof Error ? error.message : 'Failed to update block state',
          });
        }
      },
      
      clearConversation: async (id) => {
        const response = await apiClearConversation(id);

        if (!response.success) {
          throw new Error(response.message || 'Failed to clear chat');
        }

        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          newMap.set(id, []);

          return {
            messagesByConversation: newMap,
            conversations: state.conversations.map((conv) =>
              conv.id === id
                ? {
                    ...conv,
                    lastMessageId: null,
                    lastMessageContent: null,
                    lastMessageType: null,
                    lastMessageAt: null,
                    lastMessageDirection: null,
                    lastMessage: undefined,
                    unreadCount: 0,
                    totalMessages: 0,
                    updatedAt: new Date(),
                  }
                : conv
            ),
          };
        });
      },

      deleteConversation: async (id) => {
        const response = await apiDeleteConversation(id);

        if (!response.success) {
          throw new Error(response.message || 'Failed to delete conversation');
        }

        set((state) => ({
          conversations: state.conversations.filter(conv => conv.id !== id),
          messagesByConversation: new Map(
            Array.from(state.messagesByConversation.entries()).filter(([conversationId]) => conversationId !== id)
          ),
          selectedConversationId: state.selectedConversationId === id ? null : state.selectedConversationId,
        }));
      },

      toggleMessagePinned: async (conversationId, messageId) => {
        const response = await apiToggleMessagePinned(conversationId, messageId);

        if (!response.success) {
          throw new Error(response.message || 'Failed to update pinned message');
        }

        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          const nextPinnedState = response.data?.isPinned ?? !messages.find((message) => message.id === messageId)?.isPinned;
          newMap.set(
            conversationId,
            messages.map((message) =>
              nextPinnedState
                ? { ...message, isPinned: message.id === messageId }
                : message.id === messageId
                  ? { ...message, isPinned: false }
                  : message
            )
          );

          return { messagesByConversation: newMap };
        });
      },

      toggleMessageStarred: async (conversationId, messageId) => {
        const response = await apiToggleMessageStarred(conversationId, messageId);

        if (!response.success) {
          throw new Error(response.message || 'Failed to update starred message');
        }

        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          newMap.set(
            conversationId,
            messages.map((message) =>
              message.id === messageId
                ? { ...message, isStarred: response.data?.isStarred ?? !message.isStarred }
                : message
            )
          );

          return { messagesByConversation: newMap };
        });
      },
      
      // Handle new message from socket
      handleNewMessage: (data) => {
        const { conversationId, message } = data;
        const conversationKey = String(conversationId);
        debugPubSub('Store handling new message', {
          conversationId: conversationKey,
          messageId: message.id,
          whatsappMessageId: message.whatsappMessageId,
          direction: message.direction,
        });
        
        set((state) => {
          const normalizedMessage: Message = {
            ...message,
            conversationId: conversationKey,
            timestamp: toMessageDate(message.timestamp as Date | string),
            isPinned: Boolean(message.isPinned),
            isStarred: Boolean(message.isStarred),
          };

          const newMap = new Map(state.messagesByConversation);
          const existingMessages = newMap.get(conversationKey) || [];
          const optimisticMatch = findOptimisticMessageMatch(existingMessages, normalizedMessage);
          const nextMessages = optimisticMatch
            ? existingMessages.map((existingMessage) =>
                existingMessage.id === optimisticMatch.id ? normalizedMessage : existingMessage
              )
            : [...existingMessages, normalizedMessage];
          newMap.set(conversationKey, deduplicateMessages(nextMessages));

          const existingConversation = state.conversations.find((conversation) => conversation.id === conversationKey);
          const nextConversation: Conversation = existingConversation
            ? {
                ...existingConversation,
                lastMessageId: normalizedMessage.whatsappMessageId,
                lastMessageContent: normalizedMessage.content,
                lastMessageType: normalizedMessage.type,
                lastMessageAt: normalizedMessage.timestamp,
                lastMessageDirection: normalizedMessage.direction,
                lastMessage: normalizedMessage,
                totalMessages: Math.max(existingConversation.totalMessages + 1, newMap.get(conversationKey)?.length || 0),
                unreadCount:
                  normalizedMessage.direction === 'inbound' && state.selectedConversationId !== conversationKey
                    ? existingConversation.unreadCount + 1
                    : existingConversation.unreadCount,
                updatedAt: normalizedMessage.timestamp,
              }
            : {
                id: conversationKey,
                userId: getCurrentUserId(),
                contactPhone:
                  normalizedMessage.direction === 'inbound'
                    ? normalizedMessage.fromPhone
                    : normalizedMessage.toPhone,
                contactName: null,
                whatsappPhoneNumberId: '',
                lastMessageId: normalizedMessage.whatsappMessageId,
                lastMessageContent: normalizedMessage.content,
                lastMessageType: normalizedMessage.type,
                lastMessageAt: normalizedMessage.timestamp,
                lastMessageDirection: normalizedMessage.direction,
                unreadCount: normalizedMessage.direction === 'inbound' ? 1 : 0,
                totalMessages: newMap.get(conversationKey)?.length || 1,
                isPinned: false,
                isArchived: false,
                isMuted: false,
                isBlocked: false,
                status: 'active',
                metaData: null,
                participant: {
                  id: conversationKey,
                  name:
                    normalizedMessage.direction === 'inbound'
                      ? normalizedMessage.fromPhone
                      : normalizedMessage.toPhone,
                  phone:
                    normalizedMessage.direction === 'inbound'
                      ? normalizedMessage.fromPhone
                      : normalizedMessage.toPhone,
                  status: 'offline',
                },
                lastMessage: normalizedMessage,
                createdAt: normalizedMessage.timestamp,
                updatedAt: normalizedMessage.timestamp,
              };

          const conversations = existingConversation
            ? state.conversations.map((conversation) =>
                conversation.id === conversationKey ? nextConversation : conversation
              )
            : [nextConversation, ...state.conversations];

          debugPubSub('Store updated after new message', {
            conversationId: conversationKey,
            totalMessagesInConversation: newMap.get(conversationKey)?.length || 0,
            selectedConversationId: state.selectedConversationId,
            conversationExists: Boolean(existingConversation),
          });

          return {
            messagesByConversation: newMap,
            conversations: sortConversations(conversations),
          };
        });
      },
      
      // Handle status update from socket
      handleStatusUpdate: (data) => {
        const { messageId, status, conversationId } = data;
        const conversationKey = String(conversationId);
        debugPubSub('Store handling status update', {
          conversationId: conversationKey,
          messageId,
          status,
        });
        
        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationKey) || [];
          const updatedMessages = messages.map(m => 
            m.whatsappMessageId === messageId 
              ? { ...m, status: status as Message['status'] }
              : m
          );
          newMap.set(conversationKey, updatedMessages);
          debugPubSub('Store updated after status update', {
            conversationId: conversationKey,
            messageCount: updatedMessages.length,
          });
          return { messagesByConversation: newMap };
        });
      },
      
      getSelectedConversation: () => {
        const state = get();
        return state.conversations.find(c => c.id === state.selectedConversationId) || null;
      },
      
      getMessages: (conversationId) => {
        return get().messagesByConversation.get(conversationId) || [];
      },
      
      getFilteredConversations: () => {
        const state = get();
        const query = state.searchQuery.toLowerCase();
        
        let filtered = state.conversations.filter(conv => {
          if (conv.isArchived && !query.includes('archived')) return false;
          return true;
        });
        
        if (query) {
          filtered = filtered.filter(conv => 
            conv.participant?.name.toLowerCase().includes(query) ||
            conv.participant?.phone.includes(query) ||
            conv.lastMessage?.content?.toLowerCase().includes(query)
          );
        }
        
        // Sort: pinned first, then by updatedAt
        return filtered.sort((a, b) => {
          return compareConversations(a, b);
        });
      },
    }),
    {
      name: 'whats91-chat-store',
      partialize: (state) => ({
        selectedConversationId: state.selectedConversationId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.selectedConversationId) {
          void state.selectConversation(state.selectedConversationId);
        }
      },
    }
  )
);

// Keyboard shortcuts store
interface ShortcutsState {
  enabled: boolean;
  toggleShortcuts: () => void;
}

export const useShortcutsStore = create<ShortcutsState>()(
  persist(
    (set) => ({
      enabled: true,
      toggleShortcuts: () => set((state) => ({ enabled: !state.enabled })),
    }),
    { name: 'whats91-shortcuts' }
  )
);
