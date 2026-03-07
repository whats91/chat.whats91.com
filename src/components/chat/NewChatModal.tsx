'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { mockUsers } from '@/lib/mock/data';

interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewChatModal({ open, onOpenChange }: NewChatModalProps) {
  const [search, setSearch] = useState('');
  const { selectConversation, conversations } = useChatStore();
  
  const filteredUsers = search
    ? mockUsers.filter(user =>
        user.name.toLowerCase().includes(search.toLowerCase()) ||
        user.phone.includes(search)
      )
    : mockUsers;
  
  const handleSelectUser = (userId: string) => {
    // Find or create conversation with this user
    const existingConversation = conversations.find(
      c => c.participant.id === userId
    );
    
    if (existingConversation) {
      selectConversation(existingConversation.id);
    } else {
      // In a real app, this would create a new conversation
      // For now, just close the modal
      console.log('Would create new conversation with:', userId);
    }
    
    onOpenChange(false);
    setSearch('');
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
        </DialogHeader>
        
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        
        <ScrollArea className="h-80 mt-4">
          <div className="space-y-1">
            {filteredUsers.map((user) => {
              const initials = user.name
                .split(' ')
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);
              
              return (
                <button
                  key={user.id}
                  className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  onClick={() => handleSelectUser(user.id)}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="bg-primary/20 text-primary font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-muted-foreground">{user.phone}</p>
                  </div>
                </button>
              );
            })}
            
            {filteredUsers.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No contacts found</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
