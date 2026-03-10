'use client';

// Dependency note:
// Browser pub/sub transport changes here must stay aligned with:
// - src/lib/types/pubsub.ts
// - src/hooks/use-pubsub.ts
// - src/components/shell/AppShell.tsx
// - src/server/pubsub/pubsub-service.ts

import type {
  PubSubClientPayload,
  PubSubTransportEnvelope,
} from '@/lib/types/pubsub';
import { debugPubSub } from '@/lib/pubsub/debug';

type MessageEnvelope = Extract<PubSubTransportEnvelope, { type: 'message' }>;
type MessageHandler = (
  payload: PubSubClientPayload,
  envelope: MessageEnvelope
) => void;
type ConnectionHandler = (connected: boolean) => void;

interface PubSubClientConfig {
  url?: string;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

const DEFAULT_PUBSUB_URL = 'wss://pubsub-service.botmastersender.com';

class PubSubClient {
  private readonly baseUrl: string;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private ws: WebSocket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private subscribedChannel: string | null = null;
  private shouldReconnect = true;
  private isConnected = false;
  private clientId: string | null = null;
  private subscriberId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;

  constructor(config: PubSubClientConfig = {}) {
    this.baseUrl =
      config.url || process.env.NEXT_PUBLIC_PUBSUB_URL || DEFAULT_PUBSUB_URL;
    this.reconnectDelay = config.reconnectDelay ?? 2000;
    this.maxReconnectDelay = config.maxReconnectDelay ?? 30000;

    debugPubSub('PubSub client initialized', {
      configuredUrl: this.baseUrl,
      reconnectDelay: this.reconnectDelay,
      maxReconnectDelay: this.maxReconnectDelay,
    });
  }

  private resolveSocketUrl(): string {
    if (typeof window === 'undefined') {
      return this.baseUrl;
    }

    try {
      const url = new URL(this.baseUrl, window.location.origin);
      if (url.protocol === 'http:') {
        url.protocol = 'ws:';
      } else if (url.protocol === 'https:') {
        url.protocol = 'wss:';
      }
      debugPubSub('Resolved PubSub socket URL', {
        inputUrl: this.baseUrl,
        resolvedUrl: url.toString(),
      });
      return url.toString();
    } catch {
      debugPubSub('Falling back to raw PubSub socket URL', {
        inputUrl: this.baseUrl,
      });
      return this.baseUrl;
    }
  }

  private emitConnection(connected: boolean): void {
    this.connectionHandlers.forEach((handler) => {
      try {
        handler(connected);
      } catch (error) {
        console.error('[PubSub] Connection handler error:', error);
      }
    });
  }

  private handleEnvelope(envelope: PubSubTransportEnvelope): void {
    switch (envelope.type) {
      case 'connected':
        this.clientId = envelope.clientId || null;
        debugPubSub('PubSub connected envelope received', {
          clientId: this.clientId,
        });
        break;
      case 'subscribed':
        this.subscriberId = envelope.subscriberId;
        debugPubSub('PubSub subscribed envelope received', {
          channel: envelope.channel,
          subscriberId: envelope.subscriberId,
        });
        break;
      case 'message':
        debugPubSub('PubSub message envelope ready for handlers', {
          envelope,
          payload: envelope.payload,
        });
        this.messageHandlers.forEach((handler) => {
          try {
            handler(envelope.payload, envelope);
          } catch (error) {
            console.error('[PubSub] Message handler error:', error);
          }
        });
        break;
      case 'error':
        console.error('[PubSub] Server error:', envelope.message);
        break;
      default:
        break;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect || typeof window === 'undefined') {
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    debugPubSub('Scheduling PubSub reconnect', {
      delay,
      reconnectAttempts: this.reconnectAttempts,
      channel: this.subscribedChannel,
    });

    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  connect(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      debugPubSub('Skipped connect because WebSocket is already active', {
        channel: this.subscribedChannel,
        readyState: this.ws.readyState,
      });
      return;
    }

    this.shouldReconnect = true;
    this.clearReconnectTimer();
    this.closeSocket();

    const socketUrl = this.resolveSocketUrl();
    debugPubSub('Opening WebSocket connection', {
      socketUrl,
      channel: this.subscribedChannel,
      reconnectAttempts: this.reconnectAttempts,
    });

    const ws = new WebSocket(socketUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      debugPubSub('WebSocket opened', {
        channel: this.subscribedChannel,
        socketUrl,
      });
      this.emitConnection(true);

      if (this.subscribedChannel) {
        debugPubSub('Re-sending subscription after connect', {
          channel: this.subscribedChannel,
        });
        this.subscribe(this.subscribedChannel);
      }
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as PubSubTransportEnvelope;
        debugPubSub('WebSocket message received', {
          channel: this.subscribedChannel,
          envelopeType: envelope.type,
          rawData: event.data,
          envelope,
        });
        this.handleEnvelope(envelope);
      } catch (error) {
        console.error('[PubSub] Failed to parse envelope:', error);
      }
    };

    ws.onclose = (event) => {
      this.isConnected = false;
      this.clientId = null;
      this.subscriberId = null;
      debugPubSub('WebSocket closed', {
        channel: this.subscribedChannel,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.emitConnection(false);

      if (this.shouldReconnect) {
        this.attemptReconnect();
      }
    };

    ws.onerror = (event) => {
      debugPubSub('WebSocket error fired', {
        channel: this.subscribedChannel,
        event,
      });
    };
  }

  subscribe(channel: string): void {
    this.subscribedChannel = channel;
    debugPubSub('Subscribing to channel', { channel });

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      debugPubSub('Socket not open during subscribe, triggering connect', {
        channel,
        hasSocket: Boolean(this.ws),
        readyState: this.ws?.readyState ?? null,
      });
      this.connect();
      return;
    }

    debugPubSub('Sending subscribe frame', {
      channel,
    });
    this.ws.send(
      JSON.stringify({
        type: 'subscribe',
        channel,
      })
    );
  }

  unsubscribe(): void {
    debugPubSub('Unsubscribing from channel', {
      channel: this.subscribedChannel,
    });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      debugPubSub('Sending unsubscribe frame', {
        channel: this.subscribedChannel,
      });
      this.ws.send(
        JSON.stringify({
          type: 'unsubscribe',
        })
      );
    }

    this.subscribedChannel = null;
    this.subscriberId = null;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: MessageHandler): void {
    this.messageHandlers = this.messageHandlers.filter(
      (existing) => existing !== handler
    );
  }

  onConnectionChange(handler: ConnectionHandler): void {
    this.connectionHandlers.push(handler);
  }

  offConnectionChange(handler: ConnectionHandler): void {
    this.connectionHandlers = this.connectionHandlers.filter(
      (existing) => existing !== handler
    );
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    debugPubSub('Disconnect requested', {
      channel: this.subscribedChannel,
      connected: this.isConnected,
    });
    this.unsubscribe();
    this.isConnected = false;
    this.emitConnection(false);
    this.closeSocket();
  }

  isConnectionOpen(): boolean {
    return (
      this.isConnected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  getStatus() {
    return {
      connected: this.isConnected,
      clientId: this.clientId,
      subscriberId: this.subscriberId,
      channel: this.subscribedChannel,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

export default PubSubClient;
