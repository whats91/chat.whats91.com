/**
 * Team member types for the Settings workspace.
 *
 * Dependency note:
 * Changes here must stay aligned with:
 * - prisma/schema.prisma
 * - src/server/db/team-members.ts
 * - src/app/api/team-members/**
 * - src/lib/api/client.ts
 * - src/app/settings/page.tsx
 */

import type { ChatLabel } from '@/lib/types/chat';

export interface TeamMember {
  id: string;
  uid: string;
  userId: string;
  name: string;
  email: string | null;
  mobileNumber: string | null;
  assignedLabels: ChatLabel[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberInput {
  name: string;
  email?: string | null;
  mobileNumber?: string | null;
}

export interface TeamMembersResponse {
  success: boolean;
  message?: string;
  data?: {
    teamMembers: TeamMember[];
  };
}

export interface TeamMemberMutationResponse {
  success: boolean;
  message?: string;
  data?: {
    teamMember: TeamMember;
  };
}

export interface ConversationTeamAssignmentResponse {
  success: boolean;
  message?: string;
  data?: {
    assignedTeamMember: TeamMember | null;
  };
}
