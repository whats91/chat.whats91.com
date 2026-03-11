'use client';

// Dependency note:
// Settings changes here must stay aligned with:
// - src/lib/notifications/preferences.ts
// - src/lib/notifications/service.ts
// - src/hooks/use-notifications.ts
// - src/lib/api/client.ts
// - src/lib/types/team-member.ts
// - src/app/api/team-members/**
// - prisma/schema.prisma

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  Bell,
  CheckCircle,
  Globe,
  Key,
  Loader2,
  Mail,
  Monitor,
  Moon,
  Phone,
  PencilLine,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useChatStore } from '@/stores/chatStore';
import { useNotifications } from '@/hooks/use-notifications';
import { fetchAuthSession } from '@/lib/api/auth-client';
import {
  createTeamMember as createTeamMemberRequest,
  deleteTeamMember as deleteTeamMemberRequest,
  fetchChatLabels,
  fetchTeamMembers,
  updateTeamMember as updateTeamMemberRequest,
  updateTeamMemberLabels as updateTeamMemberLabelsRequest,
} from '@/lib/api/client';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreferences,
} from '@/lib/notifications/preferences';
import { showPermissionGrantedNotification } from '@/lib/notifications/service';
import type { TeamMember } from '@/lib/types/team-member';
import type { ChatLabel } from '@/lib/types/chat';
import { toast } from '@/hooks/use-toast';
import { TeamMemberLabelAccessDialog } from '@/components/settings/TeamMemberLabelAccessDialog';

type ThemePreference = 'light' | 'dark' | 'system';

interface TeamMemberFormState {
  name: string;
  email: string;
  mobileNumber: string;
  password: string;
}

const EMPTY_TEAM_MEMBER_FORM: TeamMemberFormState = {
  name: '',
  email: '',
  mobileNumber: '',
  password: '',
};

function normalizeTeamMemberForm(form: TeamMemberFormState) {
  return {
    name: form.name.trim(),
    email: form.email.trim() || null,
    mobileNumber: form.mobileNumber.trim() || null,
    password: form.password.trim() || null,
  };
}

function formatTeamMemberDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function getInitials(name: string): string {
  const value = name.trim();
  if (!value) {
    return 'TM';
  }

  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function SettingsPage() {
  const router = useRouter();
  const { isSocketConnected } = useChatStore();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const {
    supported: notificationsSupported,
    isGranted,
    requestPermission,
  } = useNotifications();
  const [isThemeReady, setIsThemeReady] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [availableLabels, setAvailableLabels] = useState<ChatLabel[]>([]);
  const [isTeamMembersLoading, setIsTeamMembersLoading] = useState(true);
  const [isLabelsLoading, setIsLabelsLoading] = useState(true);
  const [isCreatingTeamMember, setIsCreatingTeamMember] = useState(false);
  const [editingTeamMemberId, setEditingTeamMemberId] = useState<string | null>(null);
  const [isUpdatingTeamMember, setIsUpdatingTeamMember] = useState(false);
  const [isUpdatingTeamMemberLabels, setIsUpdatingTeamMemberLabels] = useState(false);
  const [deletingTeamMemberId, setDeletingTeamMemberId] = useState<string | null>(null);
  const [labelAccessTeamMember, setLabelAccessTeamMember] = useState<TeamMember | null>(null);
  const [createForm, setCreateForm] = useState<TeamMemberFormState>(EMPTY_TEAM_MEMBER_FORM);
  const [editForm, setEditForm] = useState<TeamMemberFormState>(EMPTY_TEAM_MEMBER_FORM);

  const loadTeamMembers = useCallback(async () => {
    setIsTeamMembersLoading(true);

    try {
      const response = await fetchTeamMembers();
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Unable to load team members');
      }

      setTeamMembers(response.data.teamMembers);
    } catch (error) {
      toast({
        title: 'Unable to load team members',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsTeamMembersLoading(false);
    }
  }, []);

  const loadAvailableLabels = useCallback(async () => {
    setIsLabelsLoading(true);

    try {
      const response = await fetchChatLabels();
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Unable to load labels');
      }

      setAvailableLabels(response.data.labels || []);
    } catch (error) {
      toast({
        title: 'Unable to load labels',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLabelsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPreferences(getNotificationPreferences());
    setIsThemeReady(true);
    void (async () => {
      try {
        const session = await fetchAuthSession();
        if (session.user?.principalType === 'team_member') {
          router.replace('/');
          return;
        }

        await Promise.all([loadTeamMembers(), loadAvailableLabels()]);
      } catch {
        await Promise.all([loadTeamMembers(), loadAvailableLabels()]);
      }
    })();
  }, [loadAvailableLabels, loadTeamMembers, router]);

  const handlePreferenceChange = (
    key: keyof NotificationPreferences,
    value: boolean
  ) => {
    const nextPreferences = updateNotificationPreference(key, value);
    setPreferences(nextPreferences);
  };

  const handleEnableNotifications = async () => {
    const granted = await requestPermission();
    if (granted) {
      await showPermissionGrantedNotification();
    }
  };

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }

    router.push('/');
  };

  const handleCreateTeamMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setIsCreatingTeamMember(true);
      const response = await createTeamMemberRequest(normalizeTeamMemberForm(createForm));

      if (!response.success || !response.data?.teamMember) {
        throw new Error(response.message || 'Unable to add team member');
      }

      const createdTeamMember = response.data.teamMember;

      setTeamMembers((current) => [createdTeamMember, ...current]);
      setCreateForm(EMPTY_TEAM_MEMBER_FORM);
      toast({
        title: 'Team member added',
        description: `${createdTeamMember.name} is now part of this workspace.`,
      });
    } catch (error) {
      toast({
        title: 'Unable to add team member',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingTeamMember(false);
    }
  };

  const beginEditingTeamMember = (teamMember: TeamMember) => {
    setEditingTeamMemberId(teamMember.id);
    setEditForm({
      name: teamMember.name,
      email: teamMember.email || '',
      mobileNumber: teamMember.mobileNumber || '',
      password: '',
    });
  };

  const cancelEditingTeamMember = () => {
    setEditingTeamMemberId(null);
    setEditForm(EMPTY_TEAM_MEMBER_FORM);
  };

  const handleUpdateTeamMember = async (teamMemberId: string) => {
    try {
      setIsUpdatingTeamMember(true);
      const response = await updateTeamMemberRequest(
        teamMemberId,
        normalizeTeamMemberForm(editForm)
      );

      if (!response.success || !response.data?.teamMember) {
        throw new Error(response.message || 'Unable to update team member');
      }

      const updatedTeamMember = response.data.teamMember;

      setTeamMembers((current) =>
        current.map((teamMember) =>
          teamMember.id === teamMemberId ? updatedTeamMember : teamMember
        )
      );
      cancelEditingTeamMember();
      toast({
        title: 'Team member updated',
        description: `${updatedTeamMember.name} has been updated.`,
      });
    } catch (error) {
      toast({
        title: 'Unable to update team member',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingTeamMember(false);
    }
  };

  const handleDeleteTeamMember = async (teamMember: TeamMember) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete ${teamMember.name} from this workspace?`);
      if (!confirmed) {
        return;
      }
    }

    try {
      setDeletingTeamMemberId(teamMember.id);
      const response = await deleteTeamMemberRequest(teamMember.id);

      if (!response.success) {
        throw new Error(response.message || 'Unable to delete team member');
      }

      setTeamMembers((current) =>
        current.filter((currentTeamMember) => currentTeamMember.id !== teamMember.id)
      );
      if (editingTeamMemberId === teamMember.id) {
        cancelEditingTeamMember();
      }

      toast({
        title: 'Team member deleted',
        description: `${teamMember.name} has been removed.`,
      });
    } catch (error) {
      toast({
        title: 'Unable to delete team member',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeletingTeamMemberId(null);
    }
  };

  const handleSaveTeamMemberLabels = async (labelIds: string[]) => {
    if (!labelAccessTeamMember) {
      return;
    }

    try {
      setIsUpdatingTeamMemberLabels(true);
      const response = await updateTeamMemberLabelsRequest(labelAccessTeamMember.id, labelIds);

      if (!response.success || !response.data?.teamMember) {
        throw new Error(response.message || 'Unable to update label access');
      }

      const updatedTeamMember = response.data.teamMember;
      setTeamMembers((current) =>
        current.map((teamMember) =>
          teamMember.id === updatedTeamMember.id ? updatedTeamMember : teamMember
        )
      );
      setLabelAccessTeamMember(null);
      toast({
        title: 'Label access updated',
        description: `${updatedTeamMember.name} can now work on ${updatedTeamMember.assignedLabels.length} label${updatedTeamMember.assignedLabels.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      toast({
        title: 'Unable to update label access',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingTeamMemberLabels(false);
    }
  };

  const selectedTheme: ThemePreference =
    isThemeReady && (theme === 'light' || theme === 'dark' || theme === 'system')
      ? theme
      : 'system';
  const activeThemeLabel =
    resolvedTheme === 'dark' ? 'Dark' : resolvedTheme === 'light' ? 'Light' : 'System';

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
        <div className="rounded-2xl border bg-card/80 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0.5 h-9 w-9 shrink-0 rounded-full"
              onClick={handleBack}
              aria-label="Back to chats"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                <p className="text-sm text-muted-foreground">
                  Manage workspace members, appearance, notifications, and WhatsApp channel settings.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {teamMembers.length} team member{teamMembers.length === 1 ? '' : 's'}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {isSocketConnected ? 'Live channel connected' : 'Live channel disconnected'}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="team" className="space-y-6">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-xl bg-muted/60 p-1">
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="channel">Channel Setup</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>

          <TabsContent value="team" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Team Members
                </CardTitle>
                <CardDescription>
                  Phase 1 adds team members under the current user. Chat assignment will be layered on top in Phase 2.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-sm text-muted-foreground">Workspace members</div>
                  <div className="mt-2 text-3xl font-semibold">{teamMembers.length}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-sm text-muted-foreground">Phase status</div>
                  <div className="mt-2 text-lg font-semibold">Phase 1 active</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Member CRUD is live in settings.
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-sm text-muted-foreground">Next phase</div>
                  <div className="mt-2 text-lg font-semibold">Chat assignment</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Assignment rules can use this member list later.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Add Team Member
                </CardTitle>
                <CardDescription>
                  Create a member record under the current workspace owner.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 md:grid-cols-5" onSubmit={handleCreateTeamMember}>
                  <div className="space-y-2 md:col-span-1">
                    <Label htmlFor="team-member-name">Name</Label>
                    <Input
                      id="team-member-name"
                      value={createForm.name}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Enter member name"
                      required
                    />
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label htmlFor="team-member-email">Email</Label>
                    <Input
                      id="team-member-email"
                      type="email"
                      value={createForm.email}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="name@example.com"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label htmlFor="team-member-mobile">Mobile Number</Label>
                    <Input
                      id="team-member-mobile"
                      value={createForm.mobileNumber}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, mobileNumber: event.target.value }))
                      }
                      placeholder="919876543210"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label htmlFor="team-member-password">Password</Label>
                    <Input
                      id="team-member-password"
                      type="password"
                      value={createForm.password}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Minimum 6 characters"
                      required
                    />
                  </div>
                  <div className="flex items-end md:col-span-1">
                    <Button type="submit" className="w-full" disabled={isCreatingTeamMember}>
                      {isCreatingTeamMember ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add member
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Existing Members</CardTitle>
                <CardDescription>
                  Update names, email addresses, mobile numbers, and passwords for this user’s team.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isTeamMembersLoading ? (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading team members...
                  </div>
                ) : teamMembers.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    No team members added yet.
                  </div>
                ) : (
                  teamMembers.map((teamMember) => {
                    const isEditing = editingTeamMemberId === teamMember.id;
                    const isDeleting = deletingTeamMemberId === teamMember.id;

                    return (
                      <div
                        key={teamMember.id}
                        className="rounded-xl border bg-card/40 p-4 shadow-sm"
                      >
                        {isEditing ? (
                          <div className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-4">
                              <div className="space-y-2">
                                <Label>Name</Label>
                                <Input
                                  value={editForm.name}
                                  onChange={(event) =>
                                    setEditForm((current) => ({ ...current, name: event.target.value }))
                                  }
                                  placeholder="Enter member name"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                  type="email"
                                  value={editForm.email}
                                  onChange={(event) =>
                                    setEditForm((current) => ({ ...current, email: event.target.value }))
                                  }
                                  placeholder="name@example.com"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Mobile Number</Label>
                                <Input
                                  value={editForm.mobileNumber}
                                  onChange={(event) =>
                                    setEditForm((current) => ({ ...current, mobileNumber: event.target.value }))
                                  }
                                  placeholder="919876543210"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Password</Label>
                                <Input
                                  type="password"
                                  value={editForm.password}
                                  onChange={(event) =>
                                    setEditForm((current) => ({ ...current, password: event.target.value }))
                                  }
                                  placeholder="Leave blank to keep current password"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => void handleUpdateTeamMember(teamMember.id)}
                                disabled={isUpdatingTeamMember}
                              >
                                {isUpdatingTeamMember ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  'Save changes'
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={cancelEditingTeamMember}
                                disabled={isUpdatingTeamMember}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                  {getInitials(teamMember.name)}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold">
                                    {teamMember.name}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Mail className="h-3.5 w-3.5" />
                                      {teamMember.email || 'No email'}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <Smartphone className="h-3.5 w-3.5" />
                                      {teamMember.mobileNumber || 'No mobile number'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {teamMember.assignedLabels.length > 0 ? (
                                  teamMember.assignedLabels.map((label) => (
                                    <Badge key={label.id} variant="outline" className="gap-1">
                                      <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ backgroundColor: label.color }}
                                      />
                                      {label.name}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    No label access assigned yet.
                                  </span>
                                )}
                              </div>
                              <div className="mt-3 text-xs text-muted-foreground">
                                Added {formatTeamMemberDate(teamMember.createdAt)} • Updated {formatTeamMemberDate(teamMember.updatedAt)}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setLabelAccessTeamMember(teamMember)}
                              >
                                Label access
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => beginEditingTeamMember(teamMember)}
                              >
                                <PencilLine className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={isDeleting}
                                onClick={() => void handleDeleteTeamMember(teamMember)}
                              >
                                {isDeleting ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Deleting...
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
        </TabsContent>

          <TabsContent value="appearance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  Theme
                </CardTitle>
                <CardDescription>
                  Override the system theme for this browser. Your choice is saved locally and reused on the next visit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <RadioGroup
                  value={selectedTheme}
                  onValueChange={(value) => setTheme(value as ThemePreference)}
                  className="grid gap-3 md:grid-cols-3"
                >
                  <Label
                    htmlFor="theme-system"
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
                  >
                    <RadioGroupItem id="theme-system" value="system" className="mt-1" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Monitor className="h-4 w-4" />
                        Default
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Follow the device theme automatically.
                      </p>
                    </div>
                  </Label>

                  <Label
                    htmlFor="theme-light"
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
                  >
                    <RadioGroupItem id="theme-light" value="light" className="mt-1" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Sun className="h-4 w-4" />
                        Light
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Always use the light theme.
                      </p>
                    </div>
                  </Label>

                  <Label
                    htmlFor="theme-dark"
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40"
                  >
                    <RadioGroupItem id="theme-dark" value="dark" className="mt-1" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Moon className="h-4 w-4" />
                        Dark
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Always use the dark theme.
                      </p>
                    </div>
                  </Label>
                </RadioGroup>

                <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Selected mode: <span className="font-medium text-foreground capitalize">{selectedTheme}</span>
                  {' '}• Effective theme: <span className="font-medium text-foreground">{activeThemeLabel}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="channel" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  WhatsApp Channel
                </CardTitle>
                <CardDescription>
                  Your WhatsApp Business API connection status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Real-time Connection</Label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {isSocketConnected ? 'Connected' : 'Disconnected'}
                      </span>
                      {isSocketConnected ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Configuration Status</Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Setup Required</Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                <p className="text-sm text-muted-foreground">
                  Configure your WhatsApp Business API credentials to enable messaging.
                  You can set up your credentials through the environment configuration.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Access Token
                </CardTitle>
                <CardDescription>
                  Manage your WhatsApp Business API access token
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="token">Access Token</Label>
                  <Input
                    id="token"
                    type="password"
                    placeholder="Configure via environment variables"
                    className="font-mono"
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    Set WHATSAPP_ACCESS_TOKEN in your environment configuration
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notification Settings
                </CardTitle>
                <CardDescription>
                  Configure how you receive alerts and notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">Browser Notifications</p>
                    <p className="text-sm text-muted-foreground">
                      {notificationsSupported
                        ? isGranted
                          ? 'Enabled - You will receive notifications for new messages'
                          : 'Click to enable desktop notifications'
                        : 'Not supported in this browser'}
                    </p>
                  </div>
                  {notificationsSupported && !isGranted && (
                    <Button onClick={handleEnableNotifications} size="sm">
                      Enable
                    </Button>
                  )}
                  {isGranted && (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">New message alerts</p>
                    <p className="text-sm text-muted-foreground">
                      Get notified when you receive new messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.newMessages}
                    onChange={(event) =>
                      handlePreferenceChange('newMessages', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">Delivery status updates</p>
                    <p className="text-sm text-muted-foreground">
                      Track message delivery and read status
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.deliveryStatus}
                    onChange={(event) =>
                      handlePreferenceChange('deliveryStatus', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">Sound notifications</p>
                    <p className="text-sm text-muted-foreground">
                      Play sound for new messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.sound}
                    onChange={(event) =>
                      handlePreferenceChange('sound', event.target.checked)
                    }
                    className="toggle toggle-primary"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  Webhook Configuration
                </CardTitle>
                <CardDescription>
                  Configure webhook endpoints for receiving WhatsApp events
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    placeholder="/api/whatsapp/webhooks"
                    className="font-mono"
                    disabled
                    value="/api/whatsapp/webhooks"
                  />
                  <p className="text-xs text-muted-foreground">
                    This is your webhook endpoint for Meta WhatsApp Business API
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="verify-token">Verify Token</Label>
                  <Input
                    id="verify-token"
                    type="password"
                    placeholder="Configure via WHATSAPP_WEBHOOK_VERIFY_TOKEN"
                    disabled
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security
                </CardTitle>
                <CardDescription>
                  Webhook signature verification settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="app-secret">App Secret</Label>
                  <Input
                    id="app-secret"
                    type="password"
                    placeholder="Configure via WHATSAPP_APP_SECRET"
                    disabled
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to verify X-Hub-Signature-256 header on incoming webhooks
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="about" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>About Whats91 Chat</CardTitle>
                <CardDescription>
                  Application information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Version</Label>
                  <span className="font-mono text-sm">1.0.0</span>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label>PWA Status</Label>
                  <Badge variant="outline">Installable</Badge>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label>Features</Label>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>• Real-time messaging via WebSocket</li>
                    <li>• Offline support with service worker</li>
                    <li>• Cross-browser notifications</li>
                    <li>• WhatsApp Cloud API integration</li>
                    <li>• Team-member CRUD in settings</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
        </TabsContent>
      </Tabs>

      <TeamMemberLabelAccessDialog
        open={labelAccessTeamMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLabelAccessTeamMember(null);
          }
        }}
        teamMember={labelAccessTeamMember}
        availableLabels={availableLabels}
        isLoadingLabels={isLabelsLoading}
        isSaving={isUpdatingTeamMemberLabels}
        onSave={handleSaveTeamMemberLabels}
      />
      </div>
    </div>
  );
}
