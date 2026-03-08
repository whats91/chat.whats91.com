/**
 * Redis Connection Module
 * 
 * Provides Redis connection for:
 * - Caching
 * - Session storage
 * - Rate limiting
 * - Job queues
 * - Real-time message deduplication
 */

import 'server-only';
import { Logger } from '@/lib/logger';

const log = new Logger('Redis');

export interface RedisConfig {
  url: string;
  password?: string;
  database?: number;
  keyPrefix?: string;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  lpush(key: string, value: string): Promise<number>;
  rpush(key: string, value: string): Promise<number>;
  lpop(key: string): Promise<string | null>;
  rpop(key: string): Promise<string | null>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;
  unsubscribe?(channel: string, callback?: (message: string) => void): Promise<void>;
  disconnect(): Promise<void>;
}

// Default configuration from environment
const defaultConfig: RedisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD,
  database: parseInt(process.env.REDIS_DB || '0'),
  keyPrefix: process.env.REDIS_PREFIX || 'whats91:',
};

/**
 * Create a Redis client
 * 
 * Note: This is scaffolded for future use.
 * Install node-redis when ready: `npm install redis`
 */
export async function createRedisClient(
  _config: Partial<RedisConfig> = {}
): Promise<RedisClient | null> {
  // TODO: Implement Redis connection when ready for production
  // Example using node-redis:
  /*
  const { createClient } = await import('redis');
  
  const client = createClient({
    url: config.url || defaultConfig.url,
    password: config.password || defaultConfig.password,
    database: config.database ?? defaultConfig.database,
  });
  
  client.on('error', (err) => log.error('Client error', { error: err }));
  
  await client.connect();
  
  return {
    async get(key) {
      return client.get(defaultConfig.keyPrefix + key);
    },
    async set(key, value, ttlSeconds) {
      const fullKey = defaultConfig.keyPrefix + key;
      if (ttlSeconds) {
        await client.setEx(fullKey, ttlSeconds, value);
      } else {
        await client.set(fullKey, value);
      }
    },
    async del(key) {
      await client.del(defaultConfig.keyPrefix + key);
    },
    async exists(key) {
      const result = await client.exists(defaultConfig.keyPrefix + key);
      return result === 1;
    },
    async expire(key, ttlSeconds) {
      await client.expire(defaultConfig.keyPrefix + key, ttlSeconds);
    },
    async ttl(key) {
      return client.ttl(defaultConfig.keyPrefix + key);
    },
    async incr(key) {
      return client.incr(defaultConfig.keyPrefix + key);
    },
    async decr(key) {
      return client.decr(defaultConfig.keyPrefix + key);
    },
    async hset(key, field, value) {
      await client.hSet(defaultConfig.keyPrefix + key, field, value);
    },
    async hget(key, field) {
      return client.hGet(defaultConfig.keyPrefix + key, field);
    },
    async hdel(key, field) {
      await client.hDel(defaultConfig.keyPrefix + key, field);
    },
    async hgetall(key) {
      return client.hGetAll(defaultConfig.keyPrefix + key);
    },
    async lpush(key, value) {
      return client.lPush(defaultConfig.keyPrefix + key, value);
    },
    async rpush(key, value) {
      return client.rPush(defaultConfig.keyPrefix + key, value);
    },
    async lpop(key) {
      return client.lPop(defaultConfig.keyPrefix + key);
    },
    async rpop(key) {
      return client.rPop(defaultConfig.keyPrefix + key);
    },
    async lrange(key, start, stop) {
      return client.lRange(defaultConfig.keyPrefix + key, start, stop);
    },
    async publish(channel, message) {
      await client.publish(defaultConfig.keyPrefix + channel, message);
    },
    async subscribe(channel, callback) {
      const subscriber = client.duplicate();
      await subscriber.connect();
      await subscriber.subscribe(defaultConfig.keyPrefix + channel, (message) => {
        callback(message);
      });
    },
    async disconnect() {
      await client.quit();
    },
  };
  */
  
  log.info('Connection not implemented - using in-memory fallback');
  return null;
}

// In-memory fallback for development
class InMemoryRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private lists = new Map<string, string[]>();
  private hashes = new Map<string, Map<string, string>>();
  private subscribers = new Map<string, Set<(message: string) => void>>();
  
  private getFullKey(key: string): string {
    return (defaultConfig.keyPrefix || '') + key;
  }
  
  private isExpired(fullKey: string): boolean {
    const item = this.store.get(fullKey);
    if (!item) return true;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(fullKey);
      return true;
    }
    return false;
  }
  
  async get(key: string): Promise<string | null> {
    const fullKey = this.getFullKey(key);
    if (this.isExpired(fullKey)) return null;
    return this.store.get(fullKey)?.value ?? null;
  }
  
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.store.set(fullKey, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }
  
  async del(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.store.delete(fullKey);
    this.lists.delete(fullKey);
    this.hashes.delete(fullKey);
  }
  
  async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    return !this.isExpired(fullKey);
  }
  
  async expire(key: string, ttlSeconds: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const item = this.store.get(fullKey);
    if (item) {
      item.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }
  
  async ttl(key: string): Promise<number> {
    const fullKey = this.getFullKey(key);
    const item = this.store.get(fullKey);
    if (!item || !item.expiresAt) return -1;
    return Math.max(0, Math.floor((item.expiresAt - Date.now()) / 1000));
  }
  
  async incr(key: string): Promise<number> {
    const fullKey = this.getFullKey(key);
    const item = this.store.get(fullKey);
    const newValue = parseInt(item?.value || '0') + 1;
    this.store.set(fullKey, { value: String(newValue) });
    return newValue;
  }
  
  async decr(key: string): Promise<number> {
    const fullKey = this.getFullKey(key);
    const item = this.store.get(fullKey);
    const newValue = parseInt(item?.value || '0') - 1;
    this.store.set(fullKey, { value: String(newValue) });
    return newValue;
  }
  
  async hset(key: string, field: string, value: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    if (!this.hashes.has(fullKey)) {
      this.hashes.set(fullKey, new Map());
    }
    this.hashes.get(fullKey)!.set(field, value);
  }
  
  async hget(key: string, field: string): Promise<string | null> {
    const fullKey = this.getFullKey(key);
    return this.hashes.get(fullKey)?.get(field) ?? null;
  }
  
  async hdel(key: string, field: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.hashes.get(fullKey)?.delete(field);
  }
  
  async hgetall(key: string): Promise<Record<string, string>> {
    const fullKey = this.getFullKey(key);
    const hash = this.hashes.get(fullKey);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }
  
  async lpush(key: string, value: string): Promise<number> {
    const fullKey = this.getFullKey(key);
    if (!this.lists.has(fullKey)) {
      this.lists.set(fullKey, []);
    }
    this.lists.get(fullKey)!.unshift(value);
    return this.lists.get(fullKey)!.length;
  }
  
  async rpush(key: string, value: string): Promise<number> {
    const fullKey = this.getFullKey(key);
    if (!this.lists.has(fullKey)) {
      this.lists.set(fullKey, []);
    }
    this.lists.get(fullKey)!.push(value);
    return this.lists.get(fullKey)!.length;
  }
  
  async lpop(key: string): Promise<string | null> {
    const fullKey = this.getFullKey(key);
    return this.lists.get(fullKey)?.shift() ?? null;
  }
  
  async rpop(key: string): Promise<string | null> {
    const fullKey = this.getFullKey(key);
    return this.lists.get(fullKey)?.pop() ?? null;
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const fullKey = this.getFullKey(key);
    const list = this.lists.get(fullKey) || [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }
  
  async publish(channel: string, message: string): Promise<void> {
    const fullChannel = this.getFullKey(channel);
    const callbacks = this.subscribers.get(fullChannel);
    log.debug('In-memory publish', {
      channel: fullChannel,
      subscriberCount: callbacks?.size || 0,
    });
    if (callbacks) {
      callbacks.forEach(cb => cb(message));
    }
  }
  
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const fullChannel = this.getFullKey(channel);
    if (!this.subscribers.has(fullChannel)) {
      this.subscribers.set(fullChannel, new Set());
    }
    this.subscribers.get(fullChannel)!.add(callback);
    log.debug('In-memory subscribe', {
      channel: fullChannel,
      subscriberCount: this.subscribers.get(fullChannel)!.size,
    });
  }

  async unsubscribe(channel: string, callback?: (message: string) => void): Promise<void> {
    const fullChannel = this.getFullKey(channel);
    if (!this.subscribers.has(fullChannel)) {
      return;
    }

    if (!callback) {
      this.subscribers.delete(fullChannel);
      return;
    }

    const callbacks = this.subscribers.get(fullChannel)!;
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      this.subscribers.delete(fullChannel);
      log.debug('In-memory unsubscribe removed final subscriber', {
        channel: fullChannel,
      });
      return;
    }

    log.debug('In-memory unsubscribe', {
      channel: fullChannel,
      subscriberCount: callbacks.size,
    });
  }
  
  async disconnect(): Promise<void> {
    this.store.clear();
    this.lists.clear();
    this.hashes.clear();
    this.subscribers.clear();
  }
}

// Singleton instance
let _client: RedisClient | null = null;

export async function getRedisClient(): Promise<RedisClient> {
  if (!_client) {
    _client = await createRedisClient();
    if (!_client) {
      // Fall back to in-memory for development
      _client = new InMemoryRedis();
    }
  }
  return _client;
}

// Utility functions for common operations

/**
 * Rate limiting helper
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const redis = await getRedisClient();
  const fullKey = `ratelimit:${key}`;
  
  const current = await redis.incr(fullKey);
  
  if (current === 1) {
    await redis.expire(fullKey, windowSeconds);
  }
  
  const ttl = await redis.ttl(fullKey);
  const resetAt = new Date(Date.now() + ttl * 1000);
  
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt,
  };
}

/**
 * Message deduplication helper
 */
export async function isDuplicateMessage(messageId: string): Promise<boolean> {
  const redis = await getRedisClient();
  const key = `msg:seen:${messageId}`;
  
  const exists = await redis.exists(key);
  if (exists) return true;
  
  // Mark as seen for 24 hours
  await redis.set(key, '1', 86400);
  return false;
}
