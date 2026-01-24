/**
 * Authentication utilities for the public relay
 *
 * Two authentication mechanisms:
 * 1. API key authentication - for registration endpoints (tenant -> relay)
 * 2. Tunnel secret authentication - for forwarded requests (relay -> tunnel)
 *
 * Simple API key validation - in production, you'd want:
 * - Keys stored in Redis or a database
 * - Keys tied to specific Slack app IDs
 * - Rate limiting per key
 */

import type { NextFunction, Request, Response } from 'express';

import type { ApiKeyEntry } from './types.js';

// ============================================================================
// Tunnel Secret Authentication (for relay -> tunnel requests)
// ============================================================================

/**
 * Maximum allowed timestamp skew in milliseconds (5 minutes)
 * Prevents replay attacks while allowing for clock drift
 */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/**
 * Validate the X-Relay-Secret header against the expected secret
 *
 * @param headerValue - The value from X-Relay-Secret header
 * @param expectedSecret - The secret stored locally (from ~/.claude/.relay-tunnel-secret)
 * @returns true if secrets match, false otherwise
 */
export function validateRelaySecret(headerValue: string | undefined, expectedSecret: string): boolean {
  if (!headerValue || !expectedSecret) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (headerValue.length !== expectedSecret.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < headerValue.length; i++) {
    result |= headerValue.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate the X-Relay-Timestamp header is within acceptable range
 *
 * @param headerValue - The timestamp value from X-Relay-Timestamp header (milliseconds since epoch)
 * @param maxSkewMs - Maximum allowed skew in milliseconds (default: 5 minutes)
 * @returns object with valid flag and optional reason for failure
 */
export function validateRelayTimestamp(
  headerValue: string | undefined,
  maxSkewMs: number = MAX_TIMESTAMP_SKEW_MS
): { valid: boolean; reason?: string } {
  if (!headerValue) {
    return { valid: false, reason: 'Missing X-Relay-Timestamp header' };
  }

  const timestamp = parseInt(headerValue, 10);
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp format' };
  }

  const now = Date.now();
  const diff = Math.abs(now - timestamp);

  if (diff > maxSkewMs) {
    return {
      valid: false,
      reason: `Timestamp too old or in future (skew: ${Math.round(diff / 1000)}s, max: ${Math.round(maxSkewMs / 1000)}s)`,
    };
  }

  return { valid: true };
}

/**
 * Combined validation for relay authentication headers
 *
 * @param relaySecret - Value from X-Relay-Secret header
 * @param relayTimestamp - Value from X-Relay-Timestamp header
 * @param expectedSecret - The expected tunnel secret
 * @returns object with valid flag and optional reason for failure
 */
export function validateRelayAuth(
  relaySecret: string | undefined,
  relayTimestamp: string | undefined,
  expectedSecret: string
): { valid: boolean; reason?: string } {
  // Validate timestamp first (cheaper check)
  const timestampResult = validateRelayTimestamp(relayTimestamp);
  if (!timestampResult.valid) {
    return timestampResult;
  }

  // Validate secret
  if (!validateRelaySecret(relaySecret, expectedSecret)) {
    return { valid: false, reason: 'Invalid relay secret' };
  }

  return { valid: true };
}

// ============================================================================
// API Key Authentication (for registration endpoints)
// ============================================================================

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
