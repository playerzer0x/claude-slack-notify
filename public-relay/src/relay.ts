/**
 * Public Relay Server
 *
 * Routes Slack webhook requests to user tunnels:
 * 1. Receives button clicks/events at POST /slack/actions and /slack/events
 * 2. Extracts app_id from Slack payload
 * 3. Looks up tenant's tunnel URL from Redis
 * 4. Forwards request to tenant's tunnel with X-Relay-Secret header
 */

import express, { type NextFunction, type Request, type Response } from 'express';

import { loadApiKeys, requireApiKey } from './auth.js';
import {
  closeRedis,
  getTenant,
  initRedis,
  refreshTenant,
  registerTenant,
  unregisterTenant,
} from './redis.js';
import { getSafeDomain, validateTunnelUrl } from './validation.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// ============================================================================
// Structured JSON Logging
// ============================================================================

interface LogEvent {
  event: string;
  app_id?: string;
  action?: string;
  tunnel_domain?: string;
  response_status?: number;
  latency_ms?: number;
  error_type?: string;
  path?: string;
  port?: number;
  signal?: string;
  reason?: string;
  hostname?: string;
  instance_name?: string;
  [key: string]: unknown;
}

/**
 * Output structured JSON log to stdout
 * Format: {"timestamp": "...", "event": "...", ...}
 */
function log(event: LogEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  console.log(JSON.stringify(entry));
}

// Create Express app
const app = express();

// Capture raw body for Slack signature forwarding
app.use('/slack', (req, _res, next) => {
  let data = '';
  req.on('data', (chunk: Buffer) => {
    data += chunk.toString();
  });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;

    // Parse based on content type
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        req.body = JSON.parse(data);
      } catch {
        req.body = {};
      }
    } else {
      // URL-encoded form data
      const params = new URLSearchParams(data);
      req.body = Object.fromEntries(params.entries());
    }
    next();
  });
});

// JSON body parser for registration endpoints
app.use('/register', express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'public-relay',
    timestamp: new Date().toISOString(),
  });
});

// Register/update tunnel URL
app.post('/register', requireApiKey, async (req: Request, res: Response) => {
  const { app_id, tunnel_url, tunnel_secret, hostname, instance_name } = req.body;

  if (!app_id || !tunnel_url || !tunnel_secret) {
    res.status(400).json({ error: 'Missing required fields: app_id, tunnel_url, tunnel_secret' });
    return;
  }

  // Validate tunnel URL
  const validation = validateTunnelUrl(tunnel_url);
  if (!validation.valid) {
    log({
      event: 'register',
      app_id,
      tunnel_domain: getSafeDomain(tunnel_url),
      reason: validation.reason,
      error_type: 'validation_failed',
    });
    res.status(400).json({ error: validation.reason });
    return;
  }

  const result = await registerTenant(app_id, tunnel_url, tunnel_secret, { hostname, instance_name });

  if (result.success) {
    log({
      event: 'register',
      app_id,
      tunnel_domain: getSafeDomain(tunnel_url),
      hostname,
      instance_name,
    });
    res.json({ success: true });
  } else {
    log({
      event: 'register',
      app_id,
      tunnel_domain: getSafeDomain(tunnel_url),
      error_type: 'redis_error',
      reason: result.error,
    });
    res.status(500).json({ error: result.error });
  }
});

// Heartbeat to refresh TTL
app.post('/register/heartbeat', requireApiKey, async (req: Request, res: Response) => {
  const { app_id } = req.body;

  if (!app_id) {
    res.status(400).json({ error: 'Missing app_id' });
    return;
  }

  const result = await refreshTenant(app_id);

  if (result.success) {
    log({ event: 'heartbeat', app_id });
    res.json({ success: true });
  } else {
    log({ event: 'heartbeat', app_id, error_type: 'tenant_not_found', reason: result.error });
    res.status(404).json({ error: result.error });
  }
});

// Unregister (on shutdown)
app.delete('/register', requireApiKey, async (req: Request, res: Response) => {
  const { app_id } = req.body;

  if (!app_id) {
    res.status(400).json({ error: 'Missing app_id' });
    return;
  }

  await unregisterTenant(app_id);
  log({ event: 'unregister', app_id });
  res.json({ success: true });
});

/**
 * Extract Slack app_id from payload
 */
function extractAppId(body: Record<string, unknown>): string | null {
  // Button actions come as URL-encoded with 'payload' field
  if (typeof body.payload === 'string') {
    try {
      const payload = JSON.parse(body.payload);
      return payload.api_app_id || null;
    } catch {
      return null;
    }
  }

  // Events come as JSON with api_app_id at top level
  if (body.api_app_id && typeof body.api_app_id === 'string') {
    return body.api_app_id;
  }

  return null;
}

/**
 * Extract action from Slack payload for logging
 */
function extractAction(body: Record<string, unknown>): string | undefined {
  if (typeof body.payload === 'string') {
    try {
      const payload = JSON.parse(body.payload);
      // Block actions have actions array with action_id
      if (Array.isArray(payload.actions) && payload.actions.length > 0) {
        const action = payload.actions[0];
        // Try to get meaningful action name
        if (action.value && typeof action.value === 'string') {
          // Format: "session_id|action" or "url:...|action"
          const parts = action.value.split('|');
          if (parts.length >= 2) {
            return parts[parts.length - 1]; // Return the action part
          }
        }
        return action.action_id || undefined;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Forward request to user's tunnel
 */
async function forwardToTunnel(
  tunnelUrl: string,
  tunnelSecret: string,
  path: string,
  rawBody: string,
  headers: Record<string, string>,
  appId: string,
  action?: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const startTime = Date.now();
  const tunnelDomain = getSafeDomain(tunnelUrl);

  // Log forward_start before making the request
  log({
    event: 'forward_start',
    app_id: appId,
    action,
    tunnel_domain: tunnelDomain,
    path,
  });

  try {
    const response = await fetch(`${tunnelUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': headers['content-type'] || 'application/x-www-form-urlencoded',
        // Forward Slack signature headers for the tunnel to verify
        'X-Slack-Request-Timestamp': headers['x-slack-request-timestamp'] || '',
        'X-Slack-Signature': headers['x-slack-signature'] || '',
        // Add relay authentication
        'X-Relay-Secret': tunnelSecret,
        'X-Relay-Timestamp': Date.now().toString(),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    const body = await response.text();
    const latencyMs = Date.now() - startTime;

    log({
      event: 'forward_success',
      app_id: appId,
      action,
      tunnel_domain: tunnelDomain,
      response_status: response.status,
      latency_ms: latencyMs,
    });

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes('timeout') || message.includes('TimeoutError');
    const isConnectionRefused = message.includes('ECONNREFUSED');

    log({
      event: 'forward_error',
      app_id: appId,
      action,
      tunnel_domain: tunnelDomain,
      error_type: isTimeout ? 'timeout' : isConnectionRefused ? 'connection_refused' : 'unknown',
      reason: message,
      latency_ms: latencyMs,
    });

    return { ok: false, status: 502, body: '' };
  }
}

// Slack URL verification challenge handler
function handleUrlVerification(req: Request, res: Response, body: Record<string, unknown>): boolean {
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    res.json({ challenge: body.challenge });
    return true;
  }
  return false;
}

// Forward Slack button actions
app.post('/slack/actions', async (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';

  // Extract app_id and action from payload
  const appId = extractAppId(req.body);
  const action = extractAction(req.body as Record<string, unknown>);

  if (!appId) {
    log({ event: 'forward_error', path: '/slack/actions', error_type: 'missing_app_id' });
    res.status(200).send(); // Still ACK to prevent Slack retries
    return;
  }

  // Look up tenant
  const tenant = await getTenant(appId);
  if (!tenant) {
    log({ event: 'forward_error', app_id: appId, action, error_type: 'tenant_not_found' });
    res.json({
      response_type: 'ephemeral',
      text: 'No active session found. Your tunnel may be offline.',
    });
    return;
  }

  // Forward to tunnel
  const headers = {
    'content-type': req.headers['content-type'] as string,
    'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'] as string,
    'x-slack-signature': req.headers['x-slack-signature'] as string,
  };

  const result = await forwardToTunnel(
    tenant.tunnel_url,
    tenant.tunnel_secret,
    '/slack/actions',
    rawBody,
    headers,
    appId,
    action
  );

  if (result.ok) {
    // Forward the response from the tunnel
    res.status(result.status).send(result.body);
  } else {
    // Tunnel unreachable - return user-friendly ephemeral message
    res.json({
      response_type: 'ephemeral',
      text: 'Session offline. Your Mac may be asleep or the tunnel is disconnected.',
    });
  }
});

// Forward Slack events (thread replies)
app.post('/slack/events', async (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';

  // Handle URL verification challenge directly
  if (handleUrlVerification(req, res, req.body as Record<string, unknown>)) {
    return;
  }

  // Extract app_id from event
  const appId = extractAppId(req.body);
  if (!appId) {
    log({ event: 'forward_error', path: '/slack/events', error_type: 'missing_app_id' });
    res.status(200).send();
    return;
  }

  // Look up tenant
  const tenant = await getTenant(appId);
  if (!tenant) {
    log({ event: 'forward_error', app_id: appId, error_type: 'tenant_not_found', path: '/slack/events' });
    res.status(200).send(); // ACK to prevent retries
    return;
  }

  // Forward to tunnel
  const headers = {
    'content-type': req.headers['content-type'] as string,
    'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'] as string,
    'x-slack-signature': req.headers['x-slack-signature'] as string,
  };

  const result = await forwardToTunnel(
    tenant.tunnel_url,
    tenant.tunnel_secret,
    '/slack/events',
    rawBody,
    headers,
    appId,
    'event'
  );

  // Always return 200 for events to prevent Slack retries
  res.status(200).send(result.ok ? result.body : '');
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log({
    event: 'server_error',
    error_type: err.name || 'Error',
    reason: err.message,
  });
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start the relay server
 */
export async function startRelay(): Promise<void> {
  // Load API keys
  loadApiKeys();

  // Initialize Redis
  initRedis();

  // Start HTTP server
  app.listen(PORT, () => {
    log({ event: 'server_started', port: PORT });
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log({ event: 'server_shutdown', signal: 'SIGINT' });
    await closeRedis();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log({ event: 'server_shutdown', signal: 'SIGTERM' });
    await closeRedis();
    process.exit(0);
  });
}

export { app };
