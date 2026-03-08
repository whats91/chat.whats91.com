import 'server-only';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_CSRF_COOKIE_NAME,
  AUTH_CSRF_MAX_AGE_SECONDS,
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_USER_ID_COOKIE_NAME,
  type AuthSessionPayload,
} from '@/lib/auth/session';
import type { AuthenticatedUser } from '@/lib/types/auth';

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SESSION_SECRET or NEXTAUTH_SECRET is required in production');
  }

  return 'whats91-dev-auth-secret';
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signValue(value: string): string {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function encodeSessionPayload(payload: AuthSessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeSessionToken(token: string | undefined): AuthSessionPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<AuthSessionPayload>;

    if (parsed.version !== 1 || !parsed.user?.id || !parsed.expiresAt) {
      return null;
    }

    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      version: 1,
      issuedAt: Number(parsed.issuedAt || 0),
      expiresAt: Number(parsed.expiresAt),
      user: {
        id: String(parsed.user.id),
        adminId: parsed.user.adminId == null ? null : String(parsed.user.adminId),
        name: String(parsed.user.name || ''),
        email: parsed.user.email == null ? null : String(parsed.user.email),
        phone: parsed.user.phone == null ? null : String(parsed.user.phone),
        username: parsed.user.username == null ? null : String(parsed.user.username),
        type: String(parsed.user.type || ''),
      },
    };
  } catch {
    return null;
  }
}

function buildSessionToken(user: AuthenticatedUser): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: AuthSessionPayload = {
    version: 1,
    issuedAt,
    expiresAt: issuedAt + AUTH_SESSION_MAX_AGE_SECONDS,
    user,
  };
  const encodedPayload = encodeSessionPayload(payload);
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function getCookieOptions(httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(response: NextResponse, token = generateCsrfToken()): string {
  response.cookies.set(
    AUTH_CSRF_COOKIE_NAME,
    token,
    getCookieOptions(false, AUTH_CSRF_MAX_AGE_SECONDS)
  );
  return token;
}

export function writeAuthSession(response: NextResponse, user: AuthenticatedUser): void {
  response.cookies.set(
    AUTH_SESSION_COOKIE_NAME,
    buildSessionToken(user),
    getCookieOptions(true, AUTH_SESSION_MAX_AGE_SECONDS)
  );
  response.cookies.set(
    AUTH_USER_ID_COOKIE_NAME,
    user.id,
    getCookieOptions(false, AUTH_SESSION_MAX_AGE_SECONDS)
  );

  // Rotate CSRF alongside the session.
  setCsrfCookie(response);
}

export function clearAuthSession(response: NextResponse): void {
  const clearOptions = getCookieOptions(true, 0);
  response.cookies.set(AUTH_SESSION_COOKIE_NAME, '', clearOptions);
  response.cookies.set(AUTH_USER_ID_COOKIE_NAME, '', {
    ...clearOptions,
    httpOnly: false,
  });
  response.cookies.set(AUTH_CSRF_COOKIE_NAME, '', {
    ...clearOptions,
    httpOnly: false,
  });
}

export function getAuthenticatedUserFromCookies(cookieStore: CookieReader): AuthenticatedUser | null {
  return decodeSessionToken(cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value)?.user ?? null;
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  return getAuthenticatedUserFromCookies(cookieStore);
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const proto =
      request.headers.get('x-forwarded-proto') ||
      request.nextUrl.protocol.replace(':', '');

    return Boolean(host) && originUrl.host === host && originUrl.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

export function validateCsrfRequest(request: NextRequest): { valid: true } | { valid: false; message: string } {
  if (!isSameOrigin(request)) {
    return {
      valid: false,
      message: 'Invalid request origin',
    };
  }

  const cookieToken = request.cookies.get(AUTH_CSRF_COOKIE_NAME)?.value;
  const headerToken = request.headers.get('x-csrf-token');

  if (!cookieToken || !headerToken) {
    return {
      valid: false,
      message: 'Missing CSRF token',
    };
  }

  if (!safeCompare(cookieToken, headerToken)) {
    return {
      valid: false,
      message: 'Invalid CSRF token',
    };
  }

  return { valid: true };
}

