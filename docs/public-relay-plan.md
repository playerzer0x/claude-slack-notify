# Plan: Public Hosted MCP Relay Service

## Problem Statement

Users who only run Claude locally on Mac need to set up their own remote server to get reliable Slack button handling. This is a technical barrier. We want a **public relay service** that acts as the central Slack webhook endpoint and routes requests to wherever the user's Claude is running.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PUBLIC RELAY (Railway/Fly.io)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Slack (any user's app)                                             │
│         ↓                                                            │
│  POST /slack/actions                                                │
│         ↓                                                            │
│  Extract user identifier (from button value or Slack app ID)        │
│         ↓                                                            │
│  Lookup user's tunnel URL from registry (Redis/Postgres)            │
│         ↓                                                            │
│  ┌─────────────────┬─────────────────┐                              │
│  │ User online?    │ User offline?   │                              │
│  │ Forward request │ Return error OR │                              │
│  │ to their tunnel │ queue for later │                              │
│  └─────────────────┴─────────────────┘                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

User A (Mac):                    User B (Linux server):
  local-tunnel                     remote-tunnel
  registers URL                    registers URL
  with public relay                with public relay
```

## How It Works

### 1. User Registration Flow
```bash
# User runs local-tunnel or remote-tunnel with --public-relay flag
local-tunnel --public-relay

# This:
# 1. Starts local MCP server as usual
# 2. Registers tunnel URL with public relay: POST /register
#    { user_id: "abc123", tunnel_url: "https://user-abc.loca.lt", ... }
# 3. Sends heartbeat every 30s to keep registration alive
```

### 2. Button Click Flow
```
1. User clicks button in Slack
2. Slack POSTs to public relay: https://relay.example.com/slack/actions
3. Relay extracts user identifier from button value
4. Relay looks up user's tunnel URL
5. Relay forwards request to user's tunnel
6. User's local MCP server handles it (focus, tmux input, etc.)
```

### 3. User Identification
Button values already include the focus URL which has unique identifiers:
```
url:claude-focus://ssh-linked/{link_id}/...
url:claude-focus://iterm2/{session_uuid}
```

We can embed a user/tenant ID in the button value:
```
tenant:{user_id}|url:claude-focus://...|action
```

Or use Slack App ID (each user installs their own Slack app, has unique app_id).

## Components Needed

### Public Relay Server (new)
- **Endpoint**: `POST /slack/actions` - receive and forward button clicks
- **Endpoint**: `POST /slack/events` - receive and forward thread replies
- **Endpoint**: `POST /register` - register/update tunnel URL
- **Endpoint**: `DELETE /register` - unregister on shutdown
- **Endpoint**: `GET /health` - health check
- **Storage**: Redis or Postgres for user → tunnel URL mapping
- **Auth**: Simple API key per user for registration

### Changes to local-tunnel / remote-tunnel
- New `--public-relay` flag
- Register tunnel URL with public relay on startup
- Heartbeat to keep registration alive
- Unregister on shutdown

### Changes to claude-slack-notify
- Option to embed tenant ID in button values
- Or: Use Slack App ID as tenant identifier (no changes needed)

## Implementation Details

### Registry Schema (Redis)
```
Key: tenant:{app_id}
Value: {
  tunnel_url: "https://...",
  registered_at: "2024-01-23T...",
  last_heartbeat: "2024-01-23T...",
  metadata: { hostname, instance_name, ... }
}
TTL: 60 seconds (refreshed by heartbeat)
```

### Relay Forwarding Logic
```typescript
app.post('/slack/actions', async (req, res) => {
  // 1. Verify Slack signature (using OUR signing secret)
  // 2. Extract app_id from payload
  const appId = payload.api_app_id;

  // 3. Lookup tunnel URL
  const registration = await redis.get(`tenant:${appId}`);
  if (!registration) {
    return res.json({ text: "⚠️ No active session found" });
  }

  // 4. Forward to user's tunnel
  const response = await fetch(`${registration.tunnel_url}/slack/actions`, {
    method: 'POST',
    body: req.rawBody,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': req.headers['x-slack-request-timestamp'],
      'X-Slack-Signature': req.headers['x-slack-signature'],
    }
  });

  // 5. Return response
  res.status(response.status).send(await response.text());
});
```

### Heartbeat Registration
```typescript
// In local-tunnel / remote-tunnel
async function registerWithPublicRelay() {
  await fetch(`${PUBLIC_RELAY_URL}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      app_id: SLACK_APP_ID,
      tunnel_url: LOCAL_TUNNEL_URL,
      hostname: os.hostname(),
    })
  });
}

// Call on startup and every 30s
setInterval(registerWithPublicRelay, 30000);
```

## Hosting Options

| Platform | Cost | Pros | Cons |
|----------|------|------|------|
| **Railway** | ~$5/mo | Easy deploy, Redis addon | No free tier for always-on |
| **Fly.io** | ~$5/mo | Global edge, Redis built-in | More complex setup |
| **Render** | Free tier | Simple, free web service | Redis costs extra |
| **Cloudflare Workers** | Free tier | Edge, fast, durable objects | Different programming model |

**Recommendation**: Start with **Railway** or **Render** for simplicity.

## Security Model: API Keys

Each user gets a unique API key that authorizes registration for specific Slack App IDs.

```
User signup flow (future: could be self-service portal):
1. User provides their Slack App ID
2. Admin generates API key tied to that App ID
3. User stores API key in ~/.claude/.public-relay-key

Registration request:
POST /register
Authorization: Bearer sk_user_abc123
{
  "app_id": "A0B1C2D3",
  "tunnel_url": "https://abc.loca.lt"
}

Relay validates:
- API key exists
- API key is authorized for this app_id
- Then stores: tenant:A0B1C2D3 → tunnel_url
```

## Offline Handling

When user's tunnel is unreachable, return an error message:

```typescript
if (!tunnelReachable) {
  return res.json({
    response_type: 'ephemeral',
    text: '⚠️ Session offline. Your Mac may be asleep or tunnel disconnected.'
  });
}
```

Simple and honest. Can add queueing later if users request it.

## What Works / Doesn't Work

| Feature | Works? | Notes |
|---------|--------|-------|
| Button clicks (1, 2, Continue, Push) | ✅ | Forwarded to user's tunnel |
| Focus terminal | ✅ | Forwarded to user's tunnel |
| Thread replies | ✅ | Forwarded to user's tunnel |
| User offline | ⚠️ | Returns friendly error message |

## Implementation Steps

### Phase 1: Create Public Relay Server
1. Create `public-relay/` directory with Node.js/Express server
2. Implement endpoints:
   - `POST /register` - Accept tunnel URL + API key
   - `POST /slack/actions` - Forward button clicks
   - `POST /slack/events` - Forward thread replies
   - `GET /health` - Health check
3. Add Redis for tenant registry (TTL-based expiration)
4. Add API key validation middleware
5. Deploy to Railway

### Phase 2: Update local-tunnel / remote-tunnel
1. Add `--public-relay` flag
2. Read relay URL from `~/.claude/.public-relay-url`
3. Read API key from `~/.claude/.public-relay-key`
4. Register on startup: POST to relay with app_id + tunnel_url
5. Heartbeat every 30s
6. Unregister on SIGINT/shutdown

### Phase 3: Documentation & Onboarding
1. Update install.sh to optionally configure public relay
2. Add docs for self-hosting relay vs using public instance
3. Create simple admin tool for API key generation

## Files to Create/Modify

### New Files
```
public-relay/
├── src/
│   ├── index.ts          # Entry point, starts server
│   ├── relay.ts          # Express app + forwarding logic
│   ├── redis.ts          # Redis client + tenant registry
│   └── auth.ts           # API key validation
├── package.json
├── tsconfig.json
├── Dockerfile
└── railway.toml          # Railway config
```

### Modified Files
- `bin/local-tunnel` - Add `--public-relay` flag, registration logic
- `bin/remote-tunnel` - Add `--public-relay` flag, registration logic
- `install.sh` - Option to configure public relay URL
- `.claude/codemap.md` - Document new architecture

## Verification

1. Deploy relay to Railway
2. Create API key for test user
3. Run `local-tunnel --public-relay` on Mac
4. Verify registration: `redis-cli GET tenant:{app_id}`
5. Click Slack button → should forward to Mac and work
6. Stop local-tunnel → registration should expire after 60s
7. Click button again → should get "Session offline" error
8. Restart local-tunnel → should auto-register and work again
