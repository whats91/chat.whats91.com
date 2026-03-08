'use client';

import { useState } from 'react';
import { ConversationDangerDialog } from '@/components/chat/ConversationDangerDialog';
import { StarredMessagesDialog } from '@/components/chat/StarredMessagesDialog';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Phone,
  Video,
  Star,
  Bell,
  BellOff,
  Pin,
  Archive,
  Ban,
  Trash2,
  Eraser,
  Flag,
  Search,
  ChevronDown,
  User,
  Users,
  Tag,
  FileText,
  Image as ImageIcon,
  Link2,
} from 'lucide-react';
import type { Conversation } from '@/lib/types/chat';

interface RightInfoPanelProps {
  conversationId: string;
  onClose?: () => void;
}

export function RightInfoPanel({ conversationId, onClose }: RightInfoPanelProps) {
  const { conversations, labels, muteConversation, toggleRightPanel } = useChatStore();
  const conversation = conversations.find(c => c.id === conversationId);
  const [dangerAction, setDangerAction] = useState<'clear' | 'delete' | null>(null);
  const [isStarredDialogOpen, setIsStarredDialogOpen] = useState(false);
  
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
  
  return (
    <div className="w-80 border-l bg-background flex flex-col h-full">
      <ScrollArea className="flex-1">
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
        </div>
        
        {/* Quick Actions */}
        <div className="flex justify-center gap-8 px-6 pb-6">
          <ActionButton icon={Video} label="Video" />
          <ActionButton icon={Phone} label="Call" />
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
          <button className="flex items-center justify-between w-full text-left">
            <div className="flex items-center gap-3">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Media, links, and docs</p>
                <p className="text-xs text-muted-foreground">128 items</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        
        <Separator />
        
        {/* Starred Messages */}
        <button
          className="flex items-center gap-3 p-4 w-full text-left hover:bg-muted/50"
          onClick={() => setIsStarredDialogOpen(true)}
        >
          <Star className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm">Starred messages</span>
        </button>
        
        <Separator />
        
        {/* Mute / Notifications */}
        <button
          className="flex items-center gap-3 p-4 w-full text-left hover:bg-muted/50"
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
          <QuickLink icon={Users} label="Groups in common" count={2} />
          <QuickLink icon={Tag} label="Labels" />
        </div>
        
        <Separator />
        
        {/* Danger Zone */}
        <div className="p-4 space-y-3">
          <button className="flex items-center gap-3 w-full text-left text-destructive hover:bg-destructive/10 rounded-lg p-2 -mx-2">
            <Ban className="h-5 w-5" />
            <span className="text-sm">Block contact</span>
          </button>
          <button className="flex items-center gap-3 w-full text-left text-destructive hover:bg-destructive/10 rounded-lg p-2 -mx-2">
            <Flag className="h-5 w-5" />
            <span className="text-sm">Report contact</span>
          </button>
          <button
            className="flex items-center gap-3 w-full text-left hover:bg-muted/50 rounded-lg p-2 -mx-2"
            onClick={() => setDangerAction('clear')}
          >
            <Eraser className="h-5 w-5" />
            <span className="text-sm">Clear chat</span>
          </button>
          <button
            className="flex items-center gap-3 w-full text-left text-destructive hover:bg-destructive/10 rounded-lg p-2 -mx-2"
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
    >
      <div className="p-3 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors">
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
    <button className="flex items-center justify-between w-full text-left hover:bg-muted/50 rounded-lg p-2 -mx-2">
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
