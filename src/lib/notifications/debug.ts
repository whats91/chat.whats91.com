import notificationService from '@/lib/notifications/service';

const DEBUG_STORAGE_KEY = 'whats91.debug.notifications';

function shouldLog(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const storedValue = window.localStorage.getItem(DEBUG_STORAGE_KEY);
  return storedValue !== '0';
}

export function debugNotification(message: string, details?: unknown): void {
  if (!shouldLog()) {
    return;
  }

  if (details) {
    console.info('[NotificationDebug]', message, details);
    return;
  }

  console.info('[NotificationDebug]', message);
}

export interface NotificationEnvironmentSnapshot {
  supported: boolean;
  secureContext: boolean;
  permission: ReturnType<typeof notificationService.getPermissionState>;
  serviceWorkerSupported: boolean;
  serviceWorkerController: boolean;
  serviceWorkerScope: string | null;
  serviceWorkerState: string | null;
  pushManagerSupported: boolean;
  pushSubscription: boolean;
  displayMode: string;
  permissionsApiState: string | null;
}

export async function collectNotificationEnvironmentSnapshot(): Promise<NotificationEnvironmentSnapshot> {
  const supported = notificationService.isSupported();
  const secureContext = notificationService.isSecureNotificationContext();
  const permission = notificationService.getPermissionState();
  const serviceWorkerSupported = notificationService.isServiceWorkerSupported();

  let serviceWorkerController = false;
  let serviceWorkerScope: string | null = null;
  let serviceWorkerState: string | null = null;
  let pushSubscription = false;

  if (serviceWorkerSupported) {
    serviceWorkerController = Boolean(navigator.serviceWorker.controller);

    try {
      const registration = await navigator.serviceWorker.ready;
      serviceWorkerScope = registration.scope;
      serviceWorkerState =
        registration.active?.state ||
        registration.installing?.state ||
        registration.waiting?.state ||
        null;

      if ('pushManager' in registration) {
        const existingSubscription = await registration.pushManager.getSubscription();
        pushSubscription = Boolean(existingSubscription);
      }
    } catch (error) {
      debugNotification('Failed to inspect service worker readiness', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let permissionsApiState: string | null = null;
  if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
    try {
      const status = await navigator.permissions.query({
        name: 'notifications' as PermissionName,
      });
      permissionsApiState = status.state;
    } catch {
      permissionsApiState = null;
    }
  }

  const displayMode =
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
      ? 'standalone'
      : 'browser';

  return {
    supported,
    secureContext,
    permission,
    serviceWorkerSupported,
    serviceWorkerController,
    serviceWorkerScope,
    serviceWorkerState,
    pushManagerSupported: typeof window !== 'undefined' && 'PushManager' in window,
    pushSubscription,
    displayMode,
    permissionsApiState,
  };
}
