/**
 * Global chat store using Zustand
 * 
 * Connected to real database via API
 * Real-time updates via Socket.io
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Conversation, Message, SendMessageRequest } from '@/lib/types/chat';
import { fetchConversations, fetchConversation, sendMessage as apiSendMessage } from '@/lib/api/client';

interface ChatState {
  // Conversations
  conversations: Conversation[];
  selectedConversationId: number | null;
  searchQuery: string;
  isLoadingConversations: boolean;
  conversationsError: string | null;
  
  // Messages
  messagesByConversation: Map<number, Message[]>;
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
  loadConversations: (page?: number, search?: string) => Promise<void>;
  loadMessages: (conversationId: number, page?: number) => Promise<void>;
  selectConversation: (id: number | null) => void;
  setSearchQuery: (query: string) => void;
  toggleRightPanel: () => void;
  toggleNewChatModal: () => void;
  setSearchFocused: (focused: boolean) => void;
  setSocketConnected: (connected: boolean) => void;
  
  // Message Actions
  sendMessage: (conversationId: number, content: string, type?: string, mediaUrl?: string) => Promise<void>;
  markAsRead: (conversationId: number) => void;
  
  // Conversation Actions
  pinConversation: (id: number) => void;
  archiveConversation: (id: number) => void;
  muteConversation: (id: number) => void;
  deleteConversation: (id: number) => void;
  
  // Real-time updates
  handleNewMessage: (data: { conversationId: number; message: Message }) => void;
  handleStatusUpdate: (data: { messageId: string; status: string; conversationId: number }) => void;
  
  // Getters
  getSelectedConversation: () => Conversation | null;
  getMessages: (conversationId: number) => Message[];
  getFilteredConversations: () => Conversation[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // Initial state
      conversations: [],
      selectedConversationId: null,
      searchQuery: '',
      isLoadingConversations: false,
      conversationsError: null,
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
      loadConversations: async (page = 1, search = '') => {
        set({ isLoadingConversations: true, conversationsError: null });
        
        try {
          const response = await fetchConversations({ page, limit: 20, search });
          
          if (response.success && response.data) {
            // Transform API response to match frontend types
            const conversations: Conversation[] = response.data.conversations.map(conv => ({
              id: String(conv.id),
              participant: {
                id: String(conv.id),
                name: conv.displayName,
                phone: conv.contactPhone,
                status: 'offline',
                avatar: undefined,
              },
              lastMessage: conv.lastMessageContent ? {
                id: `last-${conv.id}`,
                conversationId: String(conv.id),
                senderId: conv.lastMessageDirection === 'inbound' ? String(conv.id) : 'current-user',
                content: conv.lastMessageContent,
                type: (conv.lastMessageType || 'text') as 'text' | 'image' | 'video' | 'audio' | 'document' | 'template',
                status: 'read',
                timestamp: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(),
              } : undefined,
              unreadCount: conv.unreadCount,
              isPinned: conv.isPinned,
              isArchived: conv.isArchived,
              isMuted: conv.isMuted,
              labels: [],
              createdAt: new Date(),
              updatedAt: conv.lastMessageAt ? new Date(conv.lastMessageAt) : new Date(),
            }));
            
            set({
              conversations,
              currentPage: response.data.pagination.currentPage,
              totalPages: response.data.pagination.totalPages,
              totalItems: response.data.pagination.totalItems,
              isLoadingConversations: false,
            });
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
      
      // Load messages for a conversation
      loadMessages: async (conversationId: number, page = 1) => {
        set({ isLoadingMessages: true, messagesError: null });
        
        try {
          const response = await fetchConversation(conversationId, { page, limit: 50 });
          
          if (response.success && response.data) {
            // Transform API messages
            const messages: Message[] = response.data.messages.map(msg => ({
              id: msg.id,
              conversationId: msg.conversationId,
              whatsappMessageId: msg.whatsappMessageId,
              senderId: msg.direction === 'inbound' ? msg.fromPhone : 'current-user',
              fromPhone: msg.fromPhone,
              toPhone: msg.toPhone,
              direction: msg.direction,
              type: msg.type as 'text' | 'image' | 'video' | 'audio' | 'document' | 'template',
              content: msg.content,
              status: msg.status as 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
              timestamp: new Date(msg.timestamp),
              mediaUrl: msg.mediaUrl,
              mediaMimeType: msg.mediaMimeType,
              mediaFilename: msg.mediaFilename,
              isRead: msg.isRead,
              readAt: msg.readAt ? new Date(msg.readAt) : undefined,
              incomingPayload: msg.incomingPayload,
              outgoingPayload: msg.outgoingPayload,
            }));
            
            set((state) => {
              const newMap = new Map(state.messagesByConversation);
              const existing = newMap.get(conversationId) || [];
              // Prepend older messages if loading more
              const allMessages = page > 1 ? [...messages, ...existing] : messages;
              newMap.set(conversationId, allMessages);
              
              return {
                messagesByConversation: newMap,
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
        set({ selectedConversationId: id });
        
        // Unsubscribe from previous conversation
        const prevId = get().selectedConversationId;
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
          conversationId: String(conversationId),
          whatsappMessageId: tempId,
          senderId: 'current-user',
          fromPhone: '',
          toPhone: '',
          direction: 'outbound',
          type: type as 'text' | 'image' | 'video' | 'audio' | 'document' | 'template',
          content,
          status: 'pending',
          timestamp: new Date(),
          mediaUrl,
        };
        
        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          newMap.set(conversationId, [...messages, tempMessage]);
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
              newMap.set(conversationId, updatedMessages);
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
              newMap.set(conversationId, updatedMessages);
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
            newMap.set(conversationId, updatedMessages);
            return { messagesByConversation: newMap };
          });
        }
      },
      
      markAsRead: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.map(conv => 
            conv.id === String(conversationId) ? { ...conv, unreadCount: 0 } : conv
          ),
        }));
      },
      
      pinConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.map(conv =>
            conv.id === String(id) ? { ...conv, isPinned: !conv.isPinned } : conv
          ),
        }));
      },
      
      archiveConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.map(conv =>
            conv.id === String(id) ? { ...conv, isArchived: !conv.isArchived } : conv
          ),
        }));
      },
      
      muteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.map(conv =>
            conv.id === String(id) ? { ...conv, isMuted: !conv.isMuted } : conv
          ),
        }));
      },
      
      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter(conv => conv.id !== String(id)),
          selectedConversationId: state.selectedConversationId === id ? null : state.selectedConversationId,
        }));
      },
      
      // Handle new message from socket
      handleNewMessage: (data) => {
        const { conversationId, message } = data;
        
        set((state) => {
          // Add message to conversation
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          newMap.set(conversationId, [...messages, message]);
          
          // Update conversation preview
          const conversations = state.conversations.map(conv => {
            if (conv.id === String(conversationId)) {
              return {
                ...conv,
                lastMessage: {
                  ...message,
                  id: message.id,
                  conversationId: String(conversationId),
                },
                updatedAt: message.timestamp,
                unreadCount: conv.unreadCount + 1,
              };
            }
            return conv;
          });
          
          return { messagesByConversation: newMap, conversations };
        });
      },
      
      // Handle status update from socket
      handleStatusUpdate: (data) => {
        const { messageId, status, conversationId } = data;
        
        set((state) => {
          const newMap = new Map(state.messagesByConversation);
          const messages = newMap.get(conversationId) || [];
          const updatedMessages = messages.map(m => 
            m.whatsappMessageId === messageId 
              ? { ...m, status: status as Message['status'] }
              : m
          );
          newMap.set(conversationId, updatedMessages);
          return { messagesByConversation: newMap };
        });
      },
      
      getSelectedConversation: () => {
        const state = get();
        return state.conversations.find(c => c.id === String(state.selectedConversationId)) || null;
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
            conv.participant.name.toLowerCase().includes(query) ||
            conv.participant.phone.includes(query) ||
            conv.lastMessage?.content.toLowerCase().includes(query)
          );
        }
        
        // Sort: pinned first, then by updatedAt
        return filtered.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
      },
    }),
    {
      name: 'whats91-chat-store',
      partialize: (state) => ({
        selectedConversationId: state.selectedConversationId,
        isRightPanelOpen: state.isRightPanelOpen,
      }),
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
