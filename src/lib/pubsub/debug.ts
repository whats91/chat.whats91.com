'use client';

const DEBUG_STORAGE_KEY = 'whats91.debug.pubsub';

export function isPubSubDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    process.env.NEXT_PUBLIC_DEBUG_PUBSUB === '1' ||
    window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1'
  );
}

export function debugPubSub(message: string, meta?: Record<string, unknown>): void {
  if (!isPubSubDebugEnabled()) {
    return;
  }

  if (meta) {
    console.log(`[PubSubDebug] ${message}`, meta);
    return;
  }

  console.log(`[PubSubDebug] ${message}`);
}

export function enablePubSubDebug(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(DEBUG_STORAGE_KEY, '1');
}

export function disablePubSubDebug(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(DEBUG_STORAGE_KEY);
}
