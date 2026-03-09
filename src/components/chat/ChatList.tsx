'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { fetchCsrfToken, logout as logoutSession } from '@/lib/api/auth-client';
import { exportAllConversationsToExcel } from '@/lib/api/client';
import { clearCurrentUserId } from '@/lib/config/current-user';
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
  Eraser,
  Search,
  MoreVertical,
  MessageSquarePlus,
  Loader2,
  FileSpreadsheet,
} from 'lucide-react';
import type { Conversation } from '@/lib/types/chat';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

interface ChatListProps {
  className?: string;
}

export function ChatList({ className }: ChatListProps) {
  const router = useRouter();
  const {
    conversations,
    selectedConversationId,
    searchQuery,
    setSearchQuery,
    selectConversation,
    pinConversation,
    archiveConversation,
    muteConversation,
    loadConversations,
    loadMoreConversations,
    hasMoreConversations,
    isLoadingConversations,
    toggleNewChatModal,
  } = useChatStore();
  
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const scrollAreaContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const [dangerDialogState, setDangerDialogState] = useState<{
    action: 'clear' | 'delete';
    conversationId: string;
    conversationName: string;
  } | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      const csrfToken = await fetchCsrfToken();
      const response = await logoutSession(csrfToken);

      if (!response.success) {
        throw new Error(response.message || 'Failed to log out');
      }

      clearCurrentUserId();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('whats91-chat-store');
      }

      selectConversation(null);
      toast({
        title: 'Logged out',
        description: 'Your session has been ended successfully.',
      });
      router.replace('/login');
      router.refresh();
    } catch (error) {
      toast({
        title: 'Logout failed',
        description: error instanceof Error ? error.message : 'Unable to log out',
        variant: 'destructive',
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleExportAll() {
    if (isExportingAll) {
      return;
    }

    setIsExportingAll(true);

    try {
      await exportAllConversationsToExcel();
      toast({
        title: 'Export started',
        description: 'Your Excel export is downloading.',
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unable to export chats',
        variant: 'destructive',
      });
    } finally {
      setIsExportingAll(false);
    }
  }

  useEffect(() => {
    void loadConversations({
      page: 1,
      search: deferredSearchQuery.trim(),
      archived: filter === 'archived',
      unreadOnly: filter === 'unread',
    });
  }, [deferredSearchQuery, filter, loadConversations]);

  useEffect(() => {
    const root = scrollAreaContainerRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    const target = loadMoreTriggerRef.current;

    if (!root || !target || !hasMoreConversations) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isLoadingConversations) {
          void loadMoreConversations();
        }
      },
      {
        root,
        rootMargin: '240px 0px',
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreConversations, isLoadingConversations, loadMoreConversations, conversations.length]);
  
  const filteredConversations = useMemo(
    () =>
      conversations
        .filter(conv => {
      if (filter === 'unread') return conv.unreadCount > 0;
      if (filter === 'archived') return conv.isArchived;
      return !conv.isArchived;
        })
        .sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        }),
    [conversations, filter]
  );
  
  const searchFiltered = useMemo(
    () =>
      searchQuery
        ? filteredConversations.filter(conv =>
        (conv.participant?.name || conv.contactName || conv.contactPhone).toLowerCase().includes(searchQuery.toLowerCase()) ||
        (conv.participant?.phone || conv.contactPhone).includes(searchQuery) ||
        conv.lastMessage?.content?.toLowerCase().includes(searchQuery.toLowerCase())
      )
        : filteredConversations,
    [filteredConversations, searchQuery]
  );
  
  return (
    <div className={cn('flex h-full flex-col bg-sidebar', className)}>
      {/* Header */}
      <div className="border-b border-border/80 p-3">
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
                <DropdownMenuItem
                  disabled={isExportingAll}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleExportAll();
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {isExportingAll ? 'Exporting...' : 'Export all'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    router.push('/settings');
                  }}
                >
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(event) => {
                  event.preventDefault();
                  void handleLogout();
                }}>
                  {isLoggingOut ? 'Logging out...' : 'Log out'}
                </DropdownMenuItem>
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
            className="rounded-full border-border/70 bg-card pl-9 shadow-none"
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
      <div ref={scrollAreaContainerRef} className="flex-1 min-h-0">
      <ScrollArea className="h-full">
        {searchFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <MessageSquarePlus className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No chats found</p>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {searchFiltered.map((conversation) => (
              <ChatListItem
                key={conversation.id}
                conversation={conversation}
                isSelected={conversation.id === selectedConversationId}
                onSelect={() => selectConversation(conversation.id)}
                onPin={() => {
                  void pinConversation(conversation.id);
                }}
                onArchive={() => {
                  void archiveConversation(conversation.id);
                }}
                onMute={() => {
                  void muteConversation(conversation.id);
                }}
                onClear={() =>
                  setDangerDialogState({
                    action: 'clear',
                    conversationId: conversation.id,
                    conversationName:
                      conversation.participant?.name || conversation.contactName || conversation.contactPhone,
                  })
                }
                onDelete={() =>
                  setDangerDialogState({
                    action: 'delete',
                    conversationId: conversation.id,
                    conversationName:
                      conversation.participant?.name || conversation.contactName || conversation.contactPhone,
                  })
                }
              />
            ))}
            <div ref={loadMoreTriggerRef} className="h-1" />
            {(isLoadingConversations || hasMoreConversations) && searchFiltered.length > 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                {isLoadingConversations ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>{isLoadingConversations ? 'Loading more chats...' : 'Scroll for more chats'}</span>
              </div>
            ) : null}
          </div>
        )}
      </ScrollArea>
      </div>

      <ConversationDangerDialog
        open={dangerDialogState !== null}
        action={dangerDialogState?.action || null}
        conversationId={dangerDialogState?.conversationId || null}
        conversationName={dangerDialogState?.conversationName || null}
        onOpenChange={(open) => {
          if (!open) {
            setDangerDialogState(null);
          }
        }}
      />
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
  onClear: () => void;
  onDelete: () => void;
}

function ChatListItem({
  conversation,
  isSelected,
  onSelect,
  onPin,
  onArchive,
  onMute,
  onClear,
  onDelete,
}: ChatListItemProps) {
  const { participant, lastMessage, unreadCount, isPinned, isMuted, typing } = conversation;
  const participantName = participant?.name || conversation.contactName || conversation.contactPhone;
  const participantPhone = participant?.phone || conversation.contactPhone;
  const participantAvatar = participant?.avatar;
  const participantStatus = participant?.status;
  
  const initials = participantName
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
        'group flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/80',
        isSelected && 'bg-accent'
      )}
      onClick={onSelect}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <Avatar className="h-12 w-12">
          <AvatarImage src={participantAvatar} alt={participantName} />
          <AvatarFallback className="bg-primary/20 text-primary font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        {participantStatus === 'online' && (
          <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{participantName}</span>
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
              lastMessage?.content || participantPhone
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
          <DropdownMenuItem onClick={onClear}>
            <Eraser className="h-4 w-4 mr-2" />
            Clear chat
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
