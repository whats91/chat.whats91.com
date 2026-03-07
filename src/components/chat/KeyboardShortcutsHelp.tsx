'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Keyboard, Settings } from 'lucide-react';
import { SHORTCUTS, formatShortcut } from '@/hooks/use-keyboard-shortcuts';
import { Separator } from '@/components/ui/separator';

export function KeyboardShortcutsHelp() {
  const shortcutGroups = [
    {
      title: 'Navigation',
      shortcuts: [
        { key: 'newChat', ...SHORTCUTS.newChat },
        { key: 'searchChat', ...SHORTCUTS.searchChat },
        { key: 'nextChat', ...SHORTCUTS.nextChat },
        { key: 'prevChat', ...SHORTCUTS.prevChat },
      ],
    },
    {
      title: 'Chat Actions',
      shortcuts: [
        { key: 'archiveChat', ...SHORTCUTS.archiveChat },
        { key: 'pinChat', ...SHORTCUTS.pinChat },
        { key: 'muteChat', ...SHORTCUTS.muteChat },
        { key: 'deleteChat', ...SHORTCUTS.deleteChat },
      ],
    },
    {
      title: 'General',
      shortcuts: [
        { key: 'focusComposer', ...SHORTCUTS.focusComposer },
        { key: 'closePanel', ...SHORTCUTS.closePanel },
      ],
    },
  ];
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Keyboard className="h-4 w-4" />
          Keyboard shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {shortcutGroups.map((group, index) => (
            <div key={group.title}>
              {index > 0 && <Separator className="mb-4" />}
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.key}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                      {formatShortcut(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
