import 'server-only';

import crypto from 'node:crypto';
import {
  LOGIN_OTP_MAX_ATTEMPTS,
  LOGIN_OTP_TTL_SECONDS,
} from '@/lib/auth/session';
import { getRedisClient } from '@/server/db/redis';

interface StoredLoginOtp {
  userId: string;
  otpHash: string;
  attempts: number;
  expiresAt: number;
}

const OTP_KEY_PREFIX = 'auth:login-otp:';

function getOtpSecret(): string {
  return (
    process.env.AUTH_OTP_SECRET ||
    process.env.AUTH_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'whats91-dev-otp-secret'
  );
}

function getOtpKey(phoneKey: string): string {
  return `${OTP_KEY_PREFIX}${phoneKey}`;
}

function hashOtp(phoneKey: string, otp: string): string {
  return crypto
    .createHmac('sha256', getOtpSecret())
    .update(`${phoneKey}:${otp}`)
    .digest('hex');
}

function generateOtp(): string {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function getRemainingTtlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

export async function clearLoginOtp(phoneKey: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(getOtpKey(phoneKey));
}

export async function issueLoginOtp(phoneKey: string, userId: string): Promise<{ otp: string; expiresAt: Date }> {
  const redis = await getRedisClient();
  const otp = generateOtp();
  const expiresAt = Date.now() + LOGIN_OTP_TTL_SECONDS * 1000;

  const payload: StoredLoginOtp = {
    userId,
    otpHash: hashOtp(phoneKey, otp),
    attempts: 0,
    expiresAt,
  };

  await redis.set(getOtpKey(phoneKey), JSON.stringify(payload), LOGIN_OTP_TTL_SECONDS);

  return {
    otp,
    expiresAt: new Date(expiresAt),
  };
}

export async function verifyLoginOtp(
  phoneKey: string,
  otp: string
): Promise<
  | { success: true; userId: string }
  | { success: false; message: string; attemptsLeft?: number }
> {
  const redis = await getRedisClient();
  const key = getOtpKey(phoneKey);
  const rawValue = await redis.get(key);

  if (!rawValue) {
    return {
      success: false,
      message: 'No OTP requested for this phone number',
    };
  }

  let storedOtp: StoredLoginOtp;
  try {
    storedOtp = JSON.parse(rawValue) as StoredLoginOtp;
  } catch {
    await redis.del(key);
    return {
      success: false,
      message: 'OTP session is invalid. Request a new OTP.',
    };
  }

  if (Date.now() > storedOtp.expiresAt) {
    await redis.del(key);
    return {
      success: false,
      message: 'OTP has expired. Request a new OTP.',
    };
  }

  const nextAttempts = storedOtp.attempts + 1;
  const matches = storedOtp.otpHash === hashOtp(phoneKey, otp);

  if (!matches) {
    if (nextAttempts >= LOGIN_OTP_MAX_ATTEMPTS) {
      await redis.del(key);
      return {
        success: false,
        message: 'Too many failed attempts. Request a new OTP.',
        attemptsLeft: 0,
      };
    }

    await redis.set(
      key,
      JSON.stringify({
        ...storedOtp,
        attempts: nextAttempts,
      }),
      getRemainingTtlSeconds(storedOtp.expiresAt)
    );

    return {
      success: false,
      message: 'Invalid OTP',
      attemptsLeft: LOGIN_OTP_MAX_ATTEMPTS - nextAttempts,
    };
  }

  await redis.del(key);
  return {
    success: true,
    userId: storedOtp.userId,
  };
}
