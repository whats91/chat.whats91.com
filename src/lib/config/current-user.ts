import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_USER_ID_COOKIE_NAME,
  AUTH_USER_ID_STORAGE_KEY,
} from '@/lib/auth/session';

function readUserIdCookie(): string {
  if (typeof document === 'undefined') {
    return '';
  }

  const cookieName = `${AUTH_USER_ID_COOKIE_NAME}=`;
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(cookieName));

  return cookie ? decodeURIComponent(cookie.slice(cookieName.length)) : '';
}

export function getCurrentUserId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const cookieUserId = readUserIdCookie();

  if (cookieUserId) {
    if (window.localStorage.getItem(AUTH_USER_ID_STORAGE_KEY) !== cookieUserId) {
      window.localStorage.setItem(AUTH_USER_ID_STORAGE_KEY, cookieUserId);
    }

    return cookieUserId;
  }

  window.localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY);
  return '';
}

export function setCurrentUserId(userId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  document.cookie = `${AUTH_USER_ID_COOKIE_NAME}=${encodeURIComponent(userId)}; path=/; max-age=${AUTH_SESSION_MAX_AGE_SECONDS}; samesite=lax`;
  window.localStorage.setItem(AUTH_USER_ID_STORAGE_KEY, userId);
}

export function clearCurrentUserId(): void {
  if (typeof window === 'undefined') {
    return;
  }

  document.cookie = `${AUTH_USER_ID_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
  window.localStorage.removeItem(AUTH_USER_ID_STORAGE_KEY);
}
