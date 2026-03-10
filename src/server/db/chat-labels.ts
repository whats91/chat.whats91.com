import 'server-only';

// Dependency note:
// Label-field changes here must stay aligned with:
// - prisma/schema.prisma
// - src/lib/types/chat.ts
// - src/server/controllers/conversation-controller.ts
// - src/components/chat/ChatList.tsx
// - src/components/chat/RightInfoPanel.tsx

import { db } from '@/lib/db';
import { Logger } from '@/lib/logger';
import type { ChatLabel } from '@/lib/types/chat';

const log = new Logger('ChatLabelsDB');

interface ChatLabelRow {
  id: string | number | bigint;
  uid: string;
  user_id: string | number | bigint;
  phone_number: string;
  label_name: string;
  color_code: string;
}

function mapChatLabelRow(row: ChatLabelRow): ChatLabel {
  return {
    id: String(row.id),
    uid: row.uid,
    userId: String(row.user_id),
    phoneNumber: row.phone_number,
    name: row.label_name,
    color: row.color_code,
  };
}

function buildInClause(values: Array<string | number>): string {
  return values.map(() => '?').join(', ');
}

export async function getChatLabelsByUserAndPhoneNumber(
  userId: string,
  phoneNumber: string
): Promise<ChatLabel[]> {
  try {
    const rows = await db.$queryRawUnsafe<ChatLabelRow[]>(
      `SELECT id, uid, user_id, phone_number, label_name, color_code
       FROM chat_labels
       WHERE user_id = ? AND phone_number = ?
       ORDER BY label_name ASC, id ASC`,
      userId,
      phoneNumber
    );

    return rows.map(mapChatLabelRow);
  } catch (error) {
    log.error('getChatLabelsByUserAndPhoneNumber error', {
      error: error instanceof Error ? error.message : error,
      userId,
      phoneNumber,
    });
    throw error;
  }
}

export async function getChatLabelsByUser(userId: string): Promise<ChatLabel[]> {
  try {
    const rows = await db.$queryRawUnsafe<ChatLabelRow[]>(
      `SELECT id, uid, user_id, phone_number, label_name, color_code
       FROM chat_labels
       WHERE user_id = ?
       ORDER BY phone_number ASC, label_name ASC, id ASC`,
      userId
    );

    return rows.map(mapChatLabelRow);
  } catch (error) {
    log.error('getChatLabelsByUser error', {
      error: error instanceof Error ? error.message : error,
      userId,
    });
    throw error;
  }
}

export async function getChatLabelsByIds(
  userId: string,
  labelIds: Array<string | number>
): Promise<ChatLabel[]> {
  const normalizedIds = Array.from(new Set(labelIds.map((value) => String(value).trim()).filter(Boolean)));

  if (normalizedIds.length === 0) {
    return [];
  }

  try {
    const rows = await db.$queryRawUnsafe<ChatLabelRow[]>(
      `SELECT id, uid, user_id, phone_number, label_name, color_code
       FROM chat_labels
       WHERE user_id = ? AND id IN (${buildInClause(normalizedIds)})
       ORDER BY label_name ASC, id ASC`,
      userId,
      ...normalizedIds
    );

    return rows.map(mapChatLabelRow);
  } catch (error) {
    log.error('getChatLabelsByIds error', {
      error: error instanceof Error ? error.message : error,
      userId,
      labelIds: normalizedIds,
    });
    throw error;
  }
}
