'use client';

import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CarFront,
  Flag,
  Heart,
  Leaf,
  Lightbulb,
  Smile,
  Trophy,
  UtensilsCrossed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface EmojiCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys & People',
    icon: Smile,
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😊', '😍', '😘', '😎', '🤩', '🥳', '🤔', '🤗', '🤭', '🤝', '👏', '🙌', '👍', '👋', '🙏', '💪', '🫶'],
  },
  {
    id: 'nature',
    label: 'Animals & Nature',
    icon: Leaf,
    emojis: ['🐶', '🐱', '🐭', '🐰', '🦊', '🐼', '🐨', '🦁', '🐯', '🐮', '🐸', '🐵', '🐦', '🦋', '🐢', '🌳', '🌴', '🌵', '🌸', '🌹', '🌻', '🌈', '☀️', '🌙'],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icon: UtensilsCrossed,
    emojis: ['🍎', '🍉', '🍌', '🍇', '🍓', '🥭', '🍍', '🥥', '🥑', '🍕', '🍔', '🌭', '🍟', '🌮', '🍣', '🥗', '🍜', '🍪', '🍩', '🍫', '☕', '🍵', '🥤', '🍹'],
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: Trophy,
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎯', '🎳', '🏏', '🏓', '🎮', '🧩', '🎹', '🎸', '🥁', '🎤', '🎧', '🎬', '📚', '🎨', '🧘', '🏋️', '🚴', '🏆'],
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    icon: CarFront,
    emojis: ['🚗', '🚕', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚜', '✈️', '🚁', '🚂', '🚢', '⛽', '🗺️', '🏖️', '🏝️', '🏔️', '🏙️', '🌋', '🗽', '🕌', '🏠', '🏢'],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: Lightbulb,
    emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '🎥', '📺', '📻', '💡', '🔦', '📚', '✏️', '🖊️', '📎', '✂️', '🔒', '🔑', '🧸', '🎁', '🛒', '💰', '📦'],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: Heart,
    emojis: ['❤️', '🩷', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💯', '💢', '💥', '💫', '💦', '💤', '✨', '🔥', '⭐', '❗', '❓', '✅', '❌', '➕'],
  },
  {
    id: 'flags',
    label: 'Flags',
    icon: Flag,
    emojis: ['🏳️', '🏴', '🏁', '🚩', '🇮🇳', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇯🇵', '🇸🇬', '🇦🇪'],
  },
];

interface EmojiPickerProps {
  disabled?: boolean;
  onSelectEmoji: (emoji: string) => void;
  triggerClassName?: string;
  iconClassName?: string;
  contentClassName?: string;
}

export function EmojiPicker({
  disabled = false,
  onSelectEmoji,
  triggerClassName,
  iconClassName,
  contentClassName,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0].id);

  const activeCategory = useMemo(
    () => EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) || EMOJI_CATEGORIES[0],
    [activeCategoryId]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-9 w-9 flex-shrink-0', triggerClassName)}
          disabled={disabled}
        >
          <Smile className={cn('h-5 w-5 text-muted-foreground', iconClassName)} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        className={cn(
          'w-[min(23rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0',
          contentClassName
        )}
      >
        <div className="border-b px-4 py-3">
          <div className="text-sm font-medium">Emoji</div>
          <div className="text-xs text-muted-foreground">{activeCategory.label}</div>
        </div>

        <ScrollArea className="h-[min(18rem,55vh)] px-3 py-3 sm:h-72">
          <div className="grid grid-cols-7 gap-1 sm:grid-cols-8">
            {activeCategory.emojis.map((emoji) => (
              <button
                key={`${activeCategory.id}-${emoji}`}
                type="button"
                className="flex h-10 w-full items-center justify-center rounded-md text-2xl transition-colors hover:bg-muted"
                onClick={() => {
                  onSelectEmoji(emoji);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true">{emoji}</span>
                <span className="sr-only">{emoji}</span>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="grid grid-cols-7 border-t bg-muted/30 p-1 sm:grid-cols-8">
          {EMOJI_CATEGORIES.map((category) => {
            const Icon = category.icon;

            return (
              <button
                key={category.id}
                type="button"
                className={cn(
                  'flex h-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  category.id === activeCategoryId && 'bg-background text-primary shadow-sm'
                )}
                onClick={() => setActiveCategoryId(category.id)}
                title={category.label}
                aria-label={category.label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
