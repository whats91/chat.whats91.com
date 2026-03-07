/**
 * React hook for Socket.io connection
 */

'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { 
  initSocket, 
  disconnectSocket, 
  on, 
  off, 
  type SocketEvents 
} from '@/lib/socket/client';

interface UseSocketOptions {
  userId: string;
  autoConnect?: boolean;
  onMessage?: (data: SocketEvents['message:new']) => void;
  onStatus?: (data: SocketEvents['message:status']) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useSocket(options: UseSocketOptions) {
  const { userId, autoConnect = true, onMessage, onStatus, onConnect, onDisconnect } = options;
  const [connected, setConnected] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!autoConnect || !userId || initialized.current) return;
    
    initialized.current = true;
    
    // Initialize socket
    initSocket(userId);
    
    // Connection handlers
    const handleConnect = () => {
      setConnected(true);
      onConnect?.();
    };
    
    const handleDisconnect = () => {
      setConnected(false);
      onDisconnect?.();
    };

    // Set up listeners
    on('user:joined' as keyof SocketEvents, handleConnect as () => void);
    
    // Message handler
    if (onMessage) {
      on('message:new', onMessage);
    }
    
    // Status handler
    if (onStatus) {
      on('message:status', onStatus);
    }
    
    return () => {
      off('user:joined' as keyof SocketEvents, handleConnect as () => void);
      if (onMessage) off('message:new', onMessage);
      if (onStatus) off('message:status', onStatus);
    };
  }, [userId, autoConnect, onMessage, onStatus, onConnect, onDisconnect]);

  const reconnect = useCallback(() => {
    if (userId) {
      disconnectSocket();
      initSocket(userId);
    }
  }, [userId]);

  const disconnect = useCallback(() => {
    disconnectSocket();
    setConnected(false);
  }, []);

  return {
    connected,
    reconnect,
    disconnect,
  };
}

export default useSocket;
