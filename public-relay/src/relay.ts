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
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'registration_rejected',
      app_id,
      reason: validation.reason,
    }));
    res.status(400).json({ error: validation.reason });
    return;
  }

  const result = await registerTenant(app_id, tunnel_url, tunnel_secret, { hostname, instance_name });

  if (result.success) {
    res.json({ success: true });
  } else {
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
    res.json({ success: true });
  } else {
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
 * Forward request to user's tunnel
 */
async function forwardToTunnel(
  tunnelUrl: string,
  tunnelSecret: string,
  path: string,
  rawBody: string,
  headers: Record<string, string>,
  appId: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const startTime = Date.now();
  const url = `${tunnelUrl}${path}`;

  try {
    const response = await fetch(url, {
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

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'forward_request',
      app_id: appId,
      path,
      tunnel_domain: getSafeDomain(tunnelUrl),
      response_status: response.status,
      latency_ms: latencyMs,
    }));

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes('timeout') || message.includes('TimeoutError');
    const isConnectionRefused = message.includes('ECONNREFUSED');

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'forward_error',
      app_id: appId,
      path,
      tunnel_domain: getSafeDomain(tunnelUrl),
      error: isTimeout ? 'timeout' : isConnectionRefused ? 'connection_refused' : message,
      latency_ms: latencyMs,
    }));

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

  // Extract app_id from payload
  const appId = extractAppId(req.body);
  if (!appId) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'missing_app_id',
      path: '/slack/actions',
    }));
    res.status(200).send(); // Still ACK to prevent Slack retries
    return;
  }

  // Look up tenant
  const tenant = await getTenant(appId);
  if (!tenant) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'tenant_not_found',
      app_id: appId,
      path: '/slack/actions',
    }));
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ No active session found. Your tunnel may be offline.',
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
    appId
  );

  if (result.ok) {
    // Forward the response from the tunnel
    res.status(result.status).send(result.body);
  } else {
    // Tunnel unreachable
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ Session offline. Your Mac may be asleep or tunnel disconnected.',
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
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'missing_app_id',
      path: '/slack/events',
    }));
    res.status(200).send();
    return;
  }

  // Look up tenant
  const tenant = await getTenant(appId);
  if (!tenant) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'tenant_not_found',
      app_id: appId,
      path: '/slack/events',
    }));
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
    appId
  );

  // Always return 200 for events to prevent Slack retries
  res.status(200).send(result.ok ? result.body : '');
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'server_error',
    error: err.message,
    stack: err.stack,
  }));
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
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'server_started',
      port: PORT,
    }));
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'server_shutdown',
      signal: 'SIGINT',
    }));
    await closeRedis();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'server_shutdown',
      signal: 'SIGTERM',
    }));
    await closeRedis();
    process.exit(0);
  });
}

export { app };
