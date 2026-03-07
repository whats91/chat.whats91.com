'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MessageCircle, Search, X } from 'lucide-react';
import axiosInstance from '@/lib/axios';
import { formatRelativeTime } from '@/utils/chatUtils';
import PubSubClient from '@/utils/pubsubClient';
import { parsePayloadObject } from '@/utils/whatsappPayloadUtils';

// Components
import ConversationList from './components/refactored/ConversationList';
import ChatHeader from './components/refactored/ChatHeader';
import MessageList from './components/refactored/MessageList';
import MessageInput from './components/refactored/MessageInput';

// Utility function to ensure HTTPS URLs
const ensureHttps = (url) => {
  if (!url) return url;
  if (typeof url !== 'string') return url;
  // Replace http:// with https:// to avoid mixed content warnings
  return url.replace(/^http:\/\//i, 'https://');
};

const getMessageSearchableText = (message) => {
  const contacts = Array.isArray(message?.contact_data)
    ? message.contact_data
    : message?.contact_data
      ? [message.contact_data]
      : [];

  const contactText = contacts
    .map((contact) => {
      const contactName =
        contact?.name?.formatted_name ||
        contact?.name?.first_name ||
        contact?.name ||
        '';
      const phones = Array.isArray(contact?.phones)
        ? contact.phones.map((phone) => phone?.phone).filter(Boolean).join(' ')
        : '';

      return [contactName, phones].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(' ');

  const locationText = [
    message?.location_data?.name,
    message?.location_data?.address
  ]
    .filter(Boolean)
    .join(' ');

  return [
    message?.message_content,
    message?.media_caption,
    message?.media_filename,
    message?.interactive_data?.title,
    locationText,
    contactText
  ]
    .filter(Boolean)
    .join(' ');
};

const CUSTOMER_HEADER_STATUS_PLACEHOLDER = 'Status unavailable';

export default function ChatPage() {
  // ─── State ─────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showConversationSearch, setShowConversationSearch] = useState(false);
  const [messageSearchTerm, setMessageSearchTerm] = useState('');
  const [pubsubConnected, setPubsubConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Pagination
  const [conversationsPage, setConversationsPage] = useState(1);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  
  // Refs
  const userId = useRef(null);
  const pubsubRef = useRef(null);
  const sentMessagesTracker = useRef(new Set());
  const pendingSentMessages = useRef(new Map());
  const messageProcessingLock = useRef(new Set());
  const processedConversationUpdates = useRef(new Set());
  const selectedConversationRef = useRef(null);
  const conversationSearchInputRef = useRef(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);
  
  // ─── Initialize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const initialize = async () => {
      try {
        const userData = localStorage.getItem('user');
        if (userData) {
          const user = JSON.parse(userData);
          userId.current = user.id;
          initializePubSub();
          await loadConversations();
        }
      } catch (error) {
        console.error('Error initializing chat:', error);
      } finally {
        setLoading(false);
      }
    };
    
    initialize();
    
    return () => {
      pubsubRef.current?.disconnect();
    };
  }, []);
  
  // ─── Pub/Sub Message Handler (defined before initializePubSub) ─────────
  const handlePubSubMessageRef = useRef(null);
  
  // ─── Pub/Sub Setup ──────────────────────────────────────────────────────
  const initializePubSub = () => {
    if (!userId.current) return;
    
    try {
      pubsubRef.current = new PubSubClient({
        url: process.env.NEXT_PUBLIC_PUBSUB_URL || 'wss://pubsub-service.botmastersender.com'
      });
      
      pubsubRef.current.onMessage((payload) => {
        // Use ref to always get the latest handler
        if (handlePubSubMessageRef.current) {
          handlePubSubMessageRef.current(payload);
        }
      });
      
      pubsubRef.current.connect();
      pubsubRef.current.subscribe(`conversations-${userId.current}`);
      
      // Monitor connection
      const checkConnection = setInterval(() => {
        if (pubsubRef.current) {
          setPubsubConnected(pubsubRef.current.isConnectionOpen());
        }
      }, 1000);
      
      return () => clearInterval(checkConnection);
    } catch (error) {
      console.error('Error initializing Pub/Sub:', error);
    }
  };
  
  // ─── Pub/Sub Message Handler ────────────────────────────────────────────
  const handlePubSubMessage = useCallback((data) => {
    // Handle status updates
    if (data.type === 'status' && data.messageId && data.status) {
      handleMessageStatusUpdate(data.messageId, data.status);
      return;
    }
    
    // Handle new messages
    if (!data.conversation || !data.messageRecord) {
      return;
    }
    
    const { conversation, messageRecord, direction } = data;
    const conversationId = conversation.id;
    
    // Build normalized message
    const incomingPayload =
      parsePayloadObject(
        messageRecord.incomingPayload ??
        messageRecord.incoming_payload ??
        (direction === 'inbound' ? data.webhook : null)
      ) || null;

    const outgoingPayload =
      parsePayloadObject(
        messageRecord.outgoingPayload ??
        messageRecord.outgoing_payload ??
        data.content?.payload ??
        (direction === 'outbound' ? data.payload : null)
      ) || null;

    // Keep legacy interactive fallback for older pubsub events without payload data
    let interactiveData = null;
    if (data.type === 'interactive' && data.content?.interactive) {
      interactiveData = {
        type: data.content.interactive.type,
        id: data.content.interactive.id,
        title: data.content.interactive.title
      };
    }
    
    const normalizedMessage = {
      id: messageRecord.id,
      whatsapp_message_id: data.messageId,
      message_content: messageRecord.messageContent,
      message_type: messageRecord.messageType || data.type,
      direction: direction,
      timestamp: messageRecord.timestamp,
      status: data.status || 'delivered',
      from_phone: data.from,
      to_phone: data.to,
      media_url: ensureHttps(data.content?.media?.url) || null,
      media_mime_type: data.content?.media?.mimeType || null,
      media_filename: data.content?.media?.filename || null,
      media_caption: data.content?.media?.caption || null,
      location_data: data.content?.location || null,
      contact_data: data.content?.contacts || null,
      interactive_data: interactiveData,
      incoming_payload: incomingPayload,
      outgoing_payload: outgoingPayload
    };
    
    handleNewMessage(normalizedMessage, conversationId);
  }, []);
  
  // Store handler in ref for PubSub callback
  useEffect(() => {
    handlePubSubMessageRef.current = handlePubSubMessage;
  }, [handlePubSubMessage]);
  
  // ─── Message Status Update Handler ──────────────────────────────────────
  const handleMessageStatusUpdate = useCallback((messageId, status) => {
    // Update message in the message list
    setMessages(prev => prev.map(msg => 
      msg.whatsapp_message_id === messageId 
        ? { ...msg, status } 
        : msg
    ));
    
    // Update conversation list if this is the last message
    setConversations(prev => prev.map(conv => {
      // Check if this conversation's last message matches
      const lastMessageMatches = messages.some(m => 
        m.whatsapp_message_id === messageId && 
        m.direction === 'outbound' &&
        conv.last_message_direction === 'outbound'
      );
      
      if (lastMessageMatches) {
        return {
          ...conv,
          last_message_status: status
        };
      }
      return conv;
    }));
    
    // Update selected conversation if needed
    setSelectedConversation(prev => {
      if (!prev) return prev;
      
      const lastMessageMatches = messages.some(m => 
        m.whatsapp_message_id === messageId && 
        m.direction === 'outbound' &&
        prev.last_message_direction === 'outbound'
      );
      
      if (lastMessageMatches) {
        return {
          ...prev,
          last_message_status: status
        };
      }
      return prev;
    });
  }, [messages]);
  
  // ─── New Message Handler ────────────────────────────────────────────────
  const handleNewMessage = useCallback((message, conversationId) => {
    if (!message || !conversationId) {
      return;
    }
    
    const messageId = message.whatsapp_message_id || message.uid || `${Date.now()}`;
    const processingKey = `${conversationId}_${messageId}`;
    
    // Prevent duplicate processing
    if (messageProcessingLock.current.has(processingKey)) {
      return;
    }
    messageProcessingLock.current.add(processingKey);
    setTimeout(() => messageProcessingLock.current.delete(processingKey), 2000);
    
    // Update conversation list
    const updateKey = `conversation_${conversationId}_${messageId}`;
    if (!processedConversationUpdates.current.has(updateKey)) {
      processedConversationUpdates.current.add(updateKey);
      setTimeout(() => processedConversationUpdates.current.delete(updateKey), 10000);
      
      setConversations(prev => {
        const updated = prev.map(conv => {
          if (conv.id === conversationId) {
            let lastContent = message.message_content;
            if (!lastContent) {
              const typeMap = {
                image: '📷 Image', video: '🎥 Video', audio: '🎵 Audio',
                document: '📄 Document', location: '📍 Location', contact: '👤 Contact'
              };
              lastContent = typeMap[message.message_type] || 'New message';
            }
            
            return {
              ...conv,
              last_message_content: lastContent,
              last_message_type: message.message_type || 'text',
              last_message_at: message.timestamp,
              last_message_direction: message.direction,
              last_message_status: message.status || 'delivered',
              unread_count: message.direction === 'inbound' ? conv.unread_count + 1 : conv.unread_count,
              last_message_time_ago: 'Just now'
            };
          }
          return conv;
        });
        
        // Move to top
        const conv = updated.find(c => c.id === conversationId);
        const others = updated.filter(c => c.id !== conversationId);
        return conv ? [conv, ...others] : updated;
      });
    }
    
    // Add to messages if conversation is selected (use ref to avoid stale closure)
    const currentSelectedConversation = selectedConversationRef.current;
    
    if (currentSelectedConversation?.id === conversationId) {
      setMessages(prev => {
        // Deduplication - check by whatsapp_message_id first, then by uid
        const existingIndex = prev.findIndex(m => 
          (message.whatsapp_message_id && m.whatsapp_message_id === message.whatsapp_message_id) ||
          (message.uid && m.uid === message.uid)
        );
        
        if (existingIndex !== -1) {
          // Update existing message instead of skipping (in case status changed)
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...message,
            uid: updated[existingIndex].uid || message.uid
          };
          return updated;
        }
        
        return [...prev, message];
      });
      
      // Update selected conversation object to keep it in sync
      setSelectedConversation(prev => {
        if (!prev || prev.id !== conversationId) return prev;
        
        let lastContent = message.message_content;
        if (!lastContent) {
          const typeMap = {
            image: '📷 Image', video: '🎥 Video', audio: '🎵 Audio',
            document: '📄 Document', location: '📍 Location', contact: '👤 Contact',
            interactive: '🔘 Button'
          };
          lastContent = typeMap[message.message_type] || 'New message';
        }
        
        return {
          ...prev,
          last_message_content: lastContent,
          last_message_type: message.message_type || 'text',
          last_message_at: message.timestamp,
          last_message_direction: message.direction,
          last_message_status: message.status || 'delivered',
          unread_count: message.direction === 'inbound' ? 0 : prev.unread_count,
          last_message_time_ago: 'Just now'
        };
      });
      
      if (message.direction === 'inbound') {
        markAsRead(conversationId);
      }
    }
  }, []);
  
  // ─── API Functions ──────────────────────────────────────────────────────
  const loadConversations = async (search = '', resetPage = true) => {
    try {
      const page = resetPage ? 1 : conversationsPage;
      const params = new URLSearchParams({ page, limit: 20 });
      if (search) params.append('search', search);
      
      const response = await axiosInstance.get(`/api/conversations?${params}`);
      
      if (response.data.success) {
        setConversations(response.data.data.conversations);
        setHasMoreConversations(response.data.data.pagination.hasNextPage);
        if (resetPage) setConversationsPage(1);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };
  
  const loadMoreConversations = async () => {
    if (loadingMore || !hasMoreConversations) return;
    
    setLoadingMore(true);
    try {
      const nextPage = conversationsPage + 1;
      const params = new URLSearchParams({ page: nextPage, limit: 20 });
      if (searchTerm) params.append('search', searchTerm);
      
      const response = await axiosInstance.get(`/api/conversations?${params}`);
      
      if (response.data.success) {
        const existingIds = new Set(conversations.map(c => c.id));
        const newConvs = response.data.data.conversations.filter(c => !existingIds.has(c.id));
        
        setConversations(prev => [...prev, ...newConvs]);
        setHasMoreConversations(response.data.data.pagination.hasNextPage);
        setConversationsPage(nextPage);
      }
    } catch (error) {
      console.error('Error loading more conversations:', error);
    } finally {
      setLoadingMore(false);
    }
  };
  
  const loadMessages = async (conversationId) => {
    setLoadingMessages(true);
    sentMessagesTracker.current.clear();
    pendingSentMessages.current.clear();
    messageProcessingLock.current.clear();
    
    try {
      const response = await axiosInstance.get(`/api/conversations/${conversationId}`);
      
      if (response.data.success) {
        // Ensure all media URLs use HTTPS
        const messagesWithHttps = response.data.data.messages.map(msg => ({
          ...msg,
          media_url: ensureHttps(msg.media_url),
          incoming_payload: parsePayloadObject(msg.incoming_payload ?? msg.incomingPayload) || null,
          outgoing_payload: parsePayloadObject(msg.outgoing_payload ?? msg.outgoingPayload) || null
        }));
        
        setMessages(messagesWithHttps);
        if (response.data.data.conversation) {
          setSelectedConversation(response.data.data.conversation);
        }
        markAsRead(conversationId);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };
  
  const markAsRead = async (conversationId) => {
    try {
      await axiosInstance.post(`/api/conversations/${conversationId}/read`);
      setConversations(prev => prev.map(conv => 
        conv.id === conversationId ? { ...conv, unread_count: 0 } : conv
      ));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };
  
  // ─── Send Message ───────────────────────────────────────────────────────
  const handleSendMessage = async (messageData) => {
    if (!selectedConversation || (!messageData.text?.trim() && !messageData.attachments?.length)) return;
    
    const hasText = messageData.text?.trim();
    const hasAttachments = messageData.attachments?.length > 0;
    
    // Create temp message
    const tempMessage = {
      uid: `temp-${Date.now()}`,
      whatsapp_message_id: `temp-${Date.now()}`,
      message_content: hasText ? messageData.text.trim() : '',
      direction: 'outbound',
      message_type: hasAttachments ? messageData.attachments[0].type : 'text',
      timestamp: new Date().toISOString(),
      status: 'pending',
      media_mime_type: hasAttachments ? messageData.attachments[0].file.type : null,
      media_filename: hasAttachments ? messageData.attachments[0].file.name : null,
      media_caption: hasText ? messageData.text.trim() : null
    };
    
    // Track for deduplication
    const msgKey = `${tempMessage.message_content}_${Math.floor(Date.now() / 3000)}`;
    pendingSentMessages.current.set(msgKey, { tempUid: tempMessage.uid });
    
    // Add to UI
    setMessages(prev => [...prev, tempMessage]);
    
    try {
      let mediaUpload = null;
      
      // Upload media if needed
      if (hasAttachments) {
        const formData = new FormData();
        formData.append('files', messageData.attachments[0].file);
        
        const uploadRes = await axiosInstance.post(
          `/api/conversations/${selectedConversation.id}/media/upload`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000
          }
        );
        
        if (!uploadRes.data.success) throw new Error('Failed to upload media');
        mediaUpload = uploadRes.data.data[0];

        setMessages(prev => prev.map(message =>
          message.uid === tempMessage.uid
            ? {
                ...message,
                media_url: mediaUpload.proxy_url,
                media_mime_type: mediaUpload.mime_type || messageData.attachments[0].file.type,
                media_filename: mediaUpload.original_filename || messageData.attachments[0].file.name
              }
            : message
        ));
      }
      
      // Send message
      const response = await axiosInstance.post(
        `/api/conversations/${selectedConversation.id}/messages`,
        {
          message_type: hasAttachments ? messageData.attachments[0].type : 'text',
          message_content: hasText ? messageData.text.trim() : '',
          ...(mediaUpload && { media_upload_token: mediaUpload.upload_token }),
          ...((mediaUpload || hasAttachments) && { media_caption: hasText ? messageData.text.trim() : null })
        },
        { timeout: 10000 }
      );
      
      if (response.data.success) {
        const realMessage = response.data.data.message;
        
        // Track sent message
        if (realMessage.whatsapp_message_id) {
          sentMessagesTracker.current.add(realMessage.whatsapp_message_id);
          setTimeout(() => sentMessagesTracker.current.delete(realMessage.whatsapp_message_id), 30000);
        }
        
        // Replace temp message
        setMessages(prev => prev.map(m => m.uid === tempMessage.uid ? realMessage : m));
        
        // Update conversation list with status
        setConversations(prev => {
          const updated = prev.map(conv => 
            conv.id === selectedConversation.id 
              ? { 
                  ...conv, 
                  last_message_content: hasText ? messageData.text.trim() : 'Attachment', 
                  last_message_at: new Date().toISOString(), 
                  last_message_direction: 'outbound',
                  last_message_status: realMessage.status || 'sent',
                  last_message_time_ago: 'Just now' 
                }
              : conv
          );
          const conv = updated.find(c => c.id === selectedConversation.id);
          const others = updated.filter(c => c.id !== selectedConversation.id);
          return conv ? [conv, ...others] : updated;
        });
        
        // Update selected conversation to keep it in sync
        setSelectedConversation(prev => {
          if (!prev || prev.id !== selectedConversation.id) return prev;
          return {
            ...prev,
            last_message_content: hasText ? messageData.text.trim() : 'Attachment',
            last_message_at: new Date().toISOString(),
            last_message_direction: 'outbound',
            last_message_status: realMessage.status || 'sent',
            last_message_time_ago: 'Just now'
          };
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => prev.filter(m => m.uid !== tempMessage.uid));
      alert(`Failed to send: ${error.response?.data?.message || error.message}`);
    }
  };
  
  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleSelectConversation = useCallback((conversation) => {
    setSelectedConversation(conversation);
    setSidebarOpen(false);
    loadMessages(conversation.id);
  }, []);
  
  const handleBack = useCallback(() => {
    setSelectedConversation(null);
    setMessages([]);
    setSidebarOpen(true);
  }, []);

  const handleOpenConversationSearch = useCallback(() => {
    setShowConversationSearch(true);
  }, []);

  const handleCloseConversationSearch = useCallback(() => {
    setShowConversationSearch(false);
    setSearchTerm('');
  }, []);
  
  // ─── Search Effect ──────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations(searchTerm, true);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setMessageSearchTerm('');
  }, [selectedConversation?.id]);

  useEffect(() => {
    if (!showConversationSearch) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      conversationSearchInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(frameId);
  }, [showConversationSearch]);

  const filteredMessages = useMemo(() => {
    const normalizedTerm = messageSearchTerm.trim().toLowerCase();

    if (!normalizedTerm) {
      return messages;
    }

    return messages.filter((message) =>
      getMessageSearchableText(message).toLowerCase().includes(normalizedTerm)
    );
  }, [messages, messageSearchTerm]);
  
  // ─── Time Update Effect ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setConversations(prev => prev.map(conv => ({
        ...conv,
        last_message_time_ago: conv.last_message_at ? formatRelativeTime(conv.last_message_at) : ''
      })));
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  
  // ─── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-[#FAFBFC] to-[#F4F6F8]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#2A7B6E] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#64748B] text-sm font-medium">Loading conversations...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-full min-h-0 bg-gradient-to-br from-[#FAFBFC] to-[#F4F6F8] overflow-hidden">
      {/* Sidebar - Conversation List */}
      <div className={`
        ${selectedConversation ? 'hidden lg:flex' : 'flex'}
        flex-col w-full lg:w-[380px] xl:w-[420px] bg-white border-r border-[#E2E8F0] flex-shrink-0 h-full min-h-0
      `}>
        {/* Sidebar header */}
        <div className="flex h-[46px] items-center justify-between px-3 bg-white border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] flex items-center justify-center shadow-md">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-4 text-[#334155]">Messages</h1>
              <p className="text-[10px] leading-3 text-[#64748B]">
                {pubsubConnected ? 'Connected' : 'Connecting...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenConversationSearch}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748B] transition-all hover:bg-[#E8F5F3] hover:text-[#2A7B6E]"
              aria-label="Search conversations"
              title="Search conversations"
            >
              <Search className="h-4 w-4" />
            </button>
            <div className={`w-2 h-2 rounded-full ${pubsubConnected ? 'bg-[#10B981] animate-pulse' : 'bg-[#8696A0]'}`} />
          </div>
        </div>

        {showConversationSearch && (
          <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-[#E2E8F0]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
              <input
                ref={conversationSearchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search conversations"
                className="h-8 w-full rounded-lg border border-[#D7E0E7] bg-[#F8FAFC] pl-8 pr-8 text-sm text-[#334155] placeholder-[#64748B] focus:outline-none focus:border-[#2A7B6E] focus:ring-2 focus:ring-[#2A7B6E]/10"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[#64748B] hover:bg-[#E2E8F0]"
                  aria-label="Clear conversation search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleCloseConversationSearch}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748B] transition-all hover:bg-[#E8F5F3] hover:text-[#2A7B6E]"
              aria-label="Close conversation search"
              title="Close conversation search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        
        {/* Conversation list */}
        <ConversationList
          conversations={conversations}
          selectedConversation={selectedConversation}
          onSelectConversation={handleSelectConversation}
          searchTerm={searchTerm}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMoreConversations}
          onLoadMore={loadMoreConversations}
        />
      </div>
      
      {/* Chat Window */}
      <div className={`
        ${selectedConversation ? 'flex' : 'hidden lg:flex'}
        flex-col flex-1 min-w-0 bg-white h-full min-h-0
      `}>
        {selectedConversation ? (
          <>
            <ChatHeader 
              key={selectedConversation.id}
              conversation={selectedConversation}
              onBack={handleBack}
              showBackButton={true}
              messageSearchTerm={messageSearchTerm}
              onMessageSearchChange={setMessageSearchTerm}
              statusPlaceholder={CUSTOMER_HEADER_STATUS_PLACEHOLDER}
            />
            
            <MessageList
              key={`messages-${selectedConversation.id}-${messages.length}`}
              messages={filteredMessages}
              loading={loadingMessages}
              loadingMore={false}
              selectedConversation={selectedConversation}
              scrollToBottom={!messageSearchTerm.trim()}
              emptyTitle={messageSearchTerm.trim() ? 'No matching messages' : 'No messages yet'}
              emptyDescription={messageSearchTerm.trim() ? 'Try a different message search.' : 'Start the conversation!'}
            />
            
            <MessageInput 
              onSendMessage={handleSendMessage}
              disabled={!pubsubConnected}
              placeholder="Type a message..."
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-[#FAFBFC] to-white h-full">
            <div className="text-center max-w-md px-6">
              <div className="w-32 h-32 mx-auto mb-6 bg-gradient-to-br from-[#E8F5F3] to-[#F0FDFA] rounded-full flex items-center justify-center">
                <MessageCircle className="w-16 h-16 text-[#2A7B6E]" />
              </div>
              <h2 className="text-2xl font-bold text-[#334155] mb-3">
                Select a conversation
              </h2>
              <p className="text-[#64748B] leading-relaxed">
                Choose a conversation from the sidebar to start messaging. 
                All your chats are synced in real-time.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
