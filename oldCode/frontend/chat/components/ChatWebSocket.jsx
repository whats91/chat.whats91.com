'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * WebSocket hook for WhatsApp Chat System
 * Handles real-time messaging, conversation updates, and message status changes
 */
export function useChatWebSocket(userId, onMessage, onNewConversation, onMessageStatusUpdate) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = () => {
    if (!userId) return;

    try {
      const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = process.env.NEXT_PUBLIC_API_URL?.replace(/^https?:\/\//, '') || 'localhost:3002';
      const wsUrl = `${wsProtocol}//${wsHost}?userId=${userId}`;
      
      console.log(`Connecting to WebSocket: ${wsUrl}`);
      
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        console.log('✅ Chat WebSocket connected');
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'new_message':
              onMessage && onMessage(data.message, data.conversation_id, data.type);
              break;
            case 'new_conversation':
              onNewConversation && onNewConversation(data.conversation);
              break;
            case 'message_status_update':
              onMessageStatusUpdate && onMessageStatusUpdate(data.message_id, data.status);
              break;
            case 'info':
              console.log('WebSocket info:', data.message);
              break;
            default:
              console.log('Unhandled WebSocket message:', data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      wsRef.current.onclose = (event) => {
        console.log('❌ Chat WebSocket disconnected', event.code, event.reason);
        setConnected(false);
        
        // Attempt to reconnect if not intentionally closed and under max attempts
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          
          console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          
          setTimeout(() => {
            if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
              connect();
            }
          }, delay);
        }
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection error');
        setConnected(false);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setError(error.message);
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent reconnection
      wsRef.current.close(1000, 'Component unmounted');
    }
  };

  const sendMessage = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected. Cannot send message:', message);
    }
  };

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [userId]);

  return {
    connected,
    error,
    connect,
    disconnect,
    sendMessage
  };
}

/**
 * ChatWebSocket Component
 * A wrapper component that provides WebSocket functionality to chat components
 */
export default function ChatWebSocket({ userId, children, onMessage, onNewConversation, onMessageStatusUpdate }) {
  const { connected, error } = useChatWebSocket(userId, onMessage, onNewConversation, onMessageStatusUpdate);

  return (
    <div className="relative">
      {/* WebSocket Status Indicator */}
      <div className="fixed top-4 right-4 z-50">
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
          connected 
            ? 'bg-green-100 text-green-800 border border-green-200' 
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          {connected ? 'Connected' : error ? 'Connection Error' : 'Disconnected'}
        </div>
      </div>
      
      {children}
    </div>
  );
}
