/**
 * Socket.io Client for Whats91 Chat
 * 
 * Manages WebSocket connection for real-time messaging
 * Client-side only
 */

'use client';

// Socket type - use any for SSR compatibility
type Socket = unknown;

// Socket instance
let socket: Socket | null = null;

// Event handlers type
type EventHandler<T = unknown> = (data: T) => void;

// Event types
export interface SocketEvents {
  'user:joined': { success: boolean; userId: string; message: string };
  'message:new': {
    conversationId: number;
    message: {
      id: number;
      whatsappMessageId: string;
      direction: 'inbound' | 'outbound';
      messageType: string;
      messageContent: string | null;
      status: string;
      timestamp: string;
      mediaUrl?: string | null;
    };
    conversation: {
      id: number;
      contactPhone: string;
      contactName: string | null;
    };
  };
  'message:received': {
    message: Record<string, unknown>;
  };
  'message:status': {
    messageId: string;
    conversationId: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    errorCode?: string;
    errorMessage?: string;
    timestamp: string;
  };
  'conversation:update': {
    conversationId: number;
    updates: Record<string, unknown>;
    timestamp: string;
  };
  'conversation:read': {
    conversationId: number;
    timestamp: string;
  };
  'typing:start': {
    conversationId: number;
    userId: string;
  };
  'typing:stop': {
    conversationId: number;
    userId: string;
  };
}

/**
 * Initialize socket connection
 */
export async function initSocket(userId: string): Promise<Socket | null> {
  if (typeof window === 'undefined') {
    return null; // Server-side, don't initialize
  }

  // Dynamic import for client-side only
  const { io } = await import('socket.io-client');

  // Connect with XTransformPort for gateway routing
  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
  }) as Socket;

  // Connection events
  const socketInstance = socket as Awaited<ReturnType<typeof io>>;
  
  socketInstance.on('connect', () => {
    console.log('[Socket] Connected:', socketInstance.id);
    // Join user room
    socketInstance.emit('user:join', { userId });
  });

  socketInstance.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socketInstance.on('connect_error', (error) => {
    console.error('[Socket] Connection error:', error.message);
  });

  socketInstance.on('reconnect', (attemptNumber) => {
    console.log('[Socket] Reconnected after', attemptNumber, 'attempts');
    // Re-join user room
    socketInstance.emit('user:join', { userId });
  });

  return socket;
}

/**
 * Get socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnect socket
 */
export function disconnectSocket(): void {
  if (socket && typeof window !== 'undefined') {
    const socketInstance = socket as { disconnect: () => void };
    socketInstance.disconnect();
    socket = null;
  }
}

/**
 * Subscribe to conversation updates
 */
export function subscribeToConversation(conversationId: string | number): void {
  if (socket) {
    const socketInstance = socket as { emit: (event: string, data: unknown) => void };
    socketInstance.emit('conversation:subscribe', { conversationId });
  }
}

/**
 * Unsubscribe from conversation
 */
export function unsubscribeFromConversation(conversationId: string | number): void {
  if (socket) {
    const socketInstance = socket as { emit: (event: string, data: unknown) => void };
    socketInstance.emit('conversation:unsubscribe', { conversationId });
  }
}

/**
 * Start typing indicator
 */
export function startTyping(conversationId: string | number, userId: string): void {
  if (socket) {
    const socketInstance = socket as { emit: (event: string, data: unknown) => void };
    socketInstance.emit('typing:start', { conversationId, userId });
  }
}

/**
 * Stop typing indicator
 */
export function stopTyping(conversationId: string | number, userId: string): void {
  if (socket) {
    const socketInstance = socket as { emit: (event: string, data: unknown) => void };
    socketInstance.emit('typing:stop', { conversationId, userId });
  }
}

/**
 * Notify conversation read
 */
export function notifyRead(conversationId: string | number, userId: string): void {
  if (socket) {
    const socketInstance = socket as { emit: (event: string, data: unknown) => void };
    socketInstance.emit('conversation:read', { conversationId, userId });
  }
}

/**
 * Subscribe to socket events with type safety
 */
export function on<K extends keyof SocketEvents>(
  event: K,
  handler: EventHandler<SocketEvents[K]>
): void {
  if (socket && typeof window !== 'undefined') {
    const socketInstance = socket as { on: (event: string, handler: EventHandler) => void };
    socketInstance.on(event, handler as EventHandler);
  }
}

/**
 * Unsubscribe from socket events
 */
export function off<K extends keyof SocketEvents>(
  event: K,
  handler?: EventHandler<SocketEvents[K]>
): void {
  if (socket && typeof window !== 'undefined') {
    const socketInstance = socket as { 
      off: (event: string, handler?: EventHandler) => void 
    };
    if (handler) {
      socketInstance.off(event, handler as EventHandler);
    } else {
      socketInstance.off(event);
    }
  }
}

/**
 * Check if socket is connected
 */
export function isConnected(): boolean {
  if (typeof window === 'undefined' || !socket) {
    return false;
  }
  const socketInstance = socket as { connected: boolean };
  return socketInstance.connected ?? false;
}

// Export socket client
export const socketClient = {
  init: initSocket,
  get: getSocket,
  disconnect: disconnectSocket,
  subscribe: subscribeToConversation,
  unsubscribe: unsubscribeFromConversation,
  startTyping,
  stopTyping,
  notifyRead,
  on,
  off,
  isConnected,
};

export default socketClient;
