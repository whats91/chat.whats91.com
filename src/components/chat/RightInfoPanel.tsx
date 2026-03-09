'use client';

import { useEffect, useState } from 'react';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { ConversationMediaDialog } from '@/components/chat/ConversationMediaDialog';
import { StarredMessagesDialog } from '@/components/chat/StarredMessagesDialog';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import {
  Star,
  Bell,
  BellOff,
  Ban,
  Trash2,
  Eraser,
  Search,
  ChevronDown,
  Tag,
  Image as ImageIcon,
  PencilLine,
} from 'lucide-react';
import type { Conversation } from '@/lib/types/chat';

interface RightInfoPanelProps {
  conversationId: string;
}

export function RightInfoPanel({ conversationId }: RightInfoPanelProps) {
  const { conversations, labels, muteConversation, blockConversation, updateConversationName } = useChatStore();
  const conversation = conversations.find(c => c.id === conversationId);
  const [dangerAction, setDangerAction] = useState<'clear' | 'delete' | null>(null);
  const [isStarredDialogOpen, setIsStarredDialogOpen] = useState(false);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);
  const [isUpdatingBlock, setIsUpdatingBlock] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    if (conversation && !isEditingName) {
      setNameDraft(conversation.contactName || '');
    }
  }, [conversation, isEditingName]);

  if (!conversation) {
    return null;
  }
  
  const { participant } = conversation;
  const conversationLabels = (conversation as Conversation & { labels?: string[] }).labels || [];
  const participantName = participant?.name || conversation.contactName || conversation.contactPhone;
  const participantPhone = participant?.phone || conversation.contactPhone;
  const participantAvatar = participant?.avatar;
  const participantEmail = participant?.email;
  
  const initials = participantName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleSaveName = async () => {
    const trimmedName = nameDraft.trim();

    if (!trimmedName) {
      toast({
        title: 'Conversation name is required',
        description: 'Enter a name before saving.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSavingName(true);
      await updateConversationName(conversation.id, trimmedName);
      setIsEditingName(false);
      toast({
        title: 'Conversation updated',
        description: 'The conversation name was saved successfully.',
      });
    } catch (error) {
      toast({
        title: 'Unable to update conversation name',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingName(false);
    }
  };
  
  return (
    <div className="flex h-full min-h-0 w-80 flex-col overflow-hidden border-l border-border/80 bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        {/* Header */}
        <div className="p-6 text-center">
          <Avatar className="h-24 w-24 mx-auto mb-4">
            <AvatarImage src={participantAvatar} alt={participantName} />
            <AvatarFallback className="bg-primary/20 text-primary text-2xl font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <h2 className="text-lg font-semibold">{participantName}</h2>
          <p className="text-sm text-muted-foreground">{participantPhone}</p>
          {participantEmail && (
            <p className="text-sm text-muted-foreground">{participantEmail}</p>
          )}
          {isEditingName ? (
            <form
              className="mt-4 rounded-2xl border border-border/70 bg-accent/60 p-3 text-left dark:bg-accent/40"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveName();
              }}
            >
              <label className="mb-2 block text-xs font-medium text-muted-foreground">
                Conversation name
              </label>
              <Input
                autoFocus
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder={participantPhone}
                className="border-border/80 bg-background/85 text-foreground dark:text-white"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNameDraft(conversation.contactName || '');
                    setIsEditingName(false);
                  }}
                  disabled={isSavingName}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSavingName}>
                  {isSavingName ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
        
        {/* Quick Actions */}
        <div className="flex justify-center gap-10 px-6 pb-6">
          <ActionButton
            icon={PencilLine}
            label={isEditingName ? 'Close edit' : 'Edit'}
            onClick={() => setIsEditingName((current) => !current)}
          />
          <ActionButton icon={Search} label="Search" />
        </div>
        
        <Separator />
        
        {/* About */}
        <div className="p-4">
          <h3 className="text-sm font-medium mb-2">About</h3>
          <p className="text-sm text-muted-foreground">
            Hey there! I'm using WhatsApp
          </p>
        </div>
        
        <Separator />
        
        {/* Labels */}
        {conversationLabels.length > 0 && (
          <>
            <div className="p-4">
              <h3 className="text-sm font-medium mb-2">Labels</h3>
              <div className="flex flex-wrap gap-2">
                {conversationLabels.map((labelId, index) => {
                  const label = labels.find(l => l.id === labelId || l.name === labelId);
                  return label ? (
                    <Badge key={label.id || index} variant="outline" className="gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                    </Badge>
                  ) : null;
                })}
              </div>
            </div>
            <Separator />
          </>
        )}
        
        {/* Media & Links */}
        <div className="p-4">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setIsMediaDialogOpen(true)}
          >
            <div className="flex items-center gap-3">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Media, links, and docs</p>
                <p className="text-xs text-muted-foreground">View conversation media and links</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        
        <Separator />
        
        {/* Starred Messages */}
        <button
          className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/80"
          onClick={() => setIsStarredDialogOpen(true)}
        >
          <Star className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm">Starred messages</span>
        </button>
        
        <Separator />
        
        {/* Mute / Notifications */}
        <button
          className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/80"
          onClick={() => {
            void muteConversation(conversation.id);
          }}
        >
          {conversation.isMuted ? (
            <BellOff className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Bell className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="text-sm">
            {conversation.isMuted ? 'Unmute notifications' : 'Mute notifications'}
          </span>
        </button>
        
        <Separator />
        
        {/* Quick Links */}
        <div className="p-4 space-y-3">
          <QuickLink icon={Tag} label="Labels" />
        </div>
        
        <Separator />
        
        {/* Danger Zone */}
        <div className="p-4 space-y-3">
          <button
            className="mx-[-0.5rem] flex w-full items-center gap-3 rounded-lg p-2 text-left text-destructive hover:bg-destructive/10 disabled:cursor-wait disabled:opacity-70"
            disabled={isUpdatingBlock}
            onClick={() => {
              setIsUpdatingBlock(true);
              void blockConversation(conversation.id).finally(() => setIsUpdatingBlock(false));
            }}
          >
            <Ban className="h-5 w-5" />
            <span className="text-sm">
              {isUpdatingBlock
                ? conversation.isBlocked
                  ? 'Unblocking contact...'
                  : 'Blocking contact...'
                : conversation.isBlocked
                  ? 'Unblock contact'
                  : 'Block contact'}
            </span>
          </button>
          <button
            className="mx-[-0.5rem] flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent/80"
            onClick={() => setDangerAction('clear')}
          >
            <Eraser className="h-5 w-5" />
            <span className="text-sm">Clear chat</span>
          </button>
          <button
            className="mx-[-0.5rem] flex w-full items-center gap-3 rounded-lg p-2 text-left text-destructive hover:bg-destructive/10"
            onClick={() => setDangerAction('delete')}
          >
            <Trash2 className="h-5 w-5" />
            <span className="text-sm">Delete conversation</span>
          </button>
        </div>
      </ScrollArea>

      <ConversationDangerDialog
        open={dangerAction !== null}
        action={dangerAction}
        conversationId={conversation.id}
        conversationName={participantName}
        onOpenChange={(open) => {
          if (!open) {
            setDangerAction(null);
          }
        }}
      />

      <StarredMessagesDialog
        open={isStarredDialogOpen}
        onOpenChange={setIsStarredDialogOpen}
        conversationId={conversation.id}
        conversationName={participantName}
      />

      <ConversationMediaDialog
        open={isMediaDialogOpen}
        onOpenChange={setIsMediaDialogOpen}
        conversationId={conversation.id}
        conversationName={participantName}
      />
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
}

function ActionButton({ icon: Icon, label, onClick }: ActionButtonProps) {
  return (
    <button
      className="flex flex-col items-center gap-1 text-primary"
      onClick={onClick}
      type="button"
    >
      <div className="rounded-full bg-primary/10 p-3 transition-colors hover:bg-primary/20">
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-xs">{label}</span>
    </button>
  );
}

interface QuickLinkProps {
  icon: React.ElementType;
  label: string;
  count?: number;
}

function QuickLink({ icon: Icon, label, count }: QuickLinkProps) {
  return (
    <button className="mx-[-0.5rem] flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-accent/80">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      {count !== undefined && (
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      )}
    </button>
  );
}
