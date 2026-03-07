'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Pin,
  Archive,
  BellOff,
  Trash2,
  Search,
  MoreVertical,
  MessageSquarePlus,
  Phone,
  Filter,
} from 'lucide-react';
import type { Conversation } from '@/lib/types/chat';
import { formatDistanceToNow } from 'date-fns';

interface ChatListProps {
  className?: string;
}

export function ChatList({ className }: ChatListProps) {
  const {
    conversations,
    selectedConversationId,
    searchQuery,
    setSearchQuery,
    selectConversation,
    pinConversation,
    archiveConversation,
    muteConversation,
    deleteConversation,
    toggleNewChatModal,
  } = useChatStore();
  
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');
  
  const filteredConversations = conversations
    .filter(conv => {
      if (filter === 'unread') return conv.unreadCount > 0;
      if (filter === 'archived') return conv.isArchived;
      return !conv.isArchived;
    })
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  
  const searchFiltered = searchQuery
    ? filteredConversations.filter(conv =>
        conv.participant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.participant.phone.includes(searchQuery) ||
        conv.lastMessage?.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filteredConversations;
  
  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src="/images/icon.png" alt="Whats91" className="h-7 w-7 rounded-sm" />
            <h1 className="text-xl font-semibold">Chats</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleNewChatModal()}
            >
              <MessageSquarePlus className="h-5 w-5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>New group</DropdownMenuItem>
                <DropdownMenuItem>Starred messages</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-muted/50"
          />
        </div>
        
        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button
            variant={filter === 'unread' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('unread')}
          >
            Unread
          </Button>
          <Button
            variant={filter === 'archived' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter('archived')}
          >
            Archived
          </Button>
        </div>
      </div>
      
      {/* Chat List */}
      <ScrollArea className="flex-1">
        {searchFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <MessageSquarePlus className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No chats found</p>
          </div>
        ) : (
          <div className="divide-y">
            {searchFiltered.map((conversation) => (
              <ChatListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedConversationId}
                onSelect={() => selectConversation(conversation.id)}
                onPin={() => pinConversation(conversation.id)}
                onArchive={() => archiveConversation(conversation.id)}
                onMute={() => muteConversation(conversation.id)}
                onDelete={() => deleteConversation(conversation.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ChatListItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onMute: () => void;
  onDelete: () => void;
}

function ChatListItem({
  conversation,
  isSelected,
  onSelect,
  onPin,
  onArchive,
  onMute,
  onDelete,
}: ChatListItemProps) {
  const { participant, lastMessage, unreadCount, isPinned, isMuted, typing } = conversation;
  
  const initials = participant.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  
  const timeAgo = lastMessage
    ? formatDistanceToNow(lastMessage.timestamp, { addSuffix: false })
    : '';
  
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/50',
        isSelected && 'bg-primary/10'
      )}
      onClick={onSelect}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <Avatar className="h-12 w-12">
          <AvatarImage src={participant.avatar} alt={participant.name} />
          <AvatarFallback className="bg-primary/20 text-primary font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        {participant.status === 'online' && (
          <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{participant.name}</span>
            {isPinned && <Pin className="h-3 w-3 text-muted-foreground" />}
            {isMuted && <BellOff className="h-3 w-3 text-muted-foreground" />}
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {timeAgo}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-sm text-muted-foreground truncate">
            {typing?.isTyping ? (
              <span className="text-primary">typing...</span>
            ) : (
              lastMessage?.content
            )}
          </p>
          {unreadCount > 0 && (
            <Badge variant="default" className="h-5 min-w-5 px-1.5 text-xs rounded-full">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Actions Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onPin}>
            <Pin className="h-4 w-4 mr-2" />
            {isPinned ? 'Unpin chat' : 'Pin chat'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onMute}>
            <BellOff className="h-4 w-4 mr-2" />
            {isMuted ? 'Unmute' : 'Mute'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="h-4 w-4 mr-2" />
            {conversation.isArchived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
