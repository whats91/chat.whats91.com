'use client';

import { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatLabel } from '@/lib/types/chat';
import type { TeamMember } from '@/lib/types/team-member';
import { Loader2, Tag } from 'lucide-react';

interface TeamMemberLabelAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMember: TeamMember | null;
  availableLabels: ChatLabel[];
  isLoadingLabels: boolean;
  isSaving: boolean;
  onSave: (labelIds: string[]) => Promise<void>;
}

export function TeamMemberLabelAccessDialog({
  open,
  onOpenChange,
  teamMember,
  availableLabels,
  isLoadingLabels,
  isSaving,
  onSave,
}: TeamMemberLabelAccessDialogProps) {
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !teamMember) {
      setSelectedLabelIds([]);
      return;
    }

    setSelectedLabelIds(teamMember.assignedLabels.map((label) => label.id));
  }, [open, teamMember]);

  const selectedLabelNames = useMemo(
    () =>
      availableLabels
        .filter((label) => selectedLabelIds.includes(label.id))
        .map((label) => label.name),
    [availableLabels, selectedLabelIds]
  );

  const toggleLabel = (labelId: string) => {
    setSelectedLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((currentLabelId) => currentLabelId !== labelId)
        : [...current, labelId]
    );
  };

  const handleSave = async () => {
    await onSave(selectedLabelIds);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Assign labels to team member</DialogTitle>
          <DialogDescription>
            {teamMember
              ? `Choose which labels ${teamMember.name} can work on.`
              : 'Choose which labels this team member can work on.'}
          </DialogDescription>
          {selectedLabelNames.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Selected: {selectedLabelNames.join(', ')}
            </p>
          ) : null}
        </DialogHeader>

        <div className="border-y border-border/70">
          <ScrollArea className="max-h-[48vh] px-3 py-3">
            {isLoadingLabels ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading labels...
              </div>
            ) : availableLabels.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
                <Tag className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No labels available</p>
                  <p className="text-xs text-muted-foreground">
                    Create chat labels first, then assign them to team members here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {availableLabels.map((label) => {
                  const isSelected = selectedLabelIds.includes(label.id);

                  return (
                    <button
                      key={label.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-3 text-left transition-colors hover:bg-accent/70"
                      onClick={() => toggleLabel(label.id)}
                    >
                      <Checkbox checked={isSelected} className="pointer-events-none" />
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{label.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {label.phoneNumber}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || isLoadingLabels}>
            {isSaving ? 'Saving...' : 'Save label access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
