import { create } from 'zustand';

/**
 * Centralized chat state management using Zustand
 * Eliminates prop drilling and provides efficient state updates
 */
export const useChatStore = create((set, get) => ({
  // Conversations state
  conversations: [],
  selectedConversation: null,
  conversationsPage: 1,
  hasMoreConversations: true,
  loadingConversations: false,
  loadingMoreConversations: false,
  
  // Messages state
  messages: [],
  loadingMessages: false,
  
  // UI state
  searchTerm: '',
  isTyping: false,
  expandedMedia: null,
  sidebarOpen: true, // For mobile
  
  // Connection state
  pubsubConnected: false,
  
  // Trackers for deduplication
  sentMessagesTracker: new Set(),
  pendingSentMessages: new Map(),
  messageProcessingLock: new Set(),
  
  // Actions
  setConversations: (conversations) => set({ conversations }),
  
  addConversations: (newConversations) => set((state) => {
    const existingIds = new Set(state.conversations.map(c => c.id));
    const unique = newConversations.filter(c => !existingIds.has(c.id));
    return { conversations: [...state.conversations, ...unique] };
  }),
  
  updateConversation: (conversationId, updates) => set((state) => {
    const updated = state.conversations.map(conv => 
      conv.id === conversationId ? { ...conv, ...updates } : conv
    );
    
    // Move updated conversation to top
    const convToMove = updated.find(c => c.id === conversationId);
    const others = updated.filter(c => c.id !== conversationId);
    
    return { 
      conversations: convToMove ? [convToMove, ...others] : updated 
    };
  }),
  
  setSelectedConversation: (conversation) => set({ 
    selectedConversation: conversation,
    sidebarOpen: false // Close sidebar on mobile when selecting
  }),
  
  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  
  updateMessage: (tempUid, realMessage) => set((state) => ({
    messages: state.messages.map(msg => 
      msg.uid === tempUid ? realMessage : msg
    )
  })),
  
  removeMessage: (uid) => set((state) => ({
    messages: state.messages.filter(msg => msg.uid !== uid)
  })),
  
  setSearchTerm: (term) => set({ searchTerm: term }),
  
  setExpandedMedia: (media) => set({ expandedMedia: media }),
  
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  
  setPubsubConnected: (connected) => set({ pubsubConnected: connected }),
  
  setLoadingConversations: (loading) => set({ loadingConversations: loading }),
  setLoadingMoreConversations: (loading) => set({ loadingMoreConversations: loading }),
  setLoadingMessages: (loading) => set({ loadingMessages: loading }),
  
  setConversationsPage: (page) => set({ conversationsPage: page }),
  setHasMoreConversations: (hasMore) => set({ hasMoreConversations: hasMore }),
  
  // Tracker actions
  addToSentTracker: (whatsappId) => {
    const tracker = get().sentMessagesTracker;
    tracker.add(whatsappId);
    setTimeout(() => tracker.delete(whatsappId), 30000);
  },
  
  addToPendingTracker: (key, data) => {
    const tracker = get().pendingSentMessages;
    tracker.set(key, data);
  },
  
  removeFromPendingTracker: (key) => {
    get().pendingSentMessages.delete(key);
  },
  
  hasInSentTracker: (whatsappId) => get().sentMessagesTracker.has(whatsappId),
  
  hasInPendingTracker: (key) => get().pendingSentMessages.has(key),
  
  addToProcessingLock: (key) => {
    get().messageProcessingLock.add(key);
    setTimeout(() => get().messageProcessingLock.delete(key), 2000);
  },
  
  hasInProcessingLock: (key) => get().messageProcessingLock.has(key),
  
  // Clear all trackers
  clearTrackers: () => {
    get().sentMessagesTracker.clear();
    get().pendingSentMessages.clear();
    get().messageProcessingLock.clear();
  },
  
  // Reset for new conversation selection
  resetForNewConversation: () => set({
    messages: [],
    loadingMessages: false
  }),
  
  // Initialize from localStorage
  initializeUser: () => {
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        return JSON.parse(userData);
      }
    } catch (e) {
      console.error('Error reading user from localStorage:', e);
    }
    return null;
  }
}));
