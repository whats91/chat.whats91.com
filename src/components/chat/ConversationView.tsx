'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubbleContent } from '@/components/chat/MessageBubbleContent';
import { getCurrentUserId } from '@/lib/config/current-user';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Phone,
  Video,
  Search,
  MoreVertical,
  ArrowLeft,
  Paperclip,
  Image as ImageIcon,
  Smile,
  Mic,
  Send,
  Check,
  CheckCheck,
  Clock,
  X,
  Reply,
  Copy,
  Star,
  Forward,
  Info,
  Trash2,
} from 'lucide-react';
import type { Message, Conversation } from '@/lib/types/chat';
import { format, isToday, isYesterday } from 'date-fns';

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

export function ConversationView({
  conversationId,
  onBack,
  showBackButton = false,
}: ConversationViewProps) {
  const {
    conversations,
    getMessages,
    sendMessage,
    toggleRightPanel,
    isRightPanelOpen,
  } = useChatStore();
  
  const conversation = conversations.find(c => c.id === conversationId);
  const messages = getMessages(conversationId);
  
  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Conversation not found
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <ConversationHeader
        conversation={conversation}
        onBack={onBack}
        showBackButton={showBackButton}
        onInfoClick={() => toggleRightPanel()}
        isInfoOpen={isRightPanelOpen}
      />
      
      {/* Messages - wrapper div with overflow-hidden is critical for ScrollArea */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList messages={messages} currentUserId={getCurrentUserId()} />
      </div>
      
      {/* Composer - fixed at bottom */}
      <MessageComposer
        conversationId={conversationId}
        onSend={(content) => sendMessage(conversationId, content)}
      />
    </div>
  );
}

interface ConversationHeaderProps {
  conversation: Conversation;
  onBack?: () => void;
  showBackButton: boolean;
  onInfoClick: () => void;
  isInfoOpen: boolean;
}

function ConversationHeader({
  conversation,
  onBack,
  showBackButton,
  onInfoClick,
  isInfoOpen,
}: ConversationHeaderProps) {
  const { participant, typing } = conversation;
  
  const initials = participant.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  
  return (
    <div className="flex items-center gap-3 p-3 border-b bg-background">
      {showBackButton && (
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      
      <Avatar className="h-10 w-10">
        <AvatarImage src={participant.avatar} alt={participant.name} />
        <AvatarFallback className="bg-primary/20 text-primary font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{participant.name}</div>
        <div className="text-xs text-muted-foreground">
          {typing?.isTyping ? (
            <span className="text-primary">typing...</span>
          ) : participant.status === 'online' ? (
            'online'
          ) : participant.lastSeen ? (
            `last seen ${format(participant.lastSeen, 'h:mm a')}`
          ) : (
            participant.phone
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Video className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Video call</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Phone className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Voice call</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Search className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View contact</DropdownMenuItem>
            <DropdownMenuItem>Media, links, and docs</DropdownMenuItem>
            <DropdownMenuItem>Search</DropdownMenuItem>
            <DropdownMenuItem>Mute notifications</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onInfoClick}>
              <Info className="h-4 w-4 mr-2" />
              {isInfoOpen ? 'Close info' : 'View info'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Block</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  currentUserId: string;
}

function MessageList({ messages, currentUserId }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);
  
  // Group messages by date
  const groupedMessages = messages.reduce<{ date: Date; messages: Message[] }[]>(
    (groups, message) => {
      const messageDate = new Date(message.timestamp);
      messageDate.setHours(0, 0, 0, 0);
      
      const existingGroup = groups.find(g => {
        const groupDate = new Date(g.date);
        groupDate.setHours(0, 0, 0, 0);
        return groupDate.getTime() === messageDate.getTime();
      });
      
      if (existingGroup) {
        existingGroup.messages.push(message);
      } else {
        groups.push({ date: message.timestamp, messages: [message] });
      }
      
      return groups;
    },
    []
  );
  
  const formatDateHeader = (date: Date) => {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMMM d, yyyy');
  };
  
  return (
    <ScrollArea ref={scrollRef} className="h-full p-4">
      <div className="space-y-4">
        {groupedMessages.map((group, groupIndex) => (
          <div key={groupIndex}>
            <div className="flex justify-center mb-4">
              <span className="px-3 py-1 bg-muted rounded-full text-xs text-muted-foreground">
                {formatDateHeader(group.date)}
              </span>
            </div>
            {group.messages.map((message, messageIndex) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.senderId === currentUserId}
                showAvatar={
                  messageIndex === group.messages.length - 1 ||
                  group.messages[messageIndex + 1]?.senderId !== message.senderId
                }
                showTimestamp={
                  messageIndex === group.messages.length - 1 ||
                  group.messages[messageIndex + 1]?.senderId !== message.senderId ||
                  Math.abs(
                    new Date(group.messages[messageIndex + 1]?.timestamp).getTime() -
                      new Date(message.timestamp).getTime()
                  ) > 300000
                }
              />
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showAvatar: boolean;
  showTimestamp: boolean;
}

function MessageBubble({ message, isOwn, showAvatar, showTimestamp }: MessageBubbleProps) {
  const isSending = message.status === 'pending';
  const isSent = message.status === 'sent';
  const isDelivered = message.status === 'delivered';
  const isRead = message.status === 'read';
  
  const renderStatusIcon = () => {
    if (isSending) return <Clock className="h-3 w-3" />;
    if (isSent) return <Check className="h-3 w-3" />;
    if (isDelivered || isRead) return <CheckCheck className={cn('h-3 w-3', isRead && 'text-primary')} />;
    return null;
  };
  
  return (
    <div
      className={cn(
        'flex gap-2 mb-1',
        isOwn ? 'justify-end' : 'justify-start'
      )}
    >
      {!isOwn && showAvatar && <div className="w-8" />}
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-3 py-2',
          isOwn
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        <MessageBubbleContent message={message} isOwn={isOwn} />
        {showTimestamp && (
          <div
            className={cn(
              'flex items-center justify-end gap-1 mt-1 text-xs',
              isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            <span>{format(message.timestamp, 'h:mm a')}</span>
            {isOwn && renderStatusIcon()}
          </div>
        )}
      </div>
    </div>
  );
}

interface MessageComposerProps {
  conversationId: string;
  onSend: (content: string) => void;
}

function MessageComposer({ onSend }: MessageComposerProps) {
  const [message, setMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  
  const handleSend = () => {
    if (message.trim()) {
      onSend(message.trim());
      setMessage('');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  return (
    <div className="p-3 border-t bg-background">
      <div className="flex items-end gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
                <Smile className="h-5 w-5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Emoji</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0">
                <Paperclip className="h-5 w-5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <div className="flex-1 relative">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message"
            className="pr-10"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          >
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
        
        {message.trim() ? (
          <Button
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            onClick={handleSend}
          >
            <Send className="h-5 w-5" />
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-9 w-9 flex-shrink-0', isRecording && 'text-destructive')}
                  onMouseDown={() => setIsRecording(true)}
                  onMouseUp={() => setIsRecording(false)}
                  onMouseLeave={() => setIsRecording(false)}
                >
                  <Mic className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Voice message</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
