'use client';

/**
 * Dependency note:
 * Fallback avatar changes here should stay aligned with:
 * - src/components/chat/ChatList.tsx
 * - src/components/chat/ConversationView.tsx
 * - src/components/chat/RightInfoPanel.tsx
 */

import { useEffect, useMemo, useState } from 'react';

const SESSION_SEED_STORAGE_KEY = 'whats91.session.avatar-seed';
const FALLBACK_AVATAR_PATHS = [
  '/avatar/9434619.jpg',
  '/avatar/9434650.jpg',
  '/avatar/9439678.jpg',
  '/avatar/9439682.jpg',
  '/avatar/9439726.jpg',
  '/avatar/9720016.jpg',
] as const;

function readOrCreateSessionSeed(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const existingSeed = window.sessionStorage.getItem(SESSION_SEED_STORAGE_KEY);
  if (existingSeed) {
    return existingSeed;
  }

  const nextSeed =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.sessionStorage.setItem(SESSION_SEED_STORAGE_KEY, nextSeed);
  return nextSeed;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function resolveFallbackAvatarPath(stableKey: string): string | null {
  if (!stableKey) {
    return null;
  }

  const sessionSeed = readOrCreateSessionSeed();
  if (!sessionSeed) {
    return null;
  }

  const hash = hashString(`${sessionSeed}:${stableKey}`);
  return FALLBACK_AVATAR_PATHS[hash % FALLBACK_AVATAR_PATHS.length] || null;
}

export function useConversationAvatar(
  primarySrc: string | null | undefined,
  stableKey: string
): string | undefined {
  const normalizedPrimarySrc = primarySrc?.trim() || '';
  const normalizedStableKey = stableKey.trim();
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);

  useEffect(() => {
    if (normalizedPrimarySrc) {
      setFallbackSrc(null);
      return;
    }

    setFallbackSrc(resolveFallbackAvatarPath(normalizedStableKey));
  }, [normalizedPrimarySrc, normalizedStableKey]);

  return useMemo(() => {
    if (normalizedPrimarySrc) {
      return normalizedPrimarySrc;
    }

    return fallbackSrc || undefined;
  }, [fallbackSrc, normalizedPrimarySrc]);
}
