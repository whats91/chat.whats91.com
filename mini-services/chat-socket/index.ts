/**
 * Whats91 Chat Socket.io Service
 * 
 * Real-time pub/sub service for chat messages
 * Port: 3003
 * 
 * Events:
 * - conversation:selected - User selects a conversation
 * - message:new - New message received
 * - message:status - Message status update
 * - conversation:update - Conversation metadata update
 * - typing:start - User started typing
 * - typing:stop - User stopped typing
 */

import { Server } from 'socket.io';

const PORT = 3003;

// Store connected users and their rooms
const userRooms = new Map<string, Set<string>>();

const io = new Server(PORT, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

console.log(`[ChatSocket] Server started on port ${PORT}`);

io.on('connection', (socket) => {
  console.log(`[ChatSocket] Client connected: ${socket.id}`);

  // User authentication/join
  socket.on('user:join', (data: { userId: string; userName?: string }) => {
    const { userId, userName } = data;
    
    // Join user's personal room
    socket.join(`user:${userId}`);
    
    // Track user rooms
    if (!userRooms.has(userId)) {
      userRooms.set(userId, new Set());
    }
    userRooms.get(userId)!.add(socket.id);
    
    console.log(`[ChatSocket] User joined: ${userId} (${userName || 'Unknown'})`);
    
    // Send acknowledgment
    socket.emit('user:joined', { 
      success: true, 
      userId,
      message: 'Connected to chat service' 
    });
  });

  // Subscribe to conversation updates
  socket.on('conversation:subscribe', (data: { conversationId: string }) => {
    const { conversationId } = data;
    socket.join(`conversation:${conversationId}`);
    console.log(`[ChatSocket] Subscribed to conversation: ${conversationId}`);
  });

  // Unsubscribe from conversation
  socket.on('conversation:unsubscribe', (data: { conversationId: string }) => {
    const { conversationId } = data;
    socket.leave(`conversation:${conversationId}`);
    console.log(`[ChatSocket] Unsubscribed from conversation: ${conversationId}`);
  });

  // Handle new message from webhook/backend
  socket.on('message:new', (data: {
    userId: string;
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
  }) => {
    const { userId, conversationId, message, conversation } = data;
    
    console.log(`[ChatSocket] New message for user ${userId}:`, message.whatsappMessageId);
    
    // Emit to user's room
    io.to(`user:${userId}`).emit('message:new', {
      conversationId,
      message,
      conversation,
    });
    
    // Also emit to conversation room if anyone is viewing
    io.to(`conversation:${conversationId}`).emit('message:received', {
      message,
    });
  });

  // Handle message status update
  socket.on('message:status', (data: {
    userId: string;
    messageId: string;
    conversationId: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
    errorCode?: string;
    errorMessage?: string;
  }) => {
    const { userId, messageId, conversationId, status, errorCode, errorMessage } = data;
    
    console.log(`[ChatSocket] Message status update: ${messageId} -> ${status}`);
    
    io.to(`user:${userId}`).emit('message:status', {
      messageId,
      conversationId,
      status,
      errorCode,
      errorMessage,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle typing indicator
  socket.on('typing:start', (data: { conversationId: number; userId: string }) => {
    socket.to(`conversation:${data.conversationId}`).emit('typing:start', {
      conversationId: data.conversationId,
      userId: data.userId,
    });
  });

  socket.on('typing:stop', (data: { conversationId: number; userId: string }) => {
    socket.to(`conversation:${data.conversationId}`).emit('typing:stop', {
      conversationId: data.conversationId,
      userId: data.userId,
    });
  });

  // Handle conversation update (read, archive, pin, etc.)
  socket.on('conversation:update', (data: {
    userId: string;
    conversationId: number;
    updates: Record<string, unknown>;
  }) => {
    const { userId, conversationId, updates } = data;
    
    io.to(`user:${userId}`).emit('conversation:update', {
      conversationId,
      updates,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle read status
  socket.on('conversation:read', (data: { 
    userId: string;
    conversationId: number;
  }) => {
    io.to(`user:${userId}`).emit('conversation:read', {
      conversationId,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`[ChatSocket] Client disconnected: ${socket.id}`);
    
    // Clean up user rooms tracking
    for (const [userId, sockets] of userRooms) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userRooms.delete(userId);
        }
      }
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`[ChatSocket] Socket error:`, error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[ChatSocket] SIGTERM received, shutting down...');
  io.close(() => {
    console.log('[ChatSocket] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[ChatSocket] SIGINT received, shutting down...');
  io.close(() => {
    console.log('[ChatSocket] Server closed');
    process.exit(0);
  });
});

export { io };
