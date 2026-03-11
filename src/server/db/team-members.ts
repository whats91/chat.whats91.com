import 'server-only';

// Dependency note:
// Team member column or validation changes here must stay aligned with:
// - prisma/schema.prisma
// - src/lib/types/team-member.ts
// - src/app/api/team-members/**
// - src/app/settings/page.tsx

import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { Logger } from '@/lib/logger';
import type { TeamMember, TeamMemberInput } from '@/lib/types/team-member';

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

function mapTeamMemberRow(row: TeamMemberRow): TeamMember {
  return {
    id: String(row.id),
    uid: row.uid,
    userId: String(row.user_id),
    name: row.name,
    email: row.email,
    mobileNumber: row.mobile_number,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function validateTeamMemberInput(input: TeamMemberInput): { name: string; email: string | null; mobileNumber: string | null } {
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

export async function listTeamMembersByUser(userId: string): Promise<TeamMember[]> {
  try {
    const rows = await db.$queryRawUnsafe<TeamMemberRow[]>(
      `SELECT id, uid, user_id, name, email, mobile_number, created_at, updated_at
       FROM team_members
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`,
      userId
    );

    return rows.map(mapTeamMemberRow);
  } catch (error) {
    log.error('listTeamMembersByUser error', {
      userId,
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

    return mapTeamMemberRow(rows[0]);
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

    const rows = await db.$queryRawUnsafe<TeamMemberRow[]>(
      `SELECT id, uid, user_id, name, email, mobile_number, created_at, updated_at
       FROM team_members
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      teamMemberId,
      userId
    );

    if (!rows[0]) {
      throw new Error('Unable to load the updated team member');
    }

    return mapTeamMemberRow(rows[0]);
  } catch (error) {
    log.error('updateTeamMember error', {
      userId,
      teamMemberId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

export async function deleteTeamMember(userId: string, teamMemberId: string): Promise<boolean> {
  try {
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
