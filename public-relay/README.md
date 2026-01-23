# Public Relay Server

A centralized relay service that routes Slack webhook requests to user tunnels. This enables users running Claude locally on Mac to receive Slack button clicks without setting up their own server.

## Architecture

```
Slack App ──► POST /slack/actions ──► Public Relay ──► User's Tunnel
                                           │
                                           ▼
                                    Redis (tenant registry)
```

1. Users register their tunnel URL with the relay
2. Slack sends button clicks to the relay
3. Relay looks up the user's tunnel by Slack app_id
4. Relay forwards the request to the user's tunnel

## Local Development

```bash
# Install dependencies
bun install

# Start Redis (required)
docker run -d -p 6379:6379 redis:alpine

# Set environment variables
export REDIS_URL=redis://localhost:6379
export RELAY_API_KEYS=test_key_123:A0B1C2D3E4  # api_key:app_id pairs

# Start the server
bun run dev

# Or build and run
bun run build
bun run start
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `8080` (default: 3000) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `RELAY_API_KEYS` | API keys for registration (comma-separated `key:app_id` pairs) | `sk_abc:A0B1C,sk_xyz:D4E5F` |

## Railway Deployment

### Prerequisites

- [Railway CLI](https://docs.railway.app/develop/cli) installed
- Railway account (free tier works)

### Step 1: Create Project

```bash
cd public-relay

# Login to Railway
railway login

# Initialize new project
railway init

# Or link to existing project
railway link
```

### Step 2: Add Redis

```bash
# Add Redis addon via Railway dashboard
# Or use Railway CLI
railway add --database redis
```

The `REDIS_URL` environment variable will be automatically set.

### Step 3: Set Environment Variables

Via CLI:
```bash
railway variables set RELAY_API_KEYS="sk_user1_abc123:A0B1C2D3,sk_user2_def456:E4F5G6H7"
```

Or via Railway dashboard:
1. Go to your project
2. Click on the service
3. Go to Variables tab
4. Add `RELAY_API_KEYS` with your API keys

### Step 4: Deploy

```bash
# Deploy from local directory
railway up

# Or connect GitHub for automatic deploys
railway service
# Then connect your repo in the dashboard
```

### Step 5: Get Your URL

After deployment, Railway provides a public URL like:
```
https://your-project.up.railway.app
```

This is your relay URL for Slack app configuration.

### Step 6: Configure Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Select your app
3. Go to **Interactivity & Shortcuts**
4. Set Request URL to: `https://your-project.up.railway.app/slack/actions`
5. Save Changes

## User Setup

After deploying the relay, users need to configure their local tunnel to use it:

### 1. Save Relay URL

```bash
echo "https://your-project.up.railway.app" > ~/.claude/.public-relay-url
```

### 2. Save API Key

```bash
echo "sk_user1_abc123" > ~/.claude/.public-relay-key
chmod 600 ~/.claude/.public-relay-key
```

### 3. Start Tunnel with Public Relay

```bash
local-tunnel --public-relay

# Or run setup first
local-tunnel --public-relay --setup
```

## API Endpoints

### `POST /register`

Register or update a tunnel URL.

```bash
curl -X POST https://relay.example.com/register \
  -H "Authorization: Bearer sk_user1_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "tunnel_url": "https://abc.loca.lt",
    "tunnel_secret": "ts_randomsecret",
    "hostname": "my-macbook"
  }'
```

### `POST /register/heartbeat`

Refresh registration TTL (called every 30s by tunnel scripts).

```bash
curl -X POST https://relay.example.com/register/heartbeat \
  -H "Authorization: Bearer sk_user1_abc123"
```

### `DELETE /register`

Unregister on shutdown.

```bash
curl -X DELETE https://relay.example.com/register \
  -H "Authorization: Bearer sk_user1_abc123"
```

### `POST /slack/actions`

Receives Slack button clicks and forwards to user's tunnel.

### `POST /slack/events`

Receives Slack events (thread replies) and forwards to user's tunnel.

### `GET /health`

Health check endpoint.

```bash
curl https://relay.example.com/health
# {"status":"ok","redis":"connected"}
```

## Security

### API Keys

Each user gets a unique API key tied to their Slack App ID. Format: `key:app_id` pairs in `RELAY_API_KEYS`.

### Tunnel Secret

Auto-generated secret stored in `~/.claude/.relay-tunnel-secret`. The relay forwards this in `X-Relay-Secret` header, and the user's MCP server verifies it.

### SSRF Protection

The relay validates tunnel URLs before forwarding:
- Must be HTTPS
- Blocks private IPs (127.x, 10.x, 192.168.x, etc.)
- Blocks cloud metadata endpoints (169.254.169.254)

### Timestamp Validation

5-minute window to prevent replay attacks via `X-Relay-Timestamp` header.

## Monitoring

The relay outputs structured JSON logs:

```json
{"timestamp":"2024-01-23T12:00:00Z","event":"tenant_registered","app_id":"A0B1C2D3","hostname":"macbook"}
{"timestamp":"2024-01-23T12:00:05Z","event":"forward_request","app_id":"A0B1C2D3","action":"focus","status":200,"latency_ms":150}
```

Railway automatically captures these logs in the dashboard.

## Dockerfile

The included Dockerfile uses a multi-stage build:

```dockerfile
# Build stage
FROM node:20-alpine AS builder
# ... builds TypeScript

# Production stage
FROM node:20-alpine
# ... runs compiled JS
```

Railway automatically detects and uses this Dockerfile.

## Troubleshooting

### "Tenant not found" error

The user's tunnel registration has expired (60s TTL). Ensure the tunnel is running and sending heartbeats.

### "Invalid API key" error

Check that `RELAY_API_KEYS` contains the correct `key:app_id` pair.

### Redis connection errors

Verify `REDIS_URL` is set correctly. On Railway, this should be auto-configured when you add the Redis addon.

### Tunnel URL rejected

The relay validates URLs for SSRF protection. Ensure the tunnel URL:
- Uses HTTPS (not HTTP)
- Points to a public hostname (not localhost or private IP)
