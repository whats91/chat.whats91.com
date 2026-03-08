'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchConversationTargets } from '@/lib/api/client';
import type { ConversationTarget } from '@/lib/types/chat';
import { Search } from 'lucide-react';

interface ConversationTargetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSelect: (target: ConversationTarget) => Promise<void> | void;
}

function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, '');
}

function formatPhoneDisplay(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function ConversationTargetPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  onSelect,
}: ConversationTargetPickerDialogProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [targets, setTargets] = useState<ConversationTarget[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setTargets([]);
      setError(null);
      setPendingTargetId(null);
      return;
    }

    let cancelled = false;

    const loadTargets = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetchConversationTargets({
          search: deferredSearch.trim() || undefined,
          limit: 60,
        });

        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setTargets([]);
          setError(response.message || 'Unable to load contacts');
          return;
        }

        setTargets(response.data.targets);
      } catch (loadError) {
        if (!cancelled) {
          setTargets([]);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load contacts');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTargets();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, open]);

  const selectableTargets = useMemo(() => {
    const normalizedSearchPhone = normalizePhoneInput(search);
    const hasExistingPhone = targets.some(
      (target) => normalizePhoneInput(target.phone) === normalizedSearchPhone
    );

    const manualTarget =
      normalizedSearchPhone.length >= 6 && !hasExistingPhone
        ? {
            id: `manual:${normalizedSearchPhone}`,
            source: 'contact' as const,
            conversationId: null,
            phone: normalizedSearchPhone,
            displayName: formatPhoneDisplay(normalizedSearchPhone),
            contactName: null,
            lastMessageAt: null,
          }
        : null;

    return manualTarget ? [manualTarget, ...targets] : targets;
  }, [search, targets]);

  const handleSelect = async (target: ConversationTarget) => {
    try {
      setPendingTargetId(target.id);
      setError(null);
      await onSelect(target);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : 'Unable to open contact');
    } finally {
      setPendingTargetId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or number"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <ScrollArea className="mt-4 h-80">
          <div className="space-y-1">
            {selectableTargets.map((target) => {
              const displayName = target.displayName || formatPhoneDisplay(target.phone);

              return (
                <button
                  key={target.id}
                  type="button"
                  disabled={pendingTargetId !== null}
                  className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-wait disabled:opacity-70"
                  onClick={() => {
                    void handleSelect(target);
                  }}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={undefined} alt={displayName} />
                    <AvatarFallback className="bg-primary/20 text-primary font-medium">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{displayName}</p>
                      <Badge variant="secondary" className="shrink-0">
                        {target.conversationId ? 'Recent' : 'Contact'}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {formatPhoneDisplay(target.phone)}
                    </p>
                  </div>
                </button>
              );
            })}

            {isLoading && selectableTargets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading contacts...
              </div>
            ) : null}

            {!isLoading && selectableTargets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No contacts found
              </div>
            ) : null}

            {error ? (
              <div className="px-2 py-3 text-center text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
