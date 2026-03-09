export interface NotificationPreferences {
  newMessages: boolean;
  deliveryStatus: boolean;
  sound: boolean;
}

const STORAGE_KEY = 'whats91.notification.preferences';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  newMessages: true,
  deliveryStatus: true,
  sound: true,
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getNotificationPreferences(): NotificationPreferences {
  if (!isBrowser()) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    const parsed = JSON.parse(rawValue) as Partial<NotificationPreferences>;
    return {
      newMessages: parsed.newMessages ?? DEFAULT_NOTIFICATION_PREFERENCES.newMessages,
      deliveryStatus: parsed.deliveryStatus ?? DEFAULT_NOTIFICATION_PREFERENCES.deliveryStatus,
      sound: parsed.sound ?? DEFAULT_NOTIFICATION_PREFERENCES.sound,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function saveNotificationPreferences(
  preferences: NotificationPreferences
): NotificationPreferences {
  if (!isBrowser()) {
    return preferences;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  return preferences;
}

export function updateNotificationPreference(
  key: keyof NotificationPreferences,
  value: boolean
): NotificationPreferences {
  const nextPreferences = {
    ...getNotificationPreferences(),
    [key]: value,
  };

  return saveNotificationPreferences(nextPreferences);
}

export function getNotificationPreferencesStorageKey(): string {
  return STORAGE_KEY;
}
