/**
 * Notification Service for Whats91 Chat
 * 
 * Cross-browser push notifications for incoming messages
 * Works on Windows, macOS, Linux, Android, iOS
 *
 * Dependency note:
 * Notification behavior changes here must stay aligned with:
 * - public/sw.js
 * - src/lib/notifications/preferences.ts
 * - src/hooks/use-notifications.ts
 * - src/components/shell/AppShell.tsx
 * - src/app/settings/page.tsx
 */

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  silent?: boolean;
  vibrate?: number | number[];
  renotify?: boolean;
  timestamp?: number;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

export interface NotificationPermissionState {
  granted: boolean;
  denied: boolean;
  default: boolean;
}

type NotificationCallback = (notification: Notification, action?: string) => void;

type ServiceWorkerNotificationOptions = globalThis.NotificationOptions & {
  badge?: string;
  vibrate?: number | number[];
  renotify?: boolean;
  timestamp?: number;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
};

// Store callbacks
const notificationCallbacks = new Map<string, NotificationCallback>();

/**
 * Check if notifications are supported
 */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isSecureNotificationContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

/**
 * Check if service worker is supported
 */
export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Get current permission state
 */
export function getPermissionState(): NotificationPermissionState {
  if (!isSupported()) {
    return { granted: false, denied: true, default: false };
  }
  
  const permission = Notification.permission;
  return {
    granted: permission === 'granted',
    denied: permission === 'denied',
    default: permission === 'default',
  };
}

/**
 * Request notification permission
 */
export async function requestPermission(): Promise<boolean> {
  if (!isSupported()) {
    console.warn('[Notification] Not supported in this browser');
    return false;
  }

  if (!isSecureNotificationContext()) {
    console.warn('[Notification] Secure context is required for browser notifications');
    return false;
  }
  
  try {
    const permission = await new Promise<NotificationPermission>((resolve, reject) => {
      try {
        const maybePromise = Notification.requestPermission((result) => {
          resolve(result);
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
    console.log('[Notification] Permission:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('[Notification] Permission request failed:', error);
    return false;
  }
}

function registerNotificationCallback(
  tag: string | undefined,
  callback: NotificationCallback | undefined
): void {
  if (tag && callback) {
    notificationCallbacks.set(tag, callback);
  }
}

function attachNativeNotificationHandlers(
  notification: Notification,
  tag: string | undefined
): Notification {
  notification.onclick = () => {
    const callback = tag ? notificationCallbacks.get(tag) : null;
    if (callback) {
      callback(notification);
    }

    window.focus();
    notification.close();
  };

  notification.onclose = () => {
    if (tag) {
      notificationCallbacks.delete(tag);
    }
  };

  return notification;
}

function tryShowNativeNotification(options: NotificationOptions): Notification | null {
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      icon: options.icon || '/icons/icon-192x192.png',
      tag: options.tag,
      data: options.data,
      requireInteraction: options.requireInteraction,
      silent: options.silent,
    });

    return attachNativeNotificationHandlers(notification, options.tag);
  } catch (error) {
    console.warn('[Notification] Native Notification API failed, falling back to service worker', error);
    return null;
  }
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    return null;
  }

  try {
    const existingRegistration =
      (await navigator.serviceWorker.getRegistration('/')) ||
      (await navigator.serviceWorker.getRegistration());

    if (existingRegistration) {
      return existingRegistration;
    }

    const readyRegistration = await Promise.race<
      ServiceWorkerRegistration | null
    >([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 1500);
      }),
    ]);

    return readyRegistration;
  } catch (error) {
    console.warn('[Notification] Service worker registration lookup failed', error);
    return null;
  }
}

/**
 * Show a notification
 */
export async function show(options: NotificationOptions): Promise<Notification | null> {
  if (!isSupported()) {
    console.warn('[Notification] Not supported');
    return null;
  }
  
  const permission = getPermissionState();
  if (!permission.granted) {
    console.warn('[Notification] Permission not granted');
    return null;
  }
  
  try {
    const registration = await getServiceWorkerRegistration();
    if (registration) {
      try {
        const notificationOptions: ServiceWorkerNotificationOptions = {
          body: options.body,
          icon: options.icon || '/icons/icon-192x192.png',
          badge: options.badge || '/icons/icon-192x192.png',
          tag: options.tag,
          data: options.data,
          requireInteraction: options.requireInteraction,
          silent: options.silent,
          vibrate: options.vibrate || [200, 100, 200],
          renotify: options.renotify,
          timestamp: options.timestamp,
          actions: options.actions,
        };

        await registration.showNotification(options.title, notificationOptions);
        return null;
      } catch (error) {
        console.warn('[Notification] Service worker notification failed, falling back to native API', error);
      }
    }

    const nativeNotification = tryShowNativeNotification(options);
    if (nativeNotification) {
      return nativeNotification;
    }

    return null;
  } catch (error) {
    console.error('[Notification] Failed to show:', error);
    return null;
  }
}

/**
 * Show message notification
 */
export async function showMessageNotification(data: {
  conversationId: number;
  contactName: string | null;
  contactPhone: string;
  messageContent: string | null;
  messageType: string;
  icon?: string | null;
  silent?: boolean;
  onClick?: () => void;
}): Promise<Notification | null> {
  const { conversationId, contactName, contactPhone, messageContent, messageType, icon, silent, onClick } = data;
  
  // Get preview text
  const previewText = getPreviewText(messageType, messageContent);
  
  // Register callback
  registerNotificationCallback(
    `conv-${conversationId}`,
    onClick ? () => onClick() : undefined
  );
  
  return show({
    title: contactName || `+${contactPhone}`,
    body: previewText,
    tag: `conv-${conversationId}`,
    icon: icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    requireInteraction: false,
    silent: silent ?? false,
    vibrate: [200, 100, 200],
    renotify: true,
    timestamp: Date.now(),
    data: {
      conversationId,
      contactName,
      contactPhone,
      type: 'message',
    },
    actions: [
      { action: 'open', title: 'Open chat' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  });
}

export async function showPermissionGrantedNotification(): Promise<Notification | null> {
  return show({
    title: 'Notifications enabled',
    body: 'You will now receive live message alerts in Whats91.',
    tag: 'notifications-enabled',
    silent: true,
    icon: '/icons/icon-192x192.png',
  });
}

/**
 * Show status notification
 */
export async function showStatusNotification(data: {
  messageId: string;
  conversationId: number;
  contactName: string | null;
  status: string;
}): Promise<Notification | null> {
  const { contactName, status } = data;
  
  // Only notify for important statuses
  if (!['read', 'failed'].includes(status)) {
    return null;
  }
  
  const title = status === 'read' 
    ? `✓✓ Message read by ${contactName || 'Contact'}`
    : `⚠️ Message failed to send`;
  
  return show({
    title,
    body: status === 'failed' ? 'Tap to retry' : '',
    tag: `status-${data.messageId}`,
    silent: true,
    requireInteraction: false,
  });
}

/**
 * Close notification by tag
 */
export async function close(tag: string): Promise<void> {
  if (!isSupported()) return;
  
  if (isServiceWorkerSupported()) {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications({ tag });
    notifications.forEach(n => n.close());
  }
  
  notificationCallbacks.delete(tag);
}

/**
 * Close all notifications
 */
export async function closeAll(): Promise<void> {
  if (!isSupported()) return;
  
  if (isServiceWorkerSupported()) {
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications();
    notifications.forEach(n => n.close());
  }
  
  notificationCallbacks.clear();
}

/**
 * Get preview text for message
 */
function getPreviewText(messageType: string, content: string | null): string {
  if (content) return content.substring(0, 100);
  
  const previews: Record<string, string> = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎵 Audio',
    document: '📄 Document',
    location: '📍 Location',
    contacts: '👤 Contact',
    sticker: '😀 Sticker',
    interactive: '💬 Interactive Message',
    template: '📝 Template Message',
    button: '🔘 Button',
    reaction: '👍 Reaction',
  };
  
  return previews[messageType] || 'New message';
}

/**
 * Initialize notification service
 */
export async function init(): Promise<boolean> {
  if (!isSupported()) {
    console.warn('[Notification] Not supported in this browser');
    return false;
  }
  
  // Check permission state
  const state = getPermissionState();
  
  if (state.granted) {
    console.log('[Notification] Permission already granted');
    return true;
  }
  
  if (state.denied) {
    console.warn('[Notification] Permission denied by user');
    return false;
  }
  
  // Don't auto-request - let user initiate
  console.log('[Notification] Permission not yet requested');
  return false;
}

// Export notification service
export const notificationService = {
  isSupported,
  isSecureNotificationContext,
  isServiceWorkerSupported,
  getPermissionState,
  requestPermission,
  show,
  showMessageNotification,
  showStatusNotification,
  showPermissionGrantedNotification,
  close,
  closeAll,
  init,
};

export default notificationService;
