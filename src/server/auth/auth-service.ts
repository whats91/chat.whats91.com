import 'server-only';

// Dependency note:
// User lookup, password, OTP, or auth-token changes here must stay aligned with:
// - prisma/schema.prisma
// - src/server/auth/session.ts
// - src/app/api/auth/**
// - src/lib/api/auth-client.ts
// - src/components/auth/LoginForm.tsx

import { db } from '@/lib/db';
import type { AuthenticatedUser } from '@/lib/types/auth';
import { issueLoginOtp, verifyLoginOtp, clearLoginOtp } from '@/server/auth/otp-store';
import { findDefaultCloudApiSetupByUser } from '@/server/db/cloud-api-setup';
import { sendMessageToMeta } from '@/server/whatsapp/message-sender';

interface UserRow {
  id: string | number | bigint;
  admin_id: string | number | bigint | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  username: string | null;
  password: string | null;
  auth_token?: string | null;
  status: string | number | bigint | null;
  type: string | null;
}

interface TeamMemberLoginRow {
  id: string | number | bigint;
  user_id: string | number | bigint;
  name: string | null;
  email: string | null;
  mobile_number: string | null;
  password: string | null;
}

interface AuthUserRecord extends AuthenticatedUser {
  passwordHash: string | null;
}

interface TeamMemberAuthRecord {
  id: string;
  ownerUserId: string;
  name: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
}

const NORMALIZED_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')";
const NORMALIZED_TEAM_MEMBER_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile_number, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')";

function normalizePhoneForLookup(value: string): string {
  return value.replace(/\D/g, '');
}

function mapAuthUser(row: UserRow | undefined): AuthUserRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    adminId: row.admin_id == null ? null : String(row.admin_id),
    name: String(row.name || ''),
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    username: row.username == null ? null : String(row.username),
    type: String(row.type || ''),
    principalType: 'owner',
    teamMemberId: null,
    passwordHash: row.password == null ? null : String(row.password),
  };
}

function mapTeamMemberAuthRecord(row: TeamMemberLoginRow | undefined): TeamMemberAuthRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    ownerUserId: String(row.user_id),
    name: String(row.name || ''),
    email: row.email == null ? null : String(row.email),
    phone: row.mobile_number == null ? null : String(row.mobile_number),
    passwordHash: row.password == null ? null : String(row.password),
  };
}

function sanitizeAuthenticatedUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    adminId: user.adminId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    username: user.username,
    type: user.type,
    principalType: user.principalType,
    teamMemberId: user.teamMemberId,
  };
}

function sanitizeTeamMemberAuthenticatedUser(
  teamMember: TeamMemberAuthRecord,
  owner: AuthUserRecord
): AuthenticatedUser {
  return {
    id: owner.id,
    adminId: owner.adminId,
    name: teamMember.name || owner.name,
    email: teamMember.email,
    phone: teamMember.phone,
    username: teamMember.email,
    type: 'team_member',
    principalType: 'team_member',
    teamMemberId: teamMember.id,
  };
}

function maskPhoneNumber(phone: string | null): string {
  const normalized = normalizePhoneForLookup(phone || '');
  if (normalized.length <= 4) {
    return normalized;
  }

  return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

async function comparePassword(plainTextPassword: string, passwordHash: string): Promise<boolean> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(String(plainTextPassword), String(passwordHash));
}

async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  const rows = await db.$queryRawUnsafe<UserRow[]>(
    `SELECT id, admin_id, name, email, phone, username, password, status, type
     FROM users
     WHERE id = ? AND status = 1 AND deleted_at IS NULL
     LIMIT 1`,
    userId
  );

  return mapAuthUser(rows[0]);
}

async function ensureParentAccountIsActive(user: AuthUserRecord): Promise<boolean> {
  if (!user.adminId) {
    return true;
  }

  const parent = await findUserById(user.adminId);
  return Boolean(parent);
}

async function findUserByPhone(phone: string): Promise<AuthUserRecord | null> {
  const normalizedPhone = normalizePhoneForLookup(phone);
  if (!normalizedPhone) {
    return null;
  }

  const tailPhone = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : null;
  const rows = await db.$queryRawUnsafe<UserRow[]>(
    `SELECT id, admin_id, name, email, phone, username, password, status, type
     FROM users
     WHERE status = 1
       AND deleted_at IS NULL
       AND (
         ${NORMALIZED_PHONE_SQL} = ?
         OR (? IS NOT NULL AND RIGHT(${NORMALIZED_PHONE_SQL}, 10) = ?)
       )
     ORDER BY id DESC
     LIMIT 1`,
    normalizedPhone,
    tailPhone,
    tailPhone
  );

  return mapAuthUser(rows[0]);
}

async function findUserByIdentifier(identifier: string): Promise<AuthUserRecord | null> {
  const normalizedPhone = normalizePhoneForLookup(identifier);
  const tailPhone = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : null;
  const hasPhoneCandidate = normalizedPhone.length > 0;
  const query = hasPhoneCandidate
    ? `SELECT id, admin_id, name, email, phone, username, password, status, type
       FROM users
       WHERE status = 1
         AND deleted_at IS NULL
         AND (
           username = ?
           OR LOWER(COALESCE(email, '')) = LOWER(?)
           OR ${NORMALIZED_PHONE_SQL} = ?
           OR (? IS NOT NULL AND RIGHT(${NORMALIZED_PHONE_SQL}, 10) = ?)
         )
       ORDER BY id DESC
       LIMIT 1`
    : `SELECT id, admin_id, name, email, phone, username, password, status, type
       FROM users
       WHERE status = 1
         AND deleted_at IS NULL
         AND (
           username = ?
           OR LOWER(COALESCE(email, '')) = LOWER(?)
         )
       ORDER BY id DESC
       LIMIT 1`;

  const params = hasPhoneCandidate
    ? [identifier, identifier, normalizedPhone, tailPhone, tailPhone]
    : [identifier, identifier];
  const rows = await db.$queryRawUnsafe<UserRow[]>(query, ...params);

  return mapAuthUser(rows[0]);
}

async function findTeamMemberByIdentifier(identifier: string): Promise<TeamMemberAuthRecord | null> {
  const normalizedPhone = normalizePhoneForLookup(identifier);
  const tailPhone = normalizedPhone.length >= 10 ? normalizedPhone.slice(-10) : null;
  const hasPhoneCandidate = normalizedPhone.length > 0;
  const query = hasPhoneCandidate
    ? `SELECT tm.id, tm.user_id, tm.name, tm.email, tm.mobile_number, tm.password
       FROM team_members tm
       INNER JOIN users u ON u.id = tm.user_id
       WHERE u.status = 1
         AND u.deleted_at IS NULL
         AND (
           LOWER(COALESCE(tm.email, '')) = LOWER(?)
           OR ${NORMALIZED_TEAM_MEMBER_PHONE_SQL} = ?
           OR (? IS NOT NULL AND RIGHT(${NORMALIZED_TEAM_MEMBER_PHONE_SQL}, 10) = ?)
         )
       ORDER BY tm.id DESC
       LIMIT 1`
    : `SELECT tm.id, tm.user_id, tm.name, tm.email, tm.mobile_number, tm.password
       FROM team_members tm
       INNER JOIN users u ON u.id = tm.user_id
       WHERE u.status = 1
         AND u.deleted_at IS NULL
         AND LOWER(COALESCE(tm.email, '')) = LOWER(?)
       ORDER BY tm.id DESC
       LIMIT 1`;

  const params = hasPhoneCandidate
    ? [identifier, normalizedPhone, tailPhone, tailPhone]
    : [identifier];
  const rows = await db.$queryRawUnsafe<TeamMemberLoginRow[]>(query, ...params);

  return mapTeamMemberAuthRecord(rows[0]);
}

async function findUserByAuthToken(authToken: string): Promise<AuthUserRecord | null> {
  const normalizedToken = authToken.trim();
  if (!normalizedToken) {
    return null;
  }

  const rows = await db.$queryRawUnsafe<UserRow[]>(
    `SELECT id, admin_id, name, email, phone, username, password, auth_token, status, type
     FROM users
     WHERE auth_token = ?
       AND status = 1
       AND deleted_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    normalizedToken
  );

  return mapAuthUser(rows[0]);
}

async function resolveOtpSenderConfig(user: AuthUserRecord): Promise<{ accessToken: string; phoneNumberId: string } | null> {
  const configOwnerUserId = user.adminId || user.id;
  const setup = await findDefaultCloudApiSetupByUser(configOwnerUserId);
  const accessToken = setup?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
  const phoneNumberId = setup?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return {
    accessToken,
    phoneNumberId,
  };
}

export async function getAuthenticatedUserProfile(userId: string): Promise<AuthenticatedUser | null> {
  const user = await findUserById(userId);
  return user ? sanitizeAuthenticatedUser(user) : null;
}

export async function authenticateWithPassword(
  identifier: string,
  password: string
): Promise<
  | { success: true; user: AuthenticatedUser }
  | { success: false; message: string }
> {
  const normalizedIdentifier = identifier.trim();
  const ownerUser = await findUserByIdentifier(normalizedIdentifier);
  if (ownerUser?.passwordHash && (await comparePassword(password, ownerUser.passwordHash))) {
    if (!(await ensureParentAccountIsActive(ownerUser))) {
      return {
        success: false,
        message: 'No active partner account found for this user',
      };
    }

    return {
      success: true,
      user: sanitizeAuthenticatedUser(ownerUser),
    };
  }

  const teamMember = await findTeamMemberByIdentifier(normalizedIdentifier);
  if (teamMember?.passwordHash && (await comparePassword(password, teamMember.passwordHash))) {
    const ownerAccount = await findUserById(teamMember.ownerUserId);
    if (!ownerAccount) {
      return {
        success: false,
        message: 'No active partner account found for this user',
      };
    }

    if (!(await ensureParentAccountIsActive(ownerAccount))) {
      return {
        success: false,
        message: 'No active partner account found for this user',
      };
    }

    return {
      success: true,
      user: sanitizeTeamMemberAuthenticatedUser(teamMember, ownerAccount),
    };
  }

  if ((ownerUser && !ownerUser.passwordHash) || (teamMember && !teamMember.passwordHash)) {
    return {
      success: false,
      message: 'Password login is not enabled for this account',
    };
  }

  return {
    success: false,
    message: 'Invalid username or password',
  };
}

export async function authenticateWithAuthToken(
  authToken: string
): Promise<
  | { success: true; user: AuthenticatedUser }
  | { success: false; message: string }
> {
  const user = await findUserByAuthToken(authToken);
  if (!user) {
    return {
      success: false,
      message: 'Automatic login link is invalid or expired',
    };
  }

  if (!(await ensureParentAccountIsActive(user))) {
    return {
      success: false,
      message: 'No active partner account found for this user',
    };
  }

  return {
    success: true,
    user: sanitizeAuthenticatedUser(user),
  };
}

export async function requestLoginOtp(
  phone: string
): Promise<
  | { success: true; message: string; maskedPhone: string }
  | { success: false; message: string }
> {
  const user = await findUserByPhone(phone);
  if (!user || !user.phone) {
    return {
      success: false,
      message: 'No active account was found for this phone number',
    };
  }

  if (!(await ensureParentAccountIsActive(user))) {
    return {
      success: false,
      message: 'No active partner account found for this user',
    };
  }

  const senderConfig = await resolveOtpSenderConfig(user);
  if (!senderConfig) {
    return {
      success: false,
      message: 'WhatsApp OTP delivery is not configured for this account',
    };
  }

  const phoneKey = normalizePhoneForLookup(user.phone);
  const { otp } = await issueLoginOtp(phoneKey, user.id);
  const sendResult = await sendMessageToMeta({
    accessToken: senderConfig.accessToken,
    phoneNumberId: senderConfig.phoneNumberId,
    messagePayload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneKey,
      type: 'text',
      text: {
        body: `Your Whats91 login OTP is ${otp}. It is valid for 10 minutes. Do not share it with anyone.`,
        preview_url: false,
      },
    },
    options: {
      receiverId: phoneKey,
      skipConversationLog: true,
    },
  });

  if (!sendResult.success) {
    await clearLoginOtp(phoneKey);
    return {
      success: false,
      message: sendResult.error || sendResult.reason || 'Failed to send OTP',
    };
  }

  return {
    success: true,
    message: 'OTP sent successfully',
    maskedPhone: maskPhoneNumber(user.phone),
  };
}

export async function authenticateWithOtp(
  phone: string,
  otp: string
): Promise<
  | { success: true; user: AuthenticatedUser }
  | { success: false; message: string; attemptsLeft?: number }
> {
  const phoneKey = normalizePhoneForLookup(phone);
  if (!phoneKey) {
    return {
      success: false,
      message: 'Phone number is required',
    };
  }

  const otpResult = await verifyLoginOtp(phoneKey, otp);
  if (!otpResult.success) {
    return otpResult;
  }

  const user = await findUserById(otpResult.userId);
  if (!user) {
    return {
      success: false,
      message: 'User not found or account is inactive',
    };
  }

  if (!(await ensureParentAccountIsActive(user))) {
    return {
      success: false,
      message: 'No active partner account found for this user',
    };
  }

  return {
    success: true,
    user: sanitizeAuthenticatedUser(user),
  };
}
