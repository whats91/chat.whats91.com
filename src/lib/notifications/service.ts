/**
 * Notification Service for Whats91 Chat
 * 
 * Cross-browser push notifications for incoming messages
 * Works on Windows, macOS, Linux, Android, iOS
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

// Store callbacks
const notificationCallbacks = new Map<string, NotificationCallback>();

/**
 * Check if notifications are supported
 */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
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
  
  try {
    const permission = await Notification.requestPermission();
    console.log('[Notification] Permission:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('[Notification] Permission request failed:', error);
    return false;
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
    // Check if we should use service worker (for PWA)
    if (isServiceWorkerSupported() && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      
      await registration.showNotification(options.title, {
        body: options.body,
        icon: options.icon || '/icon-192x192.png',
        badge: options.badge || '/badge-72x72.png',
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction,
        silent: options.silent,
        vibrate: options.vibrate || [200, 100, 200],
        actions: options.actions,
      });
      
      return null; // Service worker handles the notification
    }
    
    // Fall back to regular notification
    const notification = new Notification(options.title, {
      body: options.body,
      icon: options.icon || '/icon-192x192.png',
      tag: options.tag,
      data: options.data,
      requireInteraction: options.requireInteraction,
      silent: options.silent,
    });
    
    // Handle click
    notification.onclick = () => {
      const callback = options.tag ? notificationCallbacks.get(options.tag) : null;
      if (callback) {
        callback(notification);
      }
      
      // Focus window
      window.focus();
      notification.close();
    };
    
    // Handle close
    notification.onclose = () => {
      if (options.tag) {
        notificationCallbacks.delete(options.tag);
      }
    };
    
    return notification;
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
  onClick?: () => void;
}): Promise<Notification | null> {
  const { conversationId, contactName, contactPhone, messageContent, messageType, onClick } = data;
  
  // Get preview text
  const previewText = getPreviewText(messageType, messageContent);
  
  // Register callback
  if (onClick) {
    notificationCallbacks.set(`conv-${conversationId}`, () => onClick());
  }
  
  return show({
    title: contactName || `+${contactPhone}`,
    body: previewText,
    tag: `conv-${conversationId}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    data: {
      conversationId,
      type: 'message',
    },
    actions: [
      { action: 'reply', title: 'Reply' },
      { action: 'mark-read', title: 'Mark as Read' },
    ],
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
  isServiceWorkerSupported,
  getPermissionState,
  requestPermission,
  show,
  showMessageNotification,
  showStatusNotification,
  close,
  closeAll,
  init,
};

export default notificationService;
