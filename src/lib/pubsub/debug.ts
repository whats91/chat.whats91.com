'use client';

const DEBUG_STORAGE_KEY = 'whats91.debug.pubsub';

function stringifyPubSubPayload(payload: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    payload,
    (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }

      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      return value;
    },
    2
  );
}

export function isPubSubDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const explicitToggle = window.localStorage.getItem(DEBUG_STORAGE_KEY);
  if (explicitToggle === '0') {
    return false;
  }

  if (explicitToggle === '1') {
    return true;
  }

  return true;
}

export function debugPubSub(_message: string, _meta?: Record<string, unknown>): void {
  // Frontend pub/sub debugging is intentionally reduced to a single payload log.
}

export function logPubSubPayload(payload: unknown): void {
  if (!isPubSubDebugEnabled()) {
    return;
  }

  try {
    console.log('[PubSubDebug] Incoming payload', stringifyPubSubPayload(payload));
  } catch (error) {
    console.log('[PubSubDebug] Incoming payload', {
      serializationError: error instanceof Error ? error.message : String(error),
      payload,
    });
  }
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
