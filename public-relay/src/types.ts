/**
 * Type definitions for the public relay service
 */

/**
 * Request body for tenant registration
 */
export interface RegisterRequest {
  app_id: string;        // Slack App ID
  tunnel_url: string;    // User's tunnel URL (https://...)
  tunnel_secret: string; // Secret for relay-to-tunnel authentication
  hostname?: string;     // Optional hostname for debugging
  instance_name?: string; // Optional instance name for debugging
}

/**
 * Stored tenant registration data
 */
export interface TenantRegistration {
  tunnel_url: string;
  tunnel_secret: string;
  registered_at: string;
  last_heartbeat: string;
  hostname?: string;
  instance_name?: string;
}

/**
 * API key entry for authentication
 * Each key can authorize one or more Slack App IDs
 */
export interface ApiKeyEntry {
  key: string;
  appIds: string[]; // Empty array = wildcard (any app_id)
}

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Result of URL validation
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Result of forwarding request to tunnel
 */
export interface ForwardResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Slack button action payload (parsed from URL-encoded form)
 */
export interface SlackActionPayload {
  api_app_id: string;
  type: string;
  trigger_id: string;
  user: {
    id: string;
    username: string;
  };
  channel: {
    id: string;
    name: string;
  };
  actions: Array<{
    action_id: string;
    block_id: string;
    value: string;
    type: string;
  }>;
  response_url: string;
}

/**
 * Slack event payload
 */
export interface SlackEventPayload {
  api_app_id: string;
  type: string;
  challenge?: string; // For URL verification
  event?: {
    type: string;
    user: string;
    channel: string;
    text: string;
    ts: string;
    thread_ts?: string;
  };
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok';
  service: 'public-relay';
  timestamp: string;
}
