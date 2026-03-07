'use client';

import { memo, useCallback, useRef, useEffect } from 'react';
import { Loader2, MessageCircle, Check, CheckCheck } from 'lucide-react';
import { getMessagePreview, formatRelativeTime } from '@/utils/chatUtils';

// Memoized conversation item for performance
const ConversationItem = memo(function ConversationItem({ 
  conversation, 
  isSelected, 
  onSelect 
}) {
  // Determine if we have a name (not just a phone number)
  const hasName = conversation.display_name && 
                  conversation.display_name !== conversation.contact_phone;
  
  const displayName = conversation.display_name || conversation.contact_phone || 'Unknown';
  const phoneNumber = conversation.contact_phone;
  const initials = displayName.charAt(0).toUpperCase();
  
  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [conversation, onSelect]);
  
  // Get last message preview
  const lastMessagePreview = getMessagePreview({
    message_content: conversation.last_message_content,
    message_type: conversation.last_message_type,
    media_caption: null,
    media_filename: null
  }, 40);
  
  const timeAgo = conversation.last_message_at 
    ? formatRelativeTime(conversation.last_message_at) 
    : '';
  
  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-3 p-3 hover:bg-[#F4F6F8] transition-all text-left border-b border-[#E2E8F0]/50 ${
        isSelected ? 'bg-gradient-to-r from-[#E8F5F3] to-transparent border-l-4 border-l-[#2A7B6E]' : ''
      }`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] flex items-center justify-center shadow-md">
        {conversation.profile_picture ? (
          <img 
            src={conversation.profile_picture} 
            alt={displayName}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span className="text-lg font-semibold text-white">
            {initials}
          </span>
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[#334155] truncate">
              {displayName}
            </div>
            {hasName && phoneNumber && (
              <div className="text-xs text-[#64748B] font-normal truncate mt-0.5">
                {phoneNumber}
              </div>
            )}
          </div>
          <span className="text-xs text-[#64748B] font-medium flex-shrink-0 ml-2">
            {timeAgo}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {conversation.last_message_direction === 'outbound' && (
              <span className="flex-shrink-0">
                {conversation.last_message_status === 'read' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#2A7B6E]" />
                ) : conversation.last_message_status === 'delivered' ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#64748B]" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-[#64748B]" />
                )}
              </span>
            )}
            <span className="text-sm text-[#64748B] truncate">
              {lastMessagePreview}
            </span>
          </div>
          
          {conversation.unread_count > 0 && (
            <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-2 bg-[#2A7B6E] text-white text-xs font-bold rounded-full flex items-center justify-center shadow-sm">
              {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo
  return (
    prevProps.conversation.id === nextProps.conversation.id &&
    prevProps.conversation.last_message_at === nextProps.conversation.last_message_at &&
    prevProps.conversation.unread_count === nextProps.conversation.unread_count &&
    prevProps.conversation.last_message_status === nextProps.conversation.last_message_status &&
    prevProps.isSelected === nextProps.isSelected
  );
});

// Loading skeleton for conversations
const ConversationSkeleton = () => (
  <div className="flex items-center gap-3 p-3 animate-pulse border-b border-[#E2E8F0]/50">
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#E2E8F0] to-[#F4F6F8]" />
    <div className="flex-1 space-y-2">
      <div className="h-4 bg-[#E2E8F0] rounded-lg w-3/4" />
      <div className="h-3 bg-[#F4F6F8] rounded-lg w-1/2" />
    </div>
  </div>
);

// Main ConversationList component
export default function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  searchTerm,
  loading,
  loadingMore,
  hasMore,
  onLoadMore
}) {
  const listRef = useRef(null);
  const loadMoreRef = useRef(null);
  const observerRef = useRef(null);
  
  // Setup intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !loadingMore) {
          onLoadMore?.();
        }
      },
      { root: listRef.current, rootMargin: '200px', threshold: 0 }
    );
    
    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }
    
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  
  return (
    <div className="flex flex-1 min-h-0 flex-col bg-white">
      {/* Conversation List */}
      <div 
        ref={listRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2A7B6E #F4F6F8' }}
      >
        {loading ? (
          // Loading skeletons
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <ConversationSkeleton key={i} />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#E8F5F3] to-[#F0FDFA] rounded-full flex items-center justify-center mb-4 shadow-md">
              <MessageCircle className="w-10 h-10 text-[#2A7B6E]" />
            </div>
            <p className="text-[#334155] font-semibold text-base mb-1">
              {searchTerm ? 'No conversations found' : 'No conversations yet'}
            </p>
            <p className="text-[#64748B] text-sm">
              {searchTerm ? 'Try a different search term' : 'Start a new conversation'}
            </p>
          </div>
        ) : (
          <>
            {conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id || conversation.uid}
                conversation={conversation}
                isSelected={selectedConversation?.id === conversation.id}
                onSelect={onSelectConversation}
              />
            ))}
            
            {/* Load more trigger */}
            <div ref={loadMoreRef} className="h-4">
              {loadingMore && (
                <div className="flex justify-center py-3">
                  <Loader2 className="w-5 h-5 animate-spin text-[#2A7B6E]" />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
