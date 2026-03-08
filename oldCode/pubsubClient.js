/**
 * PubSub WebSocket Client
 * 
 * Connects to centralized PubSub service for real-time updates.
 * Used for:
 * - Real-time logs from webhook-site
 * - WhatsApp message distribution
 * - System notifications
 */

class PubSubClient {
  constructor(config = {}) {
    // Use production domain - adjust if needed
    this.url = config.url || 'wss://pubsub-service.botmastersender.com';
    this.reconnectDelay = config.reconnectDelay || 2000;
    this.maxReconnectDelay = config.maxReconnectDelay || 30000;
    this.reconnectAttempts = 0;
    this.ws = null;
    this.messageHandlers = [];
    this.isConnected = false;
    this.shouldReconnect = true;
    this.subscribedChannel = null;
    this.clientId = null;
    this.subscriberId = null;
  }
  
  /**
   * Connect to pub-sub service
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('[PubSub] Already connected or connecting');
      return;
    }
    
    console.log(`[PubSub] Connecting to: ${this.url}`);
    
    try {
      this.ws = new WebSocket(this.url);
      
      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('[PubSub] ✅ Connected');
        
        // Re-subscribe to channel if we were subscribed before disconnect
        if (this.subscribedChannel) {
          this.subscribe(this.subscribedChannel);
        }
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('[PubSub] Error parsing message:', err);
        }
      };
      
      this.ws.onclose = () => {
        this.isConnected = false;
        this.clientId = null;
        this.subscriberId = null;
        console.log('[PubSub] ❌ Disconnected');
        
        if (this.shouldReconnect) {
          this.attemptReconnect();
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[PubSub] WebSocket error:', error.message || error.type);
      };
    } catch (err) {
      console.error('[PubSub] Connection error:', err);
      if (this.shouldReconnect) {
        this.attemptReconnect();
      }
    }
  }
  
  /**
   * Handle incoming message from PubSub
   */
  handleMessage(message) {
    switch (message.type) {
      case 'connected':
        this.clientId = message.clientId;
        console.log(`[PubSub] Client ID: ${this.clientId}`);
        break;
        
      case 'subscribed':
        this.subscriberId = message.subscriberId;
        console.log(`[PubSub] 📡 Subscribed to: ${message.channel}`);
        console.log(`[PubSub] Subscriber ID: ${this.subscriberId}`);
        break;
        
      case 'message':
        // This is the actual message from pub-sub
        console.log(`[PubSub] 📨 Message received (ID: ${message.id})`);
        
        // Call all registered handlers
        this.messageHandlers.forEach(handler => {
          try {
            handler(message.payload, message);
          } catch (err) {
            console.error('[PubSub] Handler error:', err);
          }
        });
        break;
        
      case 'error':
        console.error(`[PubSub] Server error: ${message.message}`);
        break;
        
      default:
        console.log(`[PubSub] Unknown message type: ${message.type}`, message);
    }
  }
  
  /**
   * Subscribe to a channel
   */
  subscribe(channel) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[PubSub] Cannot subscribe - not connected');
      // Save channel to re-subscribe after reconnect
      this.subscribedChannel = channel;
      return;
    }
    
    this.subscribedChannel = channel;
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      channel: channel
    }));
    
    console.log(`[PubSub] Subscribing to channel: ${channel}`);
  }
  
  /**
   * Unsubscribe from current channel
   */
  unsubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    this.ws.send(JSON.stringify({
      type: 'unsubscribe'
    }));
    
    this.subscribedChannel = null;
    this.subscriberId = null;
  }
  
  /**
   * Register message handler
   */
  onMessage(handler) {
    if (typeof handler === 'function') {
      this.messageHandlers.push(handler);
    }
  }
  
  /**
   * Remove message handler
   */
  offMessage(handler) {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }
  
  /**
   * Clear all message handlers
   */
  clearHandlers() {
    this.messageHandlers = [];
  }
  
  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    this.reconnectAttempts++;
    
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    
    console.log(`[PubSub] 🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }
  
  /**
   * Disconnect from pub-sub service
   */
  disconnect() {
    console.log('[PubSub] Disconnecting...');
    this.shouldReconnect = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.clientId = null;
    this.subscriberId = null;
    this.subscribedChannel = null;
  }
  
  /**
   * Check if connected
   */
  isConnectionOpen() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  
  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      clientId: this.clientId,
      subscriberId: this.subscriberId,
      channel: this.subscribedChannel,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

export default PubSubClient;
