/**
 * React hook for browser notifications
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import notificationService, { 
  type NotificationOptions,
  type NotificationPermissionState 
} from '@/lib/notifications/service';

interface UseNotificationOptions {
  requestOnMount?: boolean;
  onGranted?: () => void;
  onDenied?: () => void;
}

// Helper to get initial state synchronously
function getInitialState() {
  return {
    supported: notificationService.isSupported(),
    permission: notificationService.getPermissionState(),
  };
}

export function useNotifications(options: UseNotificationOptions = {}) {
  const { requestOnMount = false, onGranted, onDenied } = options;
  
  // Use lazy initialization to avoid setState in effect
  const [state, setState] = useState(() => getInitialState());
  const requestHandled = useRef(false);

  const requestPermission = useCallback(async () => {
    const granted = await notificationService.requestPermission();
    const newState = notificationService.getPermissionState();
    setState(prev => ({ ...prev, permission: newState }));
    
    if (granted) {
      onGranted?.();
    } else {
      onDenied?.();
    }
    
    return granted;
  }, [onGranted, onDenied]);

  // Handle requestOnMount - using a ref to prevent multiple calls
  useEffect(() => {
    if (requestOnMount && state.supported && state.permission.default && !requestHandled.current) {
      requestHandled.current = true;
      // Use setTimeout to defer the state update outside of the effect
      const timeout = setTimeout(() => {
        requestPermission();
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [requestOnMount, state.supported, state.permission.default, requestPermission]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const refreshPermissionState = () => {
      setState((prev) => ({
        ...prev,
        supported: notificationService.isSupported(),
        permission: notificationService.getPermissionState(),
      }));
    };

    window.addEventListener('focus', refreshPermissionState);
    document.addEventListener('visibilitychange', refreshPermissionState);

    return () => {
      window.removeEventListener('focus', refreshPermissionState);
      document.removeEventListener('visibilitychange', refreshPermissionState);
    };
  }, []);

  const show = useCallback(async (options: NotificationOptions) => {
    if (!state.supported || !state.permission.granted) {
      return null;
    }
    return notificationService.show(options);
  }, [state.supported, state.permission.granted]);

  const showMessage = useCallback(async (data: {
    conversationId: number;
    contactName: string | null;
    contactPhone: string;
    messageContent: string | null;
    messageType: string;
    onClick?: () => void;
  }) => {
    if (!state.supported || !state.permission.granted) {
      return null;
    }
    return notificationService.showMessageNotification(data);
  }, [state.supported, state.permission.granted]);

  const close = useCallback(async (tag: string) => {
    await notificationService.close(tag);
  }, []);

  const closeAll = useCallback(async () => {
    await notificationService.closeAll();
  }, []);

  return {
    supported: state.supported,
    permission: state.permission,
    requestPermission,
    show,
    showMessage,
    close,
    closeAll,
    isGranted: state.permission.granted,
    isDenied: state.permission.denied,
    isDefault: state.permission.default,
  };
}

export default useNotifications;
