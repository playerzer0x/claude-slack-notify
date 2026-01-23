/**
 * Public Relay Service Entry Point
 *
 * A centralized service that routes Slack webhook requests to user tunnels.
 *
 * Environment variables:
 * - PORT: HTTP port (default: 3000)
 * - REDIS_URL: Redis connection URL (default: redis://localhost:6379)
 * - RELAY_API_KEYS: Comma-separated list of "api_key:app_id" pairs for registration auth
 *
 * Endpoints:
 * - GET /health - Health check
 * - POST /register - Register tunnel URL (requires API key)
 * - POST /register/heartbeat - Refresh registration TTL
 * - DELETE /register - Unregister tunnel URL
 * - POST /slack/actions - Forward Slack button actions
 * - POST /slack/events - Forward Slack events (thread replies)
 */

import { startRelay } from './relay.js';

startRelay();
