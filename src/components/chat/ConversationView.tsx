'use client';

// Dependency note:
// Message rendering, composer, service-window, or message-action changes here
// usually require matching updates in:
// - src/lib/types/chat.ts
// - src/stores/chatStore.ts
// - src/lib/api/client.ts
// - src/lib/messages/resolve-message-for-rendering.ts
// - src/server/controllers/conversation-controller.ts
// - src/components/chat/MessageBubbleContent.tsx

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { ConversationMediaDialog } from '@/components/chat/ConversationMediaDialog';
import { MessageInfoDialog } from '@/components/chat/MessageInfoDialog';
import { ConversationTargetPickerDialog } from '@/components/chat/ConversationTargetPickerDialog';
import { MediaLightbox } from '@/components/chat/MediaLightbox';
import { MessageRewritePopover } from '@/components/chat/MessageRewritePopover';
import { TemplatePickerDialog } from '@/components/chat/TemplatePickerDialog';
import { VoiceMessageButton } from '@/components/chat/VoiceMessageButton';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubbleContent, canRenderInlineMessageMeta } from '@/components/chat/MessageBubbleContent';
import {
  exportConversationToExcel,
  fetchPinnedMessage,
  sendMessage as sendConversationMessage,
  uploadMedia,
} from '@/lib/api/client';
import { getCurrentUserId } from '@/lib/config/current-user';
import { formatChatPhoneNumber } from '@/lib/phone/format';
import { toast } from '@/hooks/use-toast';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import { debugPubSub } from '@/lib/pubsub/debug';
import { formatDateHeaderInIst, formatDateInIst, formatTimeInIst, getIstDateKey } from '@/lib/time/ist';
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
  Search,
  MoreVertical,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Plus,
  Image as ImageIcon,
  FileText,
  Send,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  X,
  Reply,
  Copy,
  Star,
  Forward,
  Info,
  Archive,
  Pin,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import type { Message, Conversation, ConversationTarget, SendMessageRequest } from '@/lib/types/chat';

interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

const EMPTY_MESSAGES: Message[] = [];

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

function getMessageSortTime(message: Message): number {
  const metadataSortTimestamp = message.metadata?.sortTimestamp;
  const sortDate =
    metadataSortTimestamp instanceof Date
      ? metadataSortTimestamp
      : metadataSortTimestamp
        ? new Date(metadataSortTimestamp)
        : message.timestamp instanceof Date
          ? message.timestamp
          : new Date(message.timestamp);

  const sortTime = sortDate.getTime();
  if (Number.isFinite(sortTime)) {
    return sortTime;
  }

  const fallbackDate = message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp);
  return fallbackDate.getTime();
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
  const leftId = Number(left.id);
  const rightId = Number(right.id);
  const leftTimestamp = getMessageSortTime(left);
  const rightTimestamp = getMessageSortTime(right);

  if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
    const timestampDiff = leftTimestamp - rightTimestamp;
    if (timestampDiff !== 0) {
      return timestampDiff;
    }
  } else if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
    debugPubSub('ConversationView encountered invalid message timestamp during sort fallback', {
      leftMessageId: left.id,
      rightMessageId: right.id,
      leftTimestamp,
      rightTimestamp,
    });
  }

  if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return leftId - rightId;
  }

  if (left.whatsappMessageId && right.whatsappMessageId && left.whatsappMessageId !== right.whatsappMessageId) {
    return left.whatsappMessageId.localeCompare(right.whatsappMessageId);
  }

  return String(left.id).localeCompare(String(right.id));
}

export function ConversationView({
  conversationId,
  onBack,
  showBackButton = false,
}: ConversationViewProps) {
  const archiveConversation = useChatStore((state) => state.archiveConversation);
  const blockConversation = useChatStore((state) => state.blockConversation);
  const muteConversation = useChatStore((state) => state.muteConversation);
  const pinConversation = useChatStore((state) => state.pinConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const toggleRightPanel = useChatStore((state) => state.toggleRightPanel);
  const isRightPanelOpen = useChatStore((state) => state.isRightPanelOpen);
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === conversationId) || null
  );
  const liveMessages = useChatStore((state) => state.messagesByConversation.get(conversationId));
  const conversationRootRef = useRef<HTMLDivElement | null>(null);
  const [viewerMessage, setViewerMessage] = useState<Message | null>(null);
  const [isForwardPickerOpen, setIsForwardPickerOpen] = useState(false);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(-1);
  const [dangerAction, setDangerAction] = useState<'clear' | 'delete' | null>(null);
  const [infoMessage, setInfoMessage] = useState<Message | null>(null);
  const [remotePinnedMessage, setRemotePinnedMessage] = useState<Message | null>(null);
  const [isExportingConversation, setIsExportingConversation] = useState(false);
  const [serviceWindowNow, setServiceWindowNow] = useState(() => Date.now());
  
  const messages = useMemo(
    () => {
      if (!liveMessages || liveMessages.length === 0) {
        return EMPTY_MESSAGES;
      }

      return [...liveMessages].sort(compareMessageTimeline);
    },
    [liveMessages]
  );
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
  const isServiceWindowActive = Boolean(
    conversation?.isServiceWindowOpen &&
      (!conversation.serviceWindowExpiresAt ||
        new Date(conversation.serviceWindowExpiresAt).getTime() > serviceWindowNow)
  );

  useEffect(() => {
    debugPubSub('ConversationView live messages changed', {
      conversationId,
      totalMessages: messages.length,
      latestMessage: messages[messages.length - 1] || null,
    });
  }, [conversationId, messages]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setServiceWindowNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
    if (!isServiceWindowActive) {
      throw new Error('Service window is inactive for this chat');
    }

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

  const handleExportConversation = async () => {
    if (isExportingConversation) {
      return;
    }

    setIsExportingConversation(true);

    try {
      await exportConversationToExcel(conversationId);
      toast({
        title: 'Export started',
        description: 'This chat is downloading as an Excel file.',
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unable to export this chat',
        variant: 'destructive',
      });
    } finally {
      setIsExportingConversation(false);
    }
  };
  
  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Conversation not found
      </div>
    );
  }
  
  return (
    <div ref={conversationRootRef} className="chat-canvas flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-30 shrink-0">
        <ConversationHeader
          conversation={conversation}
          onBack={onBack}
          showBackButton={showBackButton}
          onSearchClick={() => setIsSearchOpen((current) => !current)}
          isSearchOpen={isSearchOpen}
          onViewMedia={() => setIsMediaDialogOpen(true)}
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
          onBlockToggle={() => {
            void blockConversation(conversation.id);
          }}
          onExportConversation={() => {
            void handleExportConversation();
          }}
          isExportingConversation={isExportingConversation}
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
      </div>
      
      {/* Messages - wrapper div with overflow-hidden is critical for ScrollArea */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          onOpenMedia={(message) => setViewerMessage(message)}
          onOpenInfo={(message) => setInfoMessage(message)}
          activeMatchId={activeMatchId}
          matchedMessageIds={matchedMessageIds}
        />
      </div>
      
      {/* Composer - fixed at bottom */}
      <MessageComposer
        conversationId={conversationId}
        isBlocked={conversation.isBlocked}
        isServiceWindowOpen={isServiceWindowActive}
        serviceWindowExpiresAt={conversation.serviceWindowExpiresAt || null}
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
        onForward={
          isServiceWindowActive
            ? (message) => {
                setViewerMessage(message);
                setIsForwardPickerOpen(true);
              }
            : undefined
        }
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
        serviceWindowOnly
        onConfirmSelection={handleForwardConfirm}
      />

      <ConversationMediaDialog
        open={isMediaDialogOpen}
        onOpenChange={setIsMediaDialogOpen}
        conversationId={conversation.id}
        conversationName={conversation.participant?.name || conversation.contactName || conversation.contactPhone}
      />

      <MessageInfoDialog
        open={infoMessage !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInfoMessage(null);
          }
        }}
        message={infoMessage}
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
    <div className="border-b border-border/80 bg-background/95 px-3 py-2 backdrop-blur">
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
  onViewMedia: () => void;
  onInfoClick: () => void;
  isInfoOpen: boolean;
  onMuteToggle: () => void;
  onArchiveToggle: () => void;
  onPinToggle: () => void;
  onBlockToggle: () => void;
  onExportConversation: () => void;
  isExportingConversation: boolean;
  onClearChat: () => void;
  onDeleteConversation: () => void;
}

function ConversationHeader({
  conversation,
  onBack,
  showBackButton,
  onSearchClick,
  isSearchOpen,
  onViewMedia,
  onInfoClick,
  isInfoOpen,
  onMuteToggle,
  onArchiveToggle,
  onPinToggle,
  onBlockToggle,
  onExportConversation,
  isExportingConversation,
  onClearChat,
  onDeleteConversation,
}: ConversationHeaderProps) {
  const { participant, typing } = conversation;
  const participantAvatar = participant?.avatar;
  const participantPhone = formatChatPhoneNumber(participant?.phone || conversation.contactPhone);
  const rawParticipantName = conversation.contactName?.trim() || participant?.name?.trim() || '';
  const participantName = rawParticipantName && !/^\+?\d+$/.test(rawParticipantName)
    ? rawParticipantName
    : participantPhone;
  const participantStatus = participant?.status;
  const participantLastSeen = participant?.lastSeen;
  
  const initials = participantName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  
  return (
    <div className="flex items-center gap-3 border-b border-border/80 bg-sidebar px-3 py-3">
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
        className="flex-1 min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/70"
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
            <DropdownMenuItem onClick={onInfoClick}>
              <Info className="h-4 w-4 mr-2" />
              {isInfoOpen ? 'Close info' : 'View info'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onViewMedia}>Media, links, and docs</DropdownMenuItem>
            <DropdownMenuItem onClick={onSearchClick}>
              {isSearchOpen ? 'Close search' : 'Search'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMuteToggle}>
              {conversation.isMuted ? 'Unmute notifications' : 'Mute notifications'}
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
            <DropdownMenuItem className="text-destructive" onClick={onBlockToggle}>
              {conversation.isBlocked ? 'Unblock' : 'Block'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isExportingConversation} onClick={onExportConversation}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {isExportingConversation ? 'Exporting...' : 'Export chat'}
            </DropdownMenuItem>
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
    <div className="border-b border-border/80 bg-sidebar px-3 py-2">
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
  onOpenInfo: (message: Message) => void;
  activeMatchId: string | null;
  matchedMessageIds: Set<string>;
}

function MessageList({
  messages,
  currentUserId,
  onOpenMedia,
  onOpenInfo,
  activeMatchId,
  matchedMessageIds,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement | null>());
  const lastMessageId = messages[messages.length - 1]?.id || null;
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (activeMatchId) {
      return;
    }

    debugPubSub('MessageList received updated messages', {
      totalMessages: messages.length,
      lastMessageId,
      lastMessage: lastMessageId ? messages[messages.length - 1] || null : null,
    });

    const frame = window.requestAnimationFrame(() => {
      const lastMessageNode = lastMessageId
        ? messageRefs.current.get(lastMessageId)
        : null;

      if (lastMessageNode) {
        lastMessageNode.scrollIntoView({ block: 'end', behavior: 'smooth' });
        debugPubSub('MessageList scrolled to newest message node', {
          lastMessageId,
        });
        return;
      }

      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          debugPubSub('MessageList scrolled viewport to bottom fallback', {
            totalMessages: messages.length,
            lastMessageId,
          });
        }
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeMatchId, lastMessageId, messages]);

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
              <span className="rounded-full bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
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
                  onOpenInfo={onOpenInfo}
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
  onOpenInfo: (message: Message) => void;
  isMatched: boolean;
  isActiveMatch: boolean;
  showTimestamp: boolean;
}

function MessageBubble({
  message,
  isOwn,
  onOpenMedia,
  onOpenInfo,
  isMatched,
  isActiveMatch,
  showTimestamp,
}: MessageBubbleProps) {
  const { toggleMessagePinned, toggleMessageStarred } = useChatStore();
  const canViewMessageInfo = Number.isFinite(Number(message.id));
  const isSending = message.status === 'pending';
  const isSent = message.status === 'sent';
  const isDelivered = message.status === 'delivered';
  const isRead = message.status === 'read';
  const isFailed = message.status === 'failed';
  const failureLabel = (message.errorMessage || 'Failed').trim();
  
  const renderStatusIcon = () => {
    if (isSending) return <Clock className="h-3 w-3" />;
    if (isSent) return <Check className="h-3 w-3 opacity-75" />;
    if (isDelivered) return <CheckCheck className="h-3 w-3 opacity-75" />;
    if (isRead) return <CheckCheck className="h-3 w-3 text-[#53bdeb]" />;
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
          disabled={!canViewMessageInfo}
          onClick={() => {
            onOpenInfo(message);
          }}
        >
          <Info className="mr-2 h-4 w-4" />
          Info
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
  const shouldRenderInlineMeta =
    showTimestamp &&
    canRenderInlineMessageMeta(message) &&
    !isFailed;
  const messageMeta = showTimestamp ? (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] leading-none',
        isOwn ? 'text-[var(--bubble-out-muted)]' : 'text-[var(--bubble-in-muted)]'
      )}
    >
      <span>{formatTimeInIst(message.timestamp)}</span>
      {isOwn ? renderStatusIcon() : null}
    </span>
  ) : null;
  
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
          'w-fit max-w-[min(85vw,24rem)] rounded-[7.5px] px-3 py-2 transition-shadow',
          isOwn
            ? 'bg-[var(--bubble-out)] text-[var(--bubble-out-foreground)] shadow-[0_1px_0_rgba(17,27,33,0.08)]'
            : 'bg-[var(--bubble-in)] text-[var(--bubble-in-foreground)] shadow-[0_1px_0_rgba(17,27,33,0.06)]',
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
              isOwn ? 'text-[var(--bubble-out-muted)]' : 'text-[var(--bubble-in-muted)]'
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
        <MessageBubbleContent
          message={message}
          isOwn={isOwn}
          onOpenMedia={onOpenMedia}
          inlineMeta={shouldRenderInlineMeta ? messageMeta : undefined}
        />
        {showTimestamp && !shouldRenderInlineMeta && (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-xs',
              isFailed && isOwn ? 'justify-between gap-3' : 'justify-end',
              isOwn ? 'text-[var(--bubble-out-muted)]' : 'text-[var(--bubble-in-muted)]'
            )}
          >
            {isFailed && isOwn ? (
              <span
                className="inline-flex min-w-0 max-w-[14rem] items-center gap-1 text-[11px] font-medium text-destructive"
                title={failureLabel}
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{failureLabel}</span>
              </span>
            ) : null}
            {messageMeta}
          </div>
        )}
      </div>
      {!isOwn ? messageMenu : null}
    </div>
  );
}

interface MessageComposerProps {
  conversationId: string;
  isBlocked: boolean;
  isServiceWindowOpen: boolean;
  serviceWindowExpiresAt: Date | null;
  onSend: (content: string) => void;
}

const MEDIA_FILE_ACCEPT = 'image/*,video/*,audio/*';
const ATTACHMENT_FILE_ACCEPT = [
  MEDIA_FILE_ACCEPT,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
].join(',');

function inferMessageTypeFromFile(file: File): SendMessageRequest['messageType'] {
  const mimeType = file.type.toLowerCase();
  const filename = file.name.toLowerCase();

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png') || filename.endsWith('.gif') || filename.endsWith('.webp')) {
    return 'image';
  }
  if (filename.endsWith('.mp4') || filename.endsWith('.mov') || filename.endsWith('.webm')) {
    return 'video';
  }
  if (filename.endsWith('.mp3') || filename.endsWith('.m4a') || filename.endsWith('.ogg') || filename.endsWith('.wav') || filename.endsWith('.aac')) {
    return 'audio';
  }

  return 'document';
}

function MessageComposer({
  conversationId,
  isBlocked,
  isServiceWindowOpen,
  serviceWindowExpiresAt,
  onSend,
}: MessageComposerProps) {
  const { loadConversations, loadMessages } = useChatStore();
  const [message, setMessage] = useState('');
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isMobileUtilityTrayOpen, setIsMobileUtilityTrayOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const mobileMessageInputRef = useRef<HTMLInputElement | null>(null);
  const desktopMessageInputRef = useRef<HTMLInputElement | null>(null);
  
  const handleSend = () => {
    if (!isBlocked && message.trim()) {
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

  const insertEmoji = (emoji: string) => {
    const input =
      typeof window !== 'undefined' && window.innerWidth < 768
        ? mobileMessageInputRef.current || desktopMessageInputRef.current
        : desktopMessageInputRef.current || mobileMessageInputRef.current;
    const selectionStart = input?.selectionStart ?? message.length;
    const selectionEnd = input?.selectionEnd ?? message.length;

    const nextMessage = `${message.slice(0, selectionStart)}${emoji}${message.slice(selectionEnd)}`;
    setMessage(nextMessage);

    requestAnimationFrame(() => {
      const cursorPosition = selectionStart + emoji.length;
      input?.focus();
      input?.setSelectionRange(cursorPosition, cursorPosition);
    });
  };

  const handleOpenAttachmentPicker = () => {
    setIsMobileUtilityTrayOpen(false);
    attachmentInputRef.current?.click();
  };

  const handleOpenMediaPicker = () => {
    setIsMobileUtilityTrayOpen(false);
    mediaInputRef.current?.click();
  };

  const applyRewrite = (value: string) => {
    setMessage(value);
    requestAnimationFrame(() => {
      const input =
        typeof window !== 'undefined' && window.innerWidth < 768
          ? mobileMessageInputRef.current || desktopMessageInputRef.current
          : desktopMessageInputRef.current || mobileMessageInputRef.current;
      input?.focus();
      input?.setSelectionRange(value.length, value.length);
    });
  };

  const reloadConversationState = async () => {
    await loadMessages(conversationId);
    await loadConversations();
  };

  const handleFileSend = async (file: File) => {
    if (isBlocked) {
      return;
    }

    const messageType = inferMessageTypeFromFile(file);
    const trimmedCaption = message.trim() || undefined;
    const messageContent =
      trimmedCaption || (messageType === 'document' ? file.name : undefined);

    try {
      setIsUploadingAttachment(true);

      const uploadResponse = await uploadMedia(conversationId, file);
      const uploadEntry = uploadResponse.data?.[0];

      if (!uploadResponse.success || !uploadEntry?.uploadToken) {
        throw new Error(uploadResponse.message || 'Unable to upload the selected file');
      }

      const sendResponse = await sendConversationMessage(conversationId, {
        messageType,
        messageContent,
        mediaCaption: messageType === 'audio' ? undefined : trimmedCaption,
        mediaUploadToken: uploadEntry.uploadToken,
      });

      if (!sendResponse.success) {
        throw new Error(sendResponse.message || 'Unable to send the selected file');
      }

      setMessage('');
      await reloadConversationState();
    } catch (error) {
      toast({
        title: 'Attachment failed',
        description: error instanceof Error ? error.message : 'Unable to send the selected file',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    void handleFileSend(file);
  };

  useEffect(() => {
    setMessage('');
    setIsMobileUtilityTrayOpen(false);
  }, [conversationId]);
  
  return (
    <div className="border-t border-border/80 bg-sidebar px-2 py-2 md:px-3 md:py-3">
      {isBlocked ? (
        <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          This contact is blocked. Unblock the contact to send messages.
        </div>
      ) : null}
      {!isBlocked && !isServiceWindowOpen ? (
        <div className="flex flex-col gap-3 rounded-md border border-border/70 bg-card/70 px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="font-medium text-foreground">Service window is inactive for this chat.</span>
            {serviceWindowExpiresAt ? (
              <>
                {' '}It expired on {formatDateInIst(serviceWindowExpiresAt)} at {formatTimeInIst(serviceWindowExpiresAt)} IST.
              </>
            ) : (
              <> Wait for a new inbound message to reopen the 24-hour window.</>
            )}
            {' '}Use an approved template message to continue this conversation.
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setIsTemplateDialogOpen(true)}
          >
            Send template
          </Button>
        </div>
      ) : null}
      {isUploadingAttachment ? (
        <div className="mb-2 rounded-md border border-border/70 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
          Uploading attachment...
        </div>
      ) : null}
      {isBlocked || !isServiceWindowOpen ? null : (
        <>
          <div className="relative md:hidden">
            {isMobileUtilityTrayOpen ? (
              <div className="absolute bottom-full left-1 z-20 mb-1 flex flex-col items-start gap-1">
                <EmojiPicker
                  disabled={isBlocked || isUploadingAttachment}
                  onSelectEmoji={insertEmoji}
                  triggerClassName="h-10 w-10 rounded-full bg-transparent p-0 hover:bg-transparent"
                  iconClassName="h-5 w-5 text-foreground/75 dark:text-white"
                  contentClassName="mr-2"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 flex-shrink-0 rounded-full bg-transparent p-0 hover:bg-transparent"
                  disabled={isBlocked || isUploadingAttachment}
                  onClick={handleOpenMediaPicker}
                >
                  <ImageIcon className="h-5 w-5 text-foreground/75 dark:text-white" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 flex-shrink-0 rounded-full bg-transparent p-0 hover:bg-transparent"
                  disabled={isBlocked || isUploadingAttachment}
                  onClick={handleOpenAttachmentPicker}
                >
                  <FileText className="h-5 w-5 text-foreground/75 dark:text-white" />
                </Button>
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <div className="flex w-10 flex-shrink-0 justify-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-full bg-transparent p-0 hover:bg-transparent"
                  disabled={isBlocked || isUploadingAttachment}
                  onClick={() => setIsMobileUtilityTrayOpen((current) => !current)}
                >
                  <Plus className="h-6 w-6 text-foreground/85 dark:text-white" />
                </Button>
              </div>
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={mobileMessageInputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isBlocked ? 'Contact is blocked' : 'Type a message'}
                  disabled={isBlocked || isUploadingAttachment}
                  className="h-10 rounded-full border-border/70 bg-input px-3 pr-11 shadow-none"
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <MessageRewritePopover
                    text={message}
                    conversationId={conversationId}
                    disabled={isBlocked || isUploadingAttachment}
                    onApply={applyRewrite}
                    buttonClassName="h-8 w-8"
                    iconClassName="h-4 w-4"
                    contentClassName="max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto"
                  />
                </div>
              </div>
              <div className="flex w-10 flex-shrink-0 justify-end">
                {!isBlocked && !isUploadingAttachment && message.trim() ? (
                  <Button
                    size="icon"
                    className="h-10 w-10 flex-shrink-0"
                    onClick={handleSend}
                  >
                    <Send className="h-5 w-5" />
                  </Button>
                ) : (
                  <VoiceMessageButton
                    conversationId={conversationId}
                    disabled={isBlocked || isUploadingAttachment}
                    onSent={reloadConversationState}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="hidden items-end gap-2 md:flex">
            <TooltipProvider>
              <EmojiPicker
                disabled={isBlocked || isUploadingAttachment}
                onSelectEmoji={insertEmoji}
              />
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 flex-shrink-0"
                    disabled={isBlocked || isUploadingAttachment}
                    onClick={handleOpenAttachmentPicker}
                  >
                    <Paperclip className="h-5 w-5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <div className="relative flex-1">
              <Input
                ref={desktopMessageInputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isBlocked ? 'Contact is blocked' : 'Type a message'}
                disabled={isBlocked || isUploadingAttachment}
                className="rounded-full border-border/70 bg-input pr-18 shadow-none"
              />
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
                <MessageRewritePopover
                  text={message}
                  conversationId={conversationId}
                  disabled={isBlocked || isUploadingAttachment}
                  onApply={applyRewrite}
                  contentClassName="max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={isBlocked || isUploadingAttachment}
                  onClick={handleOpenMediaPicker}
                >
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
            
            {!isBlocked && !isUploadingAttachment && message.trim() ? (
              <Button
                size="icon"
                className="h-9 w-9 flex-shrink-0"
                onClick={handleSend}
              >
                <Send className="h-5 w-5" />
              </Button>
            ) : (
              <VoiceMessageButton
                conversationId={conversationId}
                disabled={isBlocked || isUploadingAttachment}
                onSent={reloadConversationState}
              />
            )}
          </div>
        </>
      )}

      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        accept={ATTACHMENT_FILE_ACCEPT}
        onChange={handleAttachmentChange}
      />

      <input
        ref={mediaInputRef}
        type="file"
        className="hidden"
        accept={MEDIA_FILE_ACCEPT}
        onChange={handleAttachmentChange}
      />

      <TemplatePickerDialog
        open={isTemplateDialogOpen}
        onOpenChange={setIsTemplateDialogOpen}
        conversationId={conversationId}
        onSent={reloadConversationState}
      />
    </div>
  );
}
