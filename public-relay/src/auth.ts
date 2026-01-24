/**
 * API key authentication for registration
 *
 * Simple API key validation - in production, you'd want:
 * - Keys stored in Redis or a database
 * - Keys tied to specific Slack app IDs
 * - Rate limiting per key
 */

import type { NextFunction, Request, Response } from 'express';

import type { ApiKeyEntry } from './types.js';

// API keys can be set via environment variable or loaded from a file
// Format: comma-separated list of "key:app_id" pairs
// Example: RELAY_API_KEYS="sk_abc123:A0B1C2D3,sk_def456:A4B5C6D7"

let apiKeys: ApiKeyEntry[] = [];

/**
 * Load API keys from environment
 */
export function loadApiKeys(): void {
  const keysEnv = process.env.RELAY_API_KEYS || '';

  if (!keysEnv) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'warning',
      message: 'No RELAY_API_KEYS configured - registration will be open',
    }));
    return;
  }

  apiKeys = keysEnv.split(',').map((entry) => {
    const parts = entry.trim().split(':');
    if (parts.length === 2) {
      return { key: parts[0], appId: parts[1] };
    }
    // Key without app_id restriction
    return { key: parts[0], appId: null };
  });

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'api_keys_loaded',
    count: apiKeys.length,
  }));
}

/**
 * Validate an API key for a specific app_id
 */
export function validateApiKey(key: string, appId: string): boolean {
  // If no keys configured, allow all (development mode)
  if (apiKeys.length === 0) {
    return true;
  }

  return apiKeys.some((entry) => {
    if (entry.key !== key) {
      return false;
    }
    // Wildcard key or matching app_id
    return entry.appId === null || entry.appId === appId;
  });
}

/**
 * Express middleware for API key authentication
 * Expects: Authorization: Bearer <api_key>
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const apiKey = authHeader.substring(7); // Remove "Bearer "

  // Get app_id from request body (for registration)
  const appId = req.body?.app_id;

  if (!appId) {
    res.status(400).json({ error: 'Missing app_id in request body' });
    return;
  }

  if (!validateApiKey(apiKey, appId)) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'auth_failed',
      app_id: appId,
      reason: 'invalid_api_key',
    }));
    res.status(403).json({ error: 'Invalid API key for this app_id' });
    return;
  }

  next();
}
