import type { AuthenticatedUser } from '@/lib/types/auth';

export const AUTH_SESSION_COOKIE_NAME = 'whats91_session';
export const AUTH_USER_ID_COOKIE_NAME = 'whats91_uid';
export const AUTH_CSRF_COOKIE_NAME = 'whats91_csrf';
export const AUTH_USER_ID_STORAGE_KEY = 'whats91.user.id';

export const AUTH_SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const AUTH_CSRF_MAX_AGE_SECONDS = 12 * 60 * 60;
export const LOGIN_OTP_TTL_SECONDS = 10 * 60;
export const LOGIN_OTP_MAX_ATTEMPTS = 3;

export interface AuthSessionPayload {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  user: AuthenticatedUser;
}
