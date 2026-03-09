'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { ConversationLabelsDialog } from '@/components/chat/ConversationLabelsDialog';
import { ConversationMediaDialog } from '@/components/chat/ConversationMediaDialog';
import { StarredMessagesDialog } from '@/components/chat/StarredMessagesDialog';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { formatChatPhoneNumber } from '@/lib/phone/format';
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
  Upload,
} from 'lucide-react';

interface RightInfoPanelProps {
  conversationId: string;
}

export function RightInfoPanel({ conversationId }: RightInfoPanelProps) {
  const {
    conversations,
    muteConversation,
    blockConversation,
    updateConversationName,
    updateConversationNotes,
    updateConversationProfileImage,
  } = useChatStore();
  const conversation = conversations.find(c => c.id === conversationId);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);
  const [dangerAction, setDangerAction] = useState<'clear' | 'delete' | null>(null);
  const [isStarredDialogOpen, setIsStarredDialogOpen] = useState(false);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);
  const [isLabelsDialogOpen, setIsLabelsDialogOpen] = useState(false);
  const [isUpdatingBlock, setIsUpdatingBlock] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [isNotesDirty, setIsNotesDirty] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isUploadingProfileImage, setIsUploadingProfileImage] = useState(false);

  useEffect(() => {
    if (conversation && !isEditingName) {
      setNameDraft(conversation.contactName || '');
    }
  }, [conversation, isEditingName]);

  useEffect(() => {
    if (conversation) {
      setNotesDraft(conversation.conversationNotes || '');
      setIsNotesDirty(false);
    }
  }, [conversation?.id]);

  useEffect(() => {
    if (conversation && !isNotesDirty) {
      setNotesDraft(conversation.conversationNotes || '');
    }
  }, [conversation?.conversationNotes, isNotesDirty]);

  if (!conversation) {
    return null;
  }
  
  const { participant } = conversation;
  const conversationLabels = conversation.labels || [];
  const participantPhone = formatChatPhoneNumber(participant?.phone || conversation.contactPhone);
  const rawParticipantName = conversation.contactName?.trim() || participant?.name?.trim() || '';
  const participantName = rawParticipantName && !/^\+?\d+$/.test(rawParticipantName)
    ? rawParticipantName
    : participantPhone;
  const participantAvatar = conversation.profileImageUrl || participant?.avatar;
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

  const handleSaveNotes = async () => {
    try {
      setIsSavingNotes(true);
      await updateConversationNotes(conversation.id, notesDraft);
      setIsNotesDirty(false);
      toast({
        title: 'Conversation notes updated',
        description: notesDraft.trim()
          ? 'Your note has been saved for this conversation.'
          : 'The conversation note has been cleared.',
      });
    } catch (error) {
      toast({
        title: 'Unable to update conversation notes',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleProfileImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Unsupported file',
        description: 'Please choose an image file for the profile photo.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsUploadingProfileImage(true);
      await updateConversationProfileImage(conversation.id, file);
      toast({
        title: 'Profile photo updated',
        description: 'The conversation profile image was uploaded successfully.',
      });
    } catch (error) {
      toast({
        title: 'Unable to update profile photo',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingProfileImage(false);
    }
  };
  
  return (
    <div className="flex h-full min-h-0 w-80 flex-col overflow-hidden border-l border-border/80 bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        {/* Header */}
        <div className="p-6 text-center">
          <input
            ref={profileImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleProfileImageSelection}
          />
          <button
            type="button"
            className="group mx-auto mb-4 block"
            onClick={() => profileImageInputRef.current?.click()}
            disabled={isUploadingProfileImage}
          >
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={participantAvatar || undefined} alt={participantName} />
                <AvatarFallback className="bg-primary/20 text-primary text-2xl font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-end justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/35">
                <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-background/70 dark:text-white">
                  {isUploadingProfileImage ? (
                    'Uploading...'
                  ) : (
                    <>
                      <Upload className="h-3 w-3" />
                      Upload
                    </>
                  )}
                </span>
              </div>
            </div>
          </button>
          <h2 className="text-lg font-semibold">{participantName}</h2>
          <p className="text-sm text-muted-foreground">{participantPhone}</p>
          {participantEmail && (
            <p className="text-sm text-muted-foreground">{participantEmail}</p>
          )}
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground dark:hover:text-white"
            onClick={() => profileImageInputRef.current?.click()}
            disabled={isUploadingProfileImage}
          >
            {isUploadingProfileImage ? 'Uploading profile photo...' : 'Click profile photo to upload'}
          </button>
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

        {/* Notes */}
        <div className="p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Notes</h3>
            <span className="text-xs text-muted-foreground">
              {notesDraft.trim().length} chars
            </span>
          </div>
          <Textarea
            value={notesDraft}
            onChange={(event) => {
              setNotesDraft(event.target.value);
              setIsNotesDirty(true);
            }}
            placeholder="Add notes for this conversation..."
            className="min-h-32 resize-none border-border/80 bg-background/85 text-foreground dark:text-white"
            maxLength={5000}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Saved notes stay attached to this conversation.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSaveNotes()}
              disabled={isSavingNotes || (!isNotesDirty && notesDraft === (conversation.conversationNotes || ''))}
            >
              {isSavingNotes ? 'Saving...' : 'Save note'}
            </Button>
          </div>
        </div>
        
        <Separator />
        
        {/* Labels */}
        {conversationLabels.length > 0 && (
          <>
            <div className="p-4">
              <h3 className="text-sm font-medium mb-2">Labels</h3>
              <div className="flex flex-wrap gap-2">
                {conversationLabels.map((label) => {
                  return (
                    <Badge key={label.id} variant="outline" className="gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                    </Badge>
                  );
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
          <QuickLink
            icon={Tag}
            label="Labels"
            count={conversationLabels.length}
            onClick={() => setIsLabelsDialogOpen(true)}
          />
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

      <ConversationLabelsDialog
        open={isLabelsDialogOpen}
        onOpenChange={setIsLabelsDialogOpen}
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
  onClick?: () => void;
}

function QuickLink({ icon: Icon, label, count, onClick }: QuickLinkProps) {
  return (
    <button
      className="mx-[-0.5rem] flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-accent/80"
      onClick={onClick}
      type="button"
    >
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
