import 'server-only';

// Dependency note:
// Team member or label-assignment changes here must stay aligned with:
// - prisma/schema.prisma
// - src/lib/types/team-member.ts
// - src/app/api/team-members/**
// - src/app/settings/page.tsx
// - src/components/chat/RightInfoPanel.tsx

import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { Logger } from '@/lib/logger';
import type { ChatLabel } from '@/lib/types/chat';
import type { TeamMember, TeamMemberInput } from '@/lib/types/team-member';
import { getChatLabelsByIds } from '@/server/db/chat-labels';

const log = new Logger('TeamMembersDB');

interface TeamMemberRow {
  id: string | number | bigint;
  uid: string;
  user_id: string | number | bigint;
  name: string;
  email: string | null;
  mobile_number: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TeamMemberLabelAssignmentRow {
  team_member_id: string | number | bigint;
  label_id: string | number | bigint;
  uid: string;
  user_id: string | number | bigint;
  phone_number: string;
  label_name: string;
  color_code: string;
}

function buildInClause(values: Array<string | number | bigint>): string {
  return values.map(() => '?').join(', ');
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/[^\d+]/g, '');
  return normalized || null;
}

function toIsoString(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function mapTeamMemberLabelRow(row: TeamMemberLabelAssignmentRow): ChatLabel {
  return {
    id: String(row.label_id),
    uid: row.uid,
    userId: String(row.user_id),
    phoneNumber: row.phone_number,
    name: row.label_name,
    color: row.color_code,
  };
}

function mapTeamMemberRow(row: TeamMemberRow, assignedLabels: ChatLabel[] = []): TeamMember {
  return {
    id: String(row.id),
    uid: row.uid,
    userId: String(row.user_id),
    name: row.name,
    email: row.email,
    mobileNumber: row.mobile_number,
    assignedLabels,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function validateTeamMemberInput(
  input: TeamMemberInput
): { name: string; email: string | null; mobileNumber: string | null } {
  const name = input.name.trim();
  const email = normalizeNullableText(input.email);
  const mobileNumber = normalizePhone(input.mobileNumber);

  if (!name) {
    throw new Error('Name is required');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address');
  }

  return {
    name,
    email,
    mobileNumber,
  };
}

async function getAssignedLabelsByTeamMemberIds(
  userId: string,
  teamMemberIds: Array<string | number | bigint>
): Promise<Map<string, ChatLabel[]>> {
  const normalizedIds = Array.from(new Set(teamMemberIds.map((value) => String(value).trim()).filter(Boolean)));

  if (normalizedIds.length === 0) {
    return new Map();
  }

  const rows = await db.$queryRawUnsafe<TeamMemberLabelAssignmentRow[]>(
    `SELECT
       tmla.team_member_id,
       cl.id AS label_id,
       cl.uid,
       cl.user_id,
       cl.phone_number,
       cl.label_name,
       cl.color_code
     FROM team_member_label_assignments tmla
     INNER JOIN chat_labels cl ON cl.id = tmla.label_id
     WHERE cl.user_id = ?
       AND tmla.team_member_id IN (${buildInClause(normalizedIds)})
     ORDER BY cl.label_name ASC, cl.id ASC`,
    userId,
    ...normalizedIds
  );

  const assignments = new Map<string, ChatLabel[]>();

  for (const row of rows) {
    const teamMemberId = String(row.team_member_id);
    const existing = assignments.get(teamMemberId) || [];
    existing.push(mapTeamMemberLabelRow(row));
    assignments.set(teamMemberId, existing);
  }

  return assignments;
}

async function hydrateTeamMembers(
  userId: string,
  rows: TeamMemberRow[]
): Promise<TeamMember[]> {
  const assignedLabelsByTeamMemberId = await getAssignedLabelsByTeamMemberIds(
    userId,
    rows.map((row) => row.id)
  );

  return rows.map((row) =>
    mapTeamMemberRow(row, assignedLabelsByTeamMemberId.get(String(row.id)) || [])
  );
}

async function getTeamMemberRowById(userId: string, teamMemberId: string): Promise<TeamMemberRow | null> {
  const rows = await db.$queryRawUnsafe<TeamMemberRow[]>(
    `SELECT id, uid, user_id, name, email, mobile_number, created_at, updated_at
     FROM team_members
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    teamMemberId,
    userId
  );

  return rows[0] || null;
}

export async function listTeamMembersByUser(userId: string): Promise<TeamMember[]> {
  try {
    const rows = await db.$queryRawUnsafe<TeamMemberRow[]>(
      `SELECT id, uid, user_id, name, email, mobile_number, created_at, updated_at
       FROM team_members
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`,
      userId
    );

    return hydrateTeamMembers(userId, rows);
  } catch (error) {
    log.error('listTeamMembersByUser error', {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function getTeamMemberById(userId: string, teamMemberId: string): Promise<TeamMember | null> {
  try {
    const row = await getTeamMemberRowById(userId, teamMemberId);
    if (!row) {
      return null;
    }

    const [teamMember] = await hydrateTeamMembers(userId, [row]);
    return teamMember || null;
  } catch (error) {
    log.error('getTeamMemberById error', {
      userId,
      teamMemberId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function createTeamMember(userId: string, input: TeamMemberInput): Promise<TeamMember> {
  const values = validateTeamMemberInput(input);

  try {
    const uid = randomUUID();

    await db.$executeRawUnsafe(
      `INSERT INTO team_members (uid, user_id, name, email, mobile_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      uid,
      userId,
      values.name,
      values.email,
      values.mobileNumber
    );

    const rows = await db.$queryRawUnsafe<TeamMemberRow[]>(
      `SELECT id, uid, user_id, name, email, mobile_number, created_at, updated_at
       FROM team_members
       WHERE user_id = ? AND uid = ?
       LIMIT 1`,
      userId,
      uid
    );

    if (!rows[0]) {
      throw new Error('Unable to load the created team member');
    }

    const [teamMember] = await hydrateTeamMembers(userId, [rows[0]]);
    return teamMember;
  } catch (error) {
    log.error('createTeamMember error', {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function updateTeamMember(
  userId: string,
  teamMemberId: string,
  input: TeamMemberInput
): Promise<TeamMember> {
  const values = validateTeamMemberInput(input);

  try {
    const updatedCount = await db.$executeRawUnsafe(
      `UPDATE team_members
       SET name = ?, email = ?, mobile_number = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      values.name,
      values.email,
      values.mobileNumber,
      teamMemberId,
      userId
    );

    if (!updatedCount) {
      throw new Error('Team member not found');
    }

    const teamMember = await getTeamMemberById(userId, teamMemberId);
    if (!teamMember) {
      throw new Error('Unable to load the updated team member');
    }

    return teamMember;
  } catch (error) {
    log.error('updateTeamMember error', {
      userId,
      teamMemberId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function updateTeamMemberLabelAssignments(
  userId: string,
  teamMemberId: string,
  labelIds: Array<string | number>
): Promise<TeamMember> {
  const normalizedLabelIds = Array.from(
    new Set(labelIds.map((value) => String(value).trim()).filter(Boolean))
  );

  try {
    const existingTeamMember = await getTeamMemberRowById(userId, teamMemberId);
    if (!existingTeamMember) {
      throw new Error('Team member not found');
    }

    if (normalizedLabelIds.length > 0) {
      const validLabels = await getChatLabelsByIds(userId, normalizedLabelIds);
      if (validLabels.length !== normalizedLabelIds.length) {
        throw new Error('One or more labels are invalid for this user');
      }
    }

    await db.$executeRawUnsafe(
      `DELETE FROM team_member_label_assignments WHERE team_member_id = ?`,
      teamMemberId
    );

    for (const labelId of normalizedLabelIds) {
      await db.$executeRawUnsafe(
        `INSERT INTO team_member_label_assignments (team_member_id, label_id, created_at, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        teamMemberId,
        labelId
      );
    }

    const updatedTeamMember = await getTeamMemberById(userId, teamMemberId);
    if (!updatedTeamMember) {
      throw new Error('Unable to load team member label assignments');
    }

    return updatedTeamMember;
  } catch (error) {
    log.error('updateTeamMemberLabelAssignments error', {
      userId,
      teamMemberId,
      labelIds: normalizedLabelIds,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function deleteTeamMember(userId: string, teamMemberId: string): Promise<boolean> {
  try {
    await db.$executeRawUnsafe(
      `DELETE FROM team_member_label_assignments WHERE team_member_id = ?`,
      teamMemberId
    );

    const deletedCount = await db.$executeRawUnsafe(
      `DELETE FROM team_members WHERE id = ? AND user_id = ?`,
      teamMemberId,
      userId
    );

    return Boolean(deletedCount);
  } catch (error) {
    log.error('deleteTeamMember error', {
      userId,
      teamMemberId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}
