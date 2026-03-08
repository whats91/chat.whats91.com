import 'server-only';

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
  status: string | number | bigint | null;
  type: string | null;
}

interface AuthUserRecord extends AuthenticatedUser {
  passwordHash: string | null;
}

const NORMALIZED_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '')";

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
  const user = await findUserByIdentifier(identifier.trim());
  if (!user || !user.passwordHash) {
    return {
      success: false,
      message: 'Invalid username or password',
    };
  }

  if (!(await ensureParentAccountIsActive(user))) {
    return {
      success: false,
      message: 'No active partner account found for this user',
    };
  }

  const passwordMatches = await comparePassword(password, user.passwordHash);
  if (!passwordMatches) {
    return {
      success: false,
      message: 'Invalid username or password',
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
