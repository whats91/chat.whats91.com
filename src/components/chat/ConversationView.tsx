'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { ConversationTargetPickerDialog } from '@/components/chat/ConversationTargetPickerDialog';
import { MediaLightbox } from '@/components/chat/MediaLightbox';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubbleContent } from '@/components/chat/MessageBubbleContent';
import { fetchPinnedMessage, sendMessage as sendConversationMessage } from '@/lib/api/client';
import { getCurrentUserId } from '@/lib/config/current-user';
import { toast } from '@/hooks/use-toast';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import { formatDateHeaderInIst, formatTimeInIst, getIstDateKey } from '@/lib/time/ist';
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
  ChevronDown,
  ChevronUp,
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
  Archive,
  Pin,
  Trash2,
} from 'lucide-react';
import type { Message, Conversation, ConversationTarget, SendMessageRequest } from '@/lib/types/chat';

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

function getSearchableMessageText(message: Message): string {
  const resolved = resolveMessageForRendering(message);
  const contactText = (resolved.contactData || [])
    .flatMap((contact) => {
      const phoneValues = Array.isArray(contact.phones)
        ? contact.phones.flatMap((phone) => [phone.phone, phone.wa_id].filter(Boolean))
        : [];

      return [
        contact.name?.formattedName,
        contact.name?.firstName,
        contact.name?.lastName,
        ...phoneValues,
      ];
    })
    .filter(Boolean)
    .join(' ');

  return [
    message.isPinned ? 'is:pinned pinned' : null,
    message.isStarred ? 'is:starred starred' : null,
    resolved.content,
    resolved.mediaCaption,
    resolved.mediaFilename,
    resolved.mediaMimeType,
    resolved.locationData?.name,
    resolved.locationData?.address,
    contactText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeMessageDates(message: Message): Message {
  return {
    ...message,
    timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
    readAt: message.readAt ? new Date(message.readAt) : null,
  };
}

function getConversationMessagePreview(message: Message): string {
  const resolved = resolveMessageForRendering(message);

  return (
    resolved.content ||
    resolved.mediaCaption ||
    resolved.mediaFilename ||
    resolved.locationData?.name ||
    `[${resolved.type}]`
  );
}

function compareMessageTimeline(left: Message, right: Message): number {
  const timestampDiff = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
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

export function ConversationView({
  conversationId,
  onBack,
  showBackButton = false,
}: ConversationViewProps) {
  const {
    conversations,
    archiveConversation,
    getMessages,
    muteConversation,
    pinConversation,
    sendMessage,
    loadConversations,
    loadMessages,
    toggleRightPanel,
    isRightPanelOpen,
  } = useChatStore();
  const conversationRootRef = useRef<HTMLDivElement | null>(null);
  const [viewerMessage, setViewerMessage] = useState<Message | null>(null);
  const [isForwardPickerOpen, setIsForwardPickerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1);
  const [dangerAction, setDangerAction] = useState<'clear' | 'delete' | null>(null);
  const [remotePinnedMessage, setRemotePinnedMessage] = useState<Message | null>(null);
  
  const conversation = conversations.find(c => c.id === conversationId);
  const messages = [...getMessages(conversationId)].sort(compareMessageTimeline);
  const currentUserId = getCurrentUserId();
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMatches = useMemo(
    () =>
      normalizedSearchQuery
        ? messages.filter((message) => getSearchableMessageText(message).includes(normalizedSearchQuery))
        : [],
    [messages, normalizedSearchQuery]
  );
  const matchedMessageIds = useMemo(() => new Set(searchMatches.map((message) => message.id)), [searchMatches]);
  const activeMatchId =
    activeSearchMatchIndex >= 0 && activeSearchMatchIndex < searchMatches.length
      ? searchMatches[activeSearchMatchIndex]?.id || null
      : null;
  const pinnedMessageFromLoadedMessages = useMemo(
    () => messages.find((message) => message.isPinned) || null,
    [messages]
  );
  const pinnedMessage = pinnedMessageFromLoadedMessages || remotePinnedMessage;
  const isPinnedMessageLoaded = Boolean(
    pinnedMessage && messages.some((message) => message.id === pinnedMessage.id)
  );

  useEffect(() => {
    if (!isSearchOpen) {
      setSearchQuery('');
      setActiveSearchMatchIndex(-1);
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (!normalizedSearchQuery || searchMatches.length === 0) {
      setActiveSearchMatchIndex(-1);
      return;
    }

    setActiveSearchMatchIndex((currentIndex) => {
      if (currentIndex >= 0 && currentIndex < searchMatches.length) {
        return currentIndex;
      }

      return searchMatches.length - 1;
    });
  }, [normalizedSearchQuery, searchMatches.length]);

  useEffect(() => {
    let cancelled = false;

    const loadPinnedMessage = async () => {
      try {
        const response = await fetchPinnedMessage(conversationId);
        if (cancelled) {
          return;
        }

        if (!response.success || !response.data?.message) {
          setRemotePinnedMessage(null);
          return;
        }

        setRemotePinnedMessage(normalizeMessageDates(response.data.message));
      } catch {
        if (!cancelled) {
          setRemotePinnedMessage(null);
        }
      }
    };

    void loadPinnedMessage();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!remotePinnedMessage) {
      return;
    }

    const loadedMatch = messages.find((message) => message.id === remotePinnedMessage.id);
    if (!loadedMatch) {
      return;
    }

    setRemotePinnedMessage(loadedMatch.isPinned ? loadedMatch : null);
  }, [messages, remotePinnedMessage]);

  const navigateSearch = (direction: 'up' | 'down') => {
    if (searchMatches.length === 0) {
      return;
    }

    setActiveSearchMatchIndex((currentIndex) => {
      if (currentIndex === -1) {
        return direction === 'up' ? searchMatches.length - 1 : 0;
      }

      if (direction === 'up') {
        return currentIndex === 0 ? searchMatches.length - 1 : currentIndex - 1;
      }

      return currentIndex === searchMatches.length - 1 ? 0 : currentIndex + 1;
    });
  };

  const scrollToMessage = (messageId: string) => {
    const root = conversationRootRef.current;
    if (!root) {
      return;
    }

    const escapedId = messageId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const target = root.querySelector<HTMLElement>(`[data-message-id="${escapedId}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const handleForwardConfirm = async (targets: ConversationTarget[]) => {
    if (!viewerMessage) {
      throw new Error('No media is selected for forwarding');
    }

    const resolved = resolveMessageForRendering(viewerMessage);
    if (!['image', 'video', 'sticker'].includes(resolved.type)) {
      throw new Error('This media type cannot be forwarded from the viewer');
    }

    const caption =
      viewerMessage.mediaCaption?.trim() ||
      (viewerMessage.content && !/^\[[^\]]+\]$/.test(viewerMessage.content.trim())
        ? viewerMessage.content.trim()
        : undefined);
    const payload: SendMessageRequest = {
      messageType: resolved.type,
      messageContent: caption,
      mediaCaption: resolved.type === 'sticker' ? undefined : caption,
      forwardSourceMessageId: viewerMessage.id,
    };

    const successfulConversationIds = new Set<string>();
    const failedTargets: string[] = [];

    for (const target of targets) {
      const targetConversationId = target.conversationId;
      if (!targetConversationId) {
        failedTargets.push(target.displayName);
        continue;
      }

      const sendResponse = await sendConversationMessage(targetConversationId, payload);
      if (!sendResponse.success) {
        failedTargets.push(target.displayName);
        continue;
      }

      successfulConversationIds.add(targetConversationId);
    }

    if (successfulConversationIds.size === 0) {
      throw new Error(
        failedTargets.length > 0
          ? `Forward failed for ${failedTargets.join(', ')}`
          : 'Forward failed'
      );
    }

    await loadConversations();

    if (successfulConversationIds.has(conversationId)) {
      await loadMessages(conversationId);
    }

    setIsForwardPickerOpen(false);
    setViewerMessage(null);

    if (failedTargets.length > 0) {
      toast({
        title: 'Forward completed with issues',
        description: `Sent to ${successfulConversationIds.size} recipient${successfulConversationIds.size === 1 ? '' : 's'}. Failed: ${failedTargets.join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Media forwarded',
      description: `Sent to ${successfulConversationIds.size} recipient${successfulConversationIds.size === 1 ? '' : 's'}.`,
    });
  };
  
  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Conversation not found
      </div>
    );
  }
  
  return (
    <div ref={conversationRootRef} className="flex flex-col h-full bg-background">
      {/* Header */}
      <ConversationHeader
        conversation={conversation}
        onBack={onBack}
        showBackButton={showBackButton}
        onSearchClick={() => setIsSearchOpen((current) => !current)}
        isSearchOpen={isSearchOpen}
        onInfoClick={() => toggleRightPanel()}
        isInfoOpen={isRightPanelOpen}
        onMuteToggle={() => {
          void muteConversation(conversation.id);
        }}
        onArchiveToggle={() => {
          void archiveConversation(conversation.id);
        }}
        onPinToggle={() => {
          void pinConversation(conversation.id);
        }}
        onClearChat={() => setDangerAction('clear')}
        onDeleteConversation={() => setDangerAction('delete')}
      />

      {isSearchOpen ? (
        <ConversationSearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          activeMatchIndex={activeSearchMatchIndex}
          totalMatches={searchMatches.length}
          onNavigateUp={() => navigateSearch('up')}
          onNavigateDown={() => navigateSearch('down')}
          onClose={() => setIsSearchOpen(false)}
        />
      ) : null}

      {pinnedMessage ? (
        <PinnedMessageBanner
          message={pinnedMessage}
          isLoaded={isPinnedMessageLoaded}
          onClick={() => scrollToMessage(pinnedMessage.id)}
        />
      ) : null}
      
      {/* Messages - wrapper div with overflow-hidden is critical for ScrollArea */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          onOpenMedia={(message) => setViewerMessage(message)}
          activeMatchId={activeMatchId}
          matchedMessageIds={matchedMessageIds}
        />
      </div>
      
      {/* Composer - fixed at bottom */}
      <MessageComposer
        conversationId={conversationId}
        onSend={(content) => sendMessage(conversationId, content)}
      />

      <MediaLightbox
        open={Boolean(viewerMessage)}
        message={viewerMessage}
        onOpenChange={(open) => {
          if (!open) {
            setIsForwardPickerOpen(false);
            setViewerMessage(null);
          }
        }}
        onForward={(message) => {
          setViewerMessage(message);
          setIsForwardPickerOpen(true);
        }}
      />

      <ConversationTargetPickerDialog
        open={isForwardPickerOpen}
        onOpenChange={setIsForwardPickerOpen}
        title="Forward Media"
        description="Select one or more contacts, then confirm."
        selectionMode="multiple"
        confirmButtonText="Forward"
        allowManualEntry={false}
        sourceFilter="conversation"
        onConfirmSelection={handleForwardConfirm}
      />

      <ConversationDangerDialog
        open={dangerAction !== null}
        action={dangerAction}
        conversationId={conversation.id}
        conversationName={conversation.participant?.name || conversation.contactName || conversation.contactPhone}
        onOpenChange={(open) => {
          if (!open) {
            setDangerAction(null);
          }
        }}
      />
    </div>
  );
}

function PinnedMessageBanner({
  message,
  isLoaded,
  onClick,
}: {
  message: Message;
  isLoaded: boolean;
  onClick: () => void;
}) {
  const preview = getConversationMessagePreview(message);

  const content = (
    <div className="flex min-w-0 items-start gap-3">
      <div className="rounded-full bg-primary/10 p-2 text-primary">
        <Pin className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-primary">Pinned Message</div>
        <p className="truncate text-sm text-foreground">{preview}</p>
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-foreground">{formatTimeInIst(message.timestamp)}</div>
        <div className="text-[11px] text-muted-foreground">
          {isLoaded ? 'Jump to message' : 'Pinned in this chat'}
        </div>
      </div>
    </div>
  );

  return (
    <div className="border-b bg-background/95 px-3 py-2 backdrop-blur">
      {isLoaded ? (
        <button type="button" className="w-full text-left" onClick={onClick}>
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

interface ConversationHeaderProps {
  conversation: Conversation;
  onBack?: () => void;
  showBackButton: boolean;
  onSearchClick: () => void;
  isSearchOpen: boolean;
  onInfoClick: () => void;
  isInfoOpen: boolean;
  onMuteToggle: () => void;
  onArchiveToggle: () => void;
  onPinToggle: () => void;
  onClearChat: () => void;
  onDeleteConversation: () => void;
}

function ConversationHeader({
  conversation,
  onBack,
  showBackButton,
  onSearchClick,
  isSearchOpen,
  onInfoClick,
  isInfoOpen,
  onMuteToggle,
  onArchiveToggle,
  onPinToggle,
  onClearChat,
  onDeleteConversation,
}: ConversationHeaderProps) {
  const { participant, typing } = conversation;
  const participantName = participant?.name || conversation.contactName || conversation.contactPhone;
  const participantAvatar = participant?.avatar;
  const participantPhone = participant?.phone || conversation.contactPhone;
  const participantStatus = participant?.status;
  const participantLastSeen = participant?.lastSeen;
  
  const initials = participantName
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
        <AvatarImage src={participantAvatar} alt={participantName} />
        <AvatarFallback className="bg-primary/20 text-primary font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      
      <button
        type="button"
        className="flex-1 min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/50"
        onClick={onInfoClick}
      >
        <div className="font-medium truncate">{participantName}</div>
        <div className="text-xs text-muted-foreground">
          {typing?.isTyping ? (
            <span className="text-primary">typing...</span>
          ) : participantStatus === 'online' ? (
            'online'
          ) : participantLastSeen ? (
            `last seen ${formatTimeInIst(participantLastSeen)}`
          ) : (
            participantPhone
          )}
        </div>
      </button>
      
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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSearchClick}>
                <Search className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isSearchOpen ? 'Close search' : 'Search'}</TooltipContent>
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
            <DropdownMenuItem onClick={onSearchClick}>
              {isSearchOpen ? 'Close search' : 'Search'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMuteToggle}>
              {conversation.isMuted ? 'Unmute notifications' : 'Mute notifications'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onInfoClick}>
              <Info className="h-4 w-4 mr-2" />
              {isInfoOpen ? 'Close info' : 'View info'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onPinToggle}>
              <Pin className="h-4 w-4 mr-2" />
              {conversation.isPinned ? 'Unpin chat' : 'Pin chat'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchiveToggle}>
              <Archive className="h-4 w-4 mr-2" />
              {conversation.isArchived ? 'Unarchive chat' : 'Archive chat'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Block</DropdownMenuItem>
            <DropdownMenuItem onClick={onClearChat}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear chat
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={onDeleteConversation}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface ConversationSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  activeMatchIndex: number;
  totalMatches: number;
  onNavigateUp: () => void;
  onNavigateDown: () => void;
  onClose: () => void;
}

function ConversationSearchBar({
  query,
  onQueryChange,
  activeMatchIndex,
  totalMatches,
  onNavigateUp,
  onNavigateDown,
  onClose,
}: ConversationSearchBarProps) {
  const currentMatchLabel = totalMatches === 0 ? '0/0' : `${activeMatchIndex + 1}/${totalMatches}`;

  return (
    <div className="border-b bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) {
                  onNavigateUp();
                } else {
                  onNavigateDown();
                }
              }
            }}
            placeholder="Search messages"
            className="pl-9"
          />
        </div>

        <span className="min-w-10 text-center text-xs text-muted-foreground">
          {currentMatchLabel}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNavigateUp}
          disabled={totalMatches === 0}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNavigateDown}
          disabled={totalMatches === 0}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  currentUserId: string;
  onOpenMedia: (message: Message) => void;
  activeMatchId: string | null;
  matchedMessageIds: Set<string>;
}

function MessageList({
  messages,
  currentUserId,
  onOpenMedia,
  activeMatchId,
  matchedMessageIds,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement | null>());
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (activeMatchId) {
      return;
    }

    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [activeMatchId, messages]);

  useEffect(() => {
    if (!activeMatchId) {
      return;
    }

    const target = messageRefs.current.get(activeMatchId);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMatchId]);
  
  // Group messages by date
  const groupedMessages = messages.reduce<{ dateKey: string; date: Date; messages: Message[] }[]>(
    (groups, message) => {
      const messageDateKey = getIstDateKey(message.timestamp);
      
      const existingGroup = groups.find(g => g.dateKey === messageDateKey);
      
      if (existingGroup) {
        existingGroup.messages.push(message);
      } else {
        groups.push({ dateKey: messageDateKey, date: message.timestamp, messages: [message] });
      }
      
      return groups;
    },
    []
  );
  
  return (
    <ScrollArea ref={scrollRef} className="h-full p-4">
      <div className="space-y-4">
        {groupedMessages.map((group, groupIndex) => (
          <div key={groupIndex}>
            <div className="sticky top-0 z-10 -mx-4 mb-4 flex justify-center px-4 py-2">
              <span className="rounded-full bg-muted/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                {formatDateHeaderInIst(group.date)}
              </span>
            </div>
            {group.messages.map((message, messageIndex) => (
              <div
                key={message.id}
                data-message-id={message.id}
                ref={(node) => {
                  if (node) {
                    messageRefs.current.set(message.id, node);
                  } else {
                    messageRefs.current.delete(message.id);
                  }
                }}
              >
                <MessageBubble
                  message={message}
                  isOwn={message.senderId === currentUserId}
                  onOpenMedia={onOpenMedia}
                  isMatched={matchedMessageIds.has(message.id)}
                  isActiveMatch={activeMatchId === message.id}
                  showTimestamp={
                    messageIndex === group.messages.length - 1 ||
                    group.messages[messageIndex + 1]?.senderId !== message.senderId ||
                    Math.abs(
                      new Date(group.messages[messageIndex + 1]?.timestamp).getTime() -
                        new Date(message.timestamp).getTime()
                    ) > 300000
                  }
                />
              </div>
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
  onOpenMedia: (message: Message) => void;
  isMatched: boolean;
  isActiveMatch: boolean;
  showTimestamp: boolean;
}

function MessageBubble({
  message,
  isOwn,
  onOpenMedia,
  isMatched,
  isActiveMatch,
  showTimestamp,
}: MessageBubbleProps) {
  const { toggleMessagePinned, toggleMessageStarred } = useChatStore();
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

  const handleTogglePinned = async () => {
    try {
      await toggleMessagePinned(message.conversationId, message.id);
    } catch (error) {
      toast({
        title: 'Unable to update pinned state',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleToggleStarred = async () => {
    try {
      await toggleMessageStarred(message.conversationId, message.id);
    } catch (error) {
      toast({
        title: 'Unable to update starred state',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const messageMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-1 h-7 w-7 shrink-0 opacity-70 transition-opacity hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isOwn ? 'end' : 'start'}>
        <DropdownMenuItem
          onClick={() => {
            void handleTogglePinned();
          }}
        >
          <Pin className="mr-2 h-4 w-4" />
          {message.isPinned ? 'Unpin message' : 'Pin message'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleToggleStarred();
          }}
        >
          <Star className="mr-2 h-4 w-4" />
          {message.isStarred ? 'Unstar message' : 'Star message'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  
  return (
    <div
      className={cn(
        'group mb-1 flex w-full items-start gap-1',
        isOwn ? 'justify-end' : 'justify-start'
      )}
    >
      {isOwn ? messageMenu : null}
      <div
        className={cn(
          'w-fit max-w-[min(85vw,24rem)] rounded-lg px-3 py-2 transition-shadow',
          isOwn
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted',
          message.isPinned && 'shadow-sm ring-1 ring-primary/30',
          message.isStarred && 'shadow-sm shadow-amber-400/20',
          isActiveMatch && 'ring-2 ring-primary/50 shadow-sm',
          !isActiveMatch && isMatched && 'ring-1 ring-primary/20'
        )}
      >
        {message.isPinned || message.isStarred ? (
          <div
            className={cn(
              'mb-1 flex items-center gap-2 text-[11px] font-medium',
              isOwn ? 'text-primary-foreground/80' : 'text-muted-foreground'
            )}
          >
            {message.isPinned ? (
              <span className="inline-flex items-center gap-1">
                <Pin className="h-3 w-3" />
                <span>Pinned</span>
              </span>
            ) : null}
            {message.isStarred ? (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3" />
                <span>Starred</span>
              </span>
            ) : null}
          </div>
        ) : null}
        <MessageBubbleContent message={message} isOwn={isOwn} onOpenMedia={onOpenMedia} />
        {showTimestamp && (
          <div
            className={cn(
              'flex items-center justify-end gap-1 mt-1 text-xs',
              isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            <span>{formatTimeInIst(message.timestamp)}</span>
            {isOwn && renderStatusIcon()}
          </div>
        )}
      </div>
      {!isOwn ? messageMenu : null}
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
