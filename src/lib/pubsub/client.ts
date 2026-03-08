'use client';

import type {
  PubSubClientPayload,
  PubSubTransportEnvelope,
} from '@/lib/types/pubsub';

type MessageHandler = (payload: PubSubClientPayload, envelope: Extract<PubSubTransportEnvelope, { type: 'message' }>) => void;
type ConnectionHandler = (connected: boolean) => void;

interface PubSubClientConfig {
  url?: string;
}

const DEFAULT_PUBSUB_STREAM_PATH = '/api/pubsub/stream';

class PubSubClient {
  private readonly baseUrl: string;
  private eventSource: EventSource | null = null;
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private subscribedChannel: string | null = null;
  private shouldReconnect = true;
  private isConnected = false;
  private clientId: string | null = null;
  private subscriberId: string | null = null;

  constructor(config: PubSubClientConfig = {}) {
    this.baseUrl = config.url || DEFAULT_PUBSUB_STREAM_PATH;
  }

  private resolveBaseUrl(): URL {
    const fallbackUrl = new URL(DEFAULT_PUBSUB_STREAM_PATH, window.location.origin);

    try {
      const configuredUrl = new URL(this.baseUrl, window.location.origin);

      if (configuredUrl.protocol === 'ws:' || configuredUrl.protocol === 'wss:') {
        return fallbackUrl;
      }

      if (
        configuredUrl.protocol !== 'http:' &&
        configuredUrl.protocol !== 'https:'
      ) {
        return fallbackUrl;
      }

      if (configuredUrl.origin !== window.location.origin) {
        return fallbackUrl;
      }

      return configuredUrl;
    } catch {
      return fallbackUrl;
    }
  }

  private buildStreamUrl(): string | null {
    if (!this.subscribedChannel) {
      return null;
    }

    const url = this.resolveBaseUrl();
    url.searchParams.set('channel', this.subscribedChannel);
    return url.toString();
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
        break;
      case 'subscribed':
        this.subscriberId = envelope.subscriberId;
        break;
      case 'message':
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

  private closeSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  connect(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const streamUrl = this.buildStreamUrl();
    if (!streamUrl) {
      return;
    }

    if (this.eventSource && (this.eventSource.readyState === EventSource.OPEN || this.eventSource.readyState === EventSource.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.closeSource();

    const eventSource = new EventSource(streamUrl, { withCredentials: true });
    this.eventSource = eventSource;

    eventSource.onopen = () => {
      this.isConnected = true;
      this.emitConnection(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as PubSubTransportEnvelope;
        this.handleEnvelope(envelope);
      } catch (error) {
        console.error('[PubSub] Failed to parse envelope:', error);
      }
    };

    eventSource.onerror = () => {
      this.isConnected = false;
      this.emitConnection(false);

      if (!this.shouldReconnect) {
        this.closeSource();
      }
    };
  }

  subscribe(channel: string): void {
    this.subscribedChannel = channel;
    this.connect();
  }

  unsubscribe(): void {
    this.subscribedChannel = null;
    this.clientId = null;
    this.subscriberId = null;
    this.isConnected = false;
    this.emitConnection(false);
    this.closeSource();
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: MessageHandler): void {
    this.messageHandlers = this.messageHandlers.filter((existing) => existing !== handler);
  }

  onConnectionChange(handler: ConnectionHandler): void {
    this.connectionHandlers.push(handler);
  }

  offConnectionChange(handler: ConnectionHandler): void {
    this.connectionHandlers = this.connectionHandlers.filter((existing) => existing !== handler);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.unsubscribe();
  }

  isConnectionOpen(): boolean {
    return this.isConnected;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      clientId: this.clientId,
      subscriberId: this.subscriberId,
      channel: this.subscribedChannel,
    };
  }
}

export default PubSubClient;
