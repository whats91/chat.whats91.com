import 'server-only';

// Dependency note:
// Conversation assignment changes here must stay aligned with:
// - prisma/schema-conversations.prisma
// - src/server/db/conversations-db.ts
// - src/server/db/team-members.ts
// - src/app/api/conversations/[id]/assignment/route.ts
// - src/components/chat/RightInfoPanel.tsx
// - src/lib/types/team-member.ts

import { Logger } from '@/lib/logger';
import { executeConversationsDb, queryConversationsDb } from '@/server/db/conversations-db';
import type { TeamMember } from '@/lib/types/team-member';
import { getTeamMemberById } from '@/server/db/team-members';

const log = new Logger('ConversationTeamAssignmentsDB');

interface ConversationExistsRow {
  id: string | number;
}

interface ConversationTeamAssignmentRow {
  id: string | number | bigint;
  user_id: string | number | bigint;
  conversation_id: string | number;
  team_member_id: string | number | bigint;
  created_at: Date | string;
  updated_at: Date | string;
}

async function ensureConversationOwnership(userId: string, conversationId: string): Promise<void> {
  const rows = await queryConversationsDb<ConversationExistsRow>(
    `SELECT id
     FROM conversations
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [conversationId, userId]
  );

  if (!rows[0]) {
    throw new Error('Conversation not found');
  }
}

export async function getConversationAssignedTeamMember(
  userId: string,
  conversationId: string
): Promise<TeamMember | null> {
  try {
    await ensureConversationOwnership(userId, conversationId);

    const rows = await queryConversationsDb<ConversationTeamAssignmentRow>(
      `SELECT id, user_id, conversation_id, team_member_id, created_at, updated_at
       FROM conversation_team_assignments
       WHERE conversation_id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    const assignment = rows[0];
    if (!assignment) {
      return null;
    }

    return getTeamMemberById(userId, String(assignment.team_member_id));
  } catch (error) {
    log.error('getConversationAssignedTeamMember error', {
      userId,
      conversationId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function assignConversationToTeamMember(
  userId: string,
  conversationId: string,
  teamMemberId: string | null
): Promise<TeamMember | null> {
  try {
    await ensureConversationOwnership(userId, conversationId);

    if (!teamMemberId) {
      await executeConversationsDb(
        `DELETE FROM conversation_team_assignments
         WHERE conversation_id = ? AND user_id = ?`,
        [conversationId, userId]
      );

      return null;
    }

    const teamMember = await getTeamMemberById(userId, teamMemberId);
    if (!teamMember) {
      throw new Error('Team member not found');
    }

    const existingRows = await queryConversationsDb<ConversationTeamAssignmentRow>(
      `SELECT id, user_id, conversation_id, team_member_id, created_at, updated_at
       FROM conversation_team_assignments
       WHERE conversation_id = ? AND user_id = ?
       LIMIT 1`,
      [conversationId, userId]
    );

    if (existingRows[0]) {
      await executeConversationsDb(
        `UPDATE conversation_team_assignments
         SET team_member_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE conversation_id = ? AND user_id = ?`,
        [teamMemberId, conversationId, userId]
      );
    } else {
      await executeConversationsDb(
        `INSERT INTO conversation_team_assignments
         (user_id, conversation_id, team_member_id, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, conversationId, teamMemberId]
      );
    }

    return teamMember;
  } catch (error) {
    log.error('assignConversationToTeamMember error', {
      userId,
      conversationId,
      teamMemberId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}
