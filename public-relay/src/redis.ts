/**
 * Redis client for tenant registry
 *
 * Stores mapping of Slack app_id -> tunnel URL + metadata
 * Uses TTL for automatic cleanup of stale registrations
 */

import { Redis } from 'ioredis';

import type { TenantRegistration } from './types.js';
import { validateTunnelUrl } from './validation.js';

const REGISTRATION_TTL_SECONDS = 60; // Expire after 60s without heartbeat

let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export function initRedis(): Redis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('error', (err: Error) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'redis_error',
      error: err.message,
    }));
  });

  redis.on('connect', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'redis_connected',
    }));
  });

  return redis;
}

/**
 * Get Redis instance
 */
export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redis;
}

/**
 * Get tenant key for Redis
 */
function getTenantKey(appId: string): string {
  return `tenant:${appId}`;
}

/**
 * Register or update a tenant's tunnel URL
 */
export async function registerTenant(
  appId: string,
  tunnelUrl: string,
  tunnelSecret: string,
  metadata?: { hostname?: string; instance_name?: string }
): Promise<{ success: boolean; error?: string }> {
  // Validate tunnel URL before storing
  const validation = validateTunnelUrl(tunnelUrl);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const now = new Date().toISOString();
  const registration: TenantRegistration = {
    tunnel_url: tunnelUrl,
    tunnel_secret: tunnelSecret,
    registered_at: now,
    last_heartbeat: now,
    ...metadata,
  };

  try {
    const r = getRedis();
    const key = getTenantKey(appId);

    // Store as JSON string with TTL
    await r.setex(key, REGISTRATION_TTL_SECONDS, JSON.stringify(registration));

    console.log(JSON.stringify({
      timestamp: now,
      event: 'tenant_registered',
      app_id: appId,
      hostname: metadata?.hostname || 'unknown',
    }));

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Refresh a tenant's TTL (heartbeat)
 */
export async function refreshTenant(appId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const r = getRedis();
    const key = getTenantKey(appId);

    // Get existing registration
    const data = await r.get(key);
    if (!data) {
      return { success: false, error: 'Tenant not found' };
    }

    // Update last_heartbeat and reset TTL
    const registration: TenantRegistration = JSON.parse(data);
    registration.last_heartbeat = new Date().toISOString();

    await r.setex(key, REGISTRATION_TTL_SECONDS, JSON.stringify(registration));

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Get a tenant's registration
 */
export async function getTenant(appId: string): Promise<TenantRegistration | null> {
  try {
    const r = getRedis();
    const key = getTenantKey(appId);

    const data = await r.get(key);
    if (!data) {
      return null;
    }

    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Unregister a tenant
 */
export async function unregisterTenant(appId: string): Promise<boolean> {
  try {
    const r = getRedis();
    const key = getTenantKey(appId);

    const deleted = await r.del(key);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'tenant_unregistered',
      app_id: appId,
    }));

    return deleted > 0;
  } catch {
    return false;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
