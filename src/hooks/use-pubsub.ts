'use client';

import { useEffect, useRef } from 'react';
import PubSubClient from '@/lib/pubsub/client';
import { debugPubSub } from '@/lib/pubsub/debug';
import type { PubSubClientPayload } from '@/lib/types/pubsub';

interface UsePubSubOptions {
  userId: string;
  autoConnect?: boolean;
  onMessage?: (payload: PubSubClientPayload) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function usePubSub({
  userId,
  autoConnect = true,
  onMessage,
  onConnectionChange,
}: UsePubSubOptions) {
  const clientRef = useRef<PubSubClient | null>(null);
  const messageHandlerRef = useRef<typeof onMessage>(onMessage);
  const connectionHandlerRef = useRef<typeof onConnectionChange>(onConnectionChange);

  useEffect(() => {
    messageHandlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    connectionHandlerRef.current = onConnectionChange;
  }, [onConnectionChange]);

  useEffect(() => {
    if (!autoConnect || !userId) {
      debugPubSub('usePubSub skipped auto-connect', {
        autoConnect,
        hasUserId: Boolean(userId),
      });
      return;
    }

    const client = new PubSubClient();
    clientRef.current = client;
    debugPubSub('usePubSub starting client', {
      userId,
      channel: `conversations-${userId}`,
    });

    const handleMessage = (payload: PubSubClientPayload) => {
      debugPubSub('usePubSub received payload from client', {
        userId,
        payloadType: payload.type,
        payload,
      });
      messageHandlerRef.current?.(payload);
    };
    const handleConnectionChange = (connected: boolean) => {
      debugPubSub('usePubSub connection changed', {
        userId,
        connected,
      });
      connectionHandlerRef.current?.(connected);
    };

    client.onMessage(handleMessage);
    client.onConnectionChange(handleConnectionChange);
    client.connect();
    client.subscribe(`conversations-${userId}`);

    return () => {
      debugPubSub('usePubSub cleaning up client', {
        userId,
      });
      client.offMessage(handleMessage);
      client.offConnectionChange(handleConnectionChange);
      client.disconnect();
      clientRef.current = null;
    };
  }, [autoConnect, userId]);

  return {
    getStatus: () => clientRef.current?.getStatus() ?? null,
    disconnect: () => clientRef.current?.disconnect(),
  };
}

export default usePubSub;
