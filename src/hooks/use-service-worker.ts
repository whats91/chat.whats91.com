/**
 * Service Worker Registration Hook
 */

'use client';

import { useEffect, useState, useCallback } from 'react';

interface ServiceWorkerState {
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
  error: Error | null;
}

interface UseServiceWorkerOptions {
  registerOnMount?: boolean;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
}

export function useServiceWorker(options: UseServiceWorkerOptions = {}) {
  const { registerOnMount = true, onUpdate, onSuccess } = options;
  
  const [state, setState] = useState<ServiceWorkerState>({
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
    error: null,
  });

  const register = useCallback(async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('[SW] Service workers not supported');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      console.log('[SW] Service worker registered:', registration.scope);

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available
              setState((prev) => ({ ...prev, isUpdateAvailable: true }));
              onUpdate?.(registration);
            } else if (newWorker.state === 'installed' && !navigator.serviceWorker.controller) {
              // Content is cached for the first time
              onSuccess?.(registration);
            }
          });
        }
      });

      setState({
        isRegistered: true,
        isUpdateAvailable: false,
        registration,
        error: null,
      });

      return registration;
    } catch (error) {
      console.error('[SW] Registration failed:', error);
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }));
      return null;
    }
  }, [onUpdate, onSuccess]);

  const update = useCallback(async () => {
    if (state.registration) {
      try {
        await state.registration.update();
      } catch (error) {
        console.error('[SW] Update failed:', error);
      }
    }
  }, [state.registration]);

  const unregister = useCallback(async () => {
    if (state.registration) {
      const success = await state.registration.unregister();
      if (success) {
        setState({
          isRegistered: false,
          isUpdateAvailable: false,
          registration: null,
          error: null,
        });
      }
      return success;
    }
    return false;
  }, [state.registration]);

  const skipWaiting = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }, [state.registration]);

  useEffect(() => {
    if (registerOnMount) {
      register();
    }
  }, [registerOnMount, register]);

  // Handle controller change (new SW activated)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleControllerChange = () => {
      console.log('[SW] Controller changed, reloading...');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return {
    ...state,
    register,
    update,
    unregister,
    skipWaiting,
  };
}

export default useServiceWorker;
