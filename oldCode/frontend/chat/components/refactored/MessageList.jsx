'use client';

import { memo, useRef, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import MessageBubble from './MessageBubble';

// Group messages by date
const groupMessagesByDate = (messages) => {
  const groups = [];
  const groupMap = new Map();
  
  messages.forEach((msg) => {
    const date = new Date(msg.timestamp);
    const dateKey = date.toDateString();
    
    if (!groupMap.has(dateKey)) {
      const group = { date: dateKey, messages: [] };
      groupMap.set(dateKey, group);
      groups.push(group);
    }
    
    groupMap.get(dateKey).messages.push(msg);
  });
  
  return groups;
};

// Format date label
const formatDateLabel = (dateString) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  
  return date.toLocaleDateString('en-US', { 
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// Date divider component
const DateDivider = memo(function DateDivider({ date }) {
  return (
    <div className="flex justify-center py-3">
      <div className="bg-white/90 backdrop-blur-sm text-[#64748B] text-xs font-medium px-4 py-1.5 rounded-full shadow-md border border-[#E2E8F0]">
        {formatDateLabel(date)}
      </div>
    </div>
  );
});

// Loading more indicator
const LoadingIndicator = () => (
  <div className="flex justify-center py-4">
    <Loader2 className="w-5 h-5 animate-spin text-[#2A7B6E]" />
  </div>
);

// Message group component (optimized)
const MessageGroup = memo(function MessageGroup({ group, conversationId }) {
  return (
    <>
      <DateDivider date={group.date} />
      {group.messages.map((message, index) => {
        const nextMessage = group.messages[index + 1];
        const showTail = !nextMessage || nextMessage.direction !== message.direction;
        
        return (
          <div 
            key={message.uid || message.whatsapp_message_id || index}
            className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'} mb-1`}
          >
            <MessageBubble 
              message={message}
              isOwn={message.direction === 'outbound'}
              showTail={showTail}
              conversationId={conversationId}
            />
          </div>
        );
      })}
    </>
  );
});

// Main MessageList component
export default function MessageList({
  messages,
  loading,
  loadingMore,
  selectedConversation,
  onLoadMore,
  hasMore,
  scrollToBottom = true,
  emptyTitle = 'No messages yet',
  emptyDescription = 'Start the conversation!'
}) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const prevScrollHeightRef = useRef(0);
  const shouldScrollToBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  
  // Group messages by date (memoized)
  const groupedMessages = useMemo(() => groupMessagesByDate(messages), [messages]);
  
  // Check if user is near bottom of scroll
  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // Consider "near bottom" if within 150px
    return distanceFromBottom < 150;
  }, []);
  
  // Handle scroll to load more
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !hasMore || loadingMore) return;
    
    const { scrollTop, scrollHeight } = containerRef.current;
    
    // Store current scroll position
    prevScrollHeightRef.current = scrollHeight;
    
    // If scrolled near top, load more
    if (scrollTop < 100 && hasMore && !loadingMore) {
      shouldScrollToBottomRef.current = false;
      onLoadMore?.();
    }
  }, [hasMore, loadingMore, onLoadMore]);
  
  // Initial scroll to bottom when conversation first loads
  useEffect(() => {
    if (!bottomRef.current || messages.length === 0) return;
    
    // On initial load (when prevMessagesLength was 0), scroll immediately
    if (prevMessagesLengthRef.current === 0 && messages.length > 0) {
      requestAnimationFrame(() => {
        if (bottomRef.current) {
          bottomRef.current.scrollIntoView({ behavior: 'instant' });
        }
      });
    }
  }, [messages.length]);
  
  // Auto-scroll to bottom for new messages
  useEffect(() => {
    if (!containerRef.current || !bottomRef.current) return;
    
    const messagesAdded = messages.length > prevMessagesLengthRef.current;
    const isInitialLoad = prevMessagesLengthRef.current === 0;
    prevMessagesLengthRef.current = messages.length;
    
    // Skip if this is initial load (handled by separate effect above)
    if (isInitialLoad) return;
    
    // If loading more old messages (prepending), maintain scroll position
    if (!shouldScrollToBottomRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight;
      const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
      containerRef.current.scrollTop = scrollDiff;
      shouldScrollToBottomRef.current = true;
      return;
    }
    
    // For new messages, only scroll if user was near bottom
    if (messagesAdded && scrollToBottom) {
      const wasNearBottom = isNearBottom();
      
      if (wasNearBottom) {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'instant' });
          }
        });
      }
    }
  }, [messages, scrollToBottom, isNearBottom]);
  
  // Show empty state
  if (!loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-[#FAFBFC] to-white">
        <div className="text-center p-6">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-[#E8F5F3] to-[#F0FDFA] rounded-full flex items-center justify-center shadow-md">
            <span className="text-4xl">💬</span>
          </div>
          <p className="text-[#334155] font-semibold text-base mb-1">{emptyTitle}</p>
          <p className="text-[#64748B] text-sm">{emptyDescription}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2"
      style={{ 
        scrollbarWidth: 'thin', 
        scrollbarColor: '#2A7B6E #F4F6F8',
        background: `linear-gradient(to bottom, #FAFBFC, #F4F6F8)`,
      }}
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-[#2A7B6E]" />
        </div>
      ) : (
        <>
          {loadingMore && <LoadingIndicator />}
          
          {groupedMessages.map((group) => (
            <MessageGroup 
              key={group.date} 
              group={group}
              conversationId={selectedConversation?.id}
            />
          ))}
          
          {/* Scroll anchor */}
          <div ref={bottomRef} className="h-4" />
        </>
      )}
    </div>
  );
}
