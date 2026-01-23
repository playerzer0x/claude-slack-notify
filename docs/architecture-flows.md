# Architecture Flows

Two separate systems exist for routing Slack interactions to Claude sessions. This document clarifies their differences.

---

## System 1: Direct Tunnel (Mac + Linux Server)

**Status: ACTIVE - This is what we're running**

The user runs tunnels on machines they control. Slack sends webhooks directly to these tunnels.

### Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR INFRASTRUCTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐              ┌─────────────────────┐           │
│  │ Mac (your laptop)   │              │ Linux Server        │           │
│  │                     │              │ (time-machine)      │           │
│  │ local-tunnel        │              │                     │           │
│  │   └─ MCP server     │◄─── SSH ────►│ remote-tunnel       │           │
│  │      (port 8463)    │              │   └─ remote-relay   │           │
│  │   └─ Tailscale      │              │      (port 8464)    │           │
│  │      Funnel         │              │   └─ Tailscale      │           │
│  │                     │              │      Funnel         │           │
│  │ focus-helper        │              │                     │           │
│  │ ~/.claude/links/    │              │ ~/.claude/instances/│           │
│  │ ~/.claude/threads/  │              │ ~/.claude/threads/  │           │
│  └─────────────────────┘              └─────────────────────┘           │
│           ▲                                    ▲                        │
│           │                                    │                        │
└───────────┼────────────────────────────────────┼────────────────────────┘
            │                                    │
            │              SLACK                 │
            │                                    │
    ┌───────┴────────┐                  ┌───────┴────────┐
    │ Interactivity  │                  │ Event          │
    │ Request URL    │                  │ Subscriptions  │
    │ (buttons)      │                  │ (thread replies)│
    └────────────────┘                  └────────────────┘
```

### How Button Clicks Work

1. **Slack Interactivity Request URL** points to: `https://time-machine.singapura-sargas.ts.net/slack/actions`
2. User clicks button in Slack
3. Slack POSTs to remote-relay on Linux server
4. remote-relay checks if Mac is reachable:
   - **Mac up**: Proxies entire request to Mac's MCP server for full experience
   - **Mac down**: Handles locally via tmux send-keys (input buttons only, no Focus)

### How Thread Replies Work

1. **Slack Event Subscriptions Request URL** points to: `https://time-machine.singapura-sargas.ts.net/slack/events`
2. Notification is sent → `~/.claude/threads/{thread_ts}.json` is created
3. User replies in Slack thread
4. Slack POSTs event to remote-relay
5. remote-relay looks up thread → finds focus_url
6. Extracts tmux target from focus_url
7. Sends text to tmux via `tmux send-keys`

### Key Files

| File | Location | Purpose |
|------|----------|---------|
| `~/.claude/.mac-tunnel-url` | Linux | Mac's tunnel URL for proxying |
| `~/.claude/.tunnel-url` | Mac | Mac's own tunnel URL |
| `~/.claude/.remote-tunnel-url` | Linux | Linux's tunnel URL |
| `~/.claude/threads/*.json` | Both | Thread → session mapping |
| `~/.claude/instances/*.json` | Both | Session registration |
| `~/.claude/links/*.json` | Mac only | SSH link info for focus-helper |

### Slack App Configuration Required

Your Slack app needs TWO URLs configured:

1. **Interactivity & Shortcuts → Request URL**:
   ```
   https://time-machine.singapura-sargas.ts.net/slack/actions
   ```

2. **Event Subscriptions → Request URL**:
   ```
   https://time-machine.singapura-sargas.ts.net/slack/events
   ```

   With these bot events subscribed:
   - `message.channels` (or `message.groups` for private channels)

---

## System 2: Public Relay (Hosted Service)

**Status: NOT ACTIVE - Future implementation for users without their own server**

A centralized relay service that routes Slack webhooks to wherever the user's tunnel is.

### Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC RELAY (Railway)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Slack (any user's app)                                                 │
│         │                                                                │
│         ▼                                                                │
│  POST /slack/actions or /slack/events                                   │
│         │                                                                │
│         ▼                                                                │
│  Extract app_id from payload                                            │
│         │                                                                │
│         ▼                                                                │
│  Lookup tenant in Redis: tenant:{app_id} → tunnel_url                   │
│         │                                                                │
│         ▼                                                                │
│  Forward request to user's tunnel with X-Relay-Secret header            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ├────────────────────────────────────┐
            │                                    │
            ▼                                    ▼
┌───────────────────────┐            ┌───────────────────────┐
│ User A (Mac only)     │            │ User B (has server)   │
│                       │            │                       │
│ local-tunnel          │            │ remote-tunnel         │
│   --public-relay      │            │   --public-relay      │
│                       │            │                       │
│ Registers with relay: │            │ Registers with relay: │
│ POST /register        │            │ POST /register        │
│ {                     │            │ {                     │
│   app_id: "...",      │            │   app_id: "...",      │
│   tunnel_url: "...",  │            │   tunnel_url: "...",  │
│   tunnel_secret: "..."|            │   tunnel_secret: "..."|
│ }                     │            │ }                     │
│                       │            │                       │
│ Heartbeat every 30s   │            │ Heartbeat every 30s   │
└───────────────────────┘            └───────────────────────┘
```

### How It Works

1. User runs `local-tunnel --public-relay` or `remote-tunnel --public-relay`
2. Tunnel registers with public relay: POST /register
3. Heartbeat sent every 30s to keep registration alive (60s TTL)
4. **Slack app points to public relay URL** (shared by all users)
5. Relay extracts `app_id` from Slack payload
6. Relay looks up tunnel URL in Redis
7. Relay forwards request with `X-Relay-Secret` header
8. User's MCP server verifies secret before processing

### Key Files (for public relay)

| File | Location | Purpose |
|------|----------|---------|
| `~/.claude/.public-relay-url` | User | Public relay server URL |
| `~/.claude/.public-relay-key` | User | API key for registration |
| `~/.claude/.relay-tunnel-secret` | User | Secret for relay→tunnel auth |

### Differences from System 1

| Aspect | System 1 (Direct) | System 2 (Public Relay) |
|--------|-------------------|-------------------------|
| Slack webhook target | Your tunnel directly | Public relay server |
| Who manages URLs | You (update Slack app) | Relay handles routing |
| Requires server | Yes (or always-on Mac) | No (relay handles offline) |
| Registration | Not needed | Required (heartbeat) |
| Authentication | Slack signature only | Slack sig + relay secret |

---

## Debugging Checklist

### System 1 Issues

#### Buttons Not Working

1. **Is remote-relay running?**
   ```bash
   curl http://localhost:8464/health
   ```

2. **Is Tailscale Funnel running?**
   ```bash
   tailscale funnel status
   ```

3. **Is Slack configured correctly?**
   - Check Interactivity Request URL in Slack app settings
   - Should be: `https://your-server.ts.net/slack/actions`

4. **Check logs:**
   ```bash
   tail -f ~/.claude/remote-tunnel.log
   ```

#### Thread Replies Not Working

1. **Is thread file created?**
   ```bash
   ls -la ~/.claude/threads/ | tail -5
   cat ~/.claude/threads/LATEST.json
   ```

2. **Is Event Subscriptions URL configured in Slack?**
   - Go to api.slack.com → Your App → Event Subscriptions
   - Request URL should be: `https://your-server.ts.net/slack/events`
   - Must have `message.channels` or `message.groups` subscribed

3. **Test endpoint externally:**
   ```bash
   curl -X POST https://your-server.ts.net/slack/events \
     -H "Content-Type: application/json" \
     -d '{"type":"url_verification","challenge":"test"}'
   # Should return: {"challenge":"test"}
   ```

4. **Check if events arrive:**
   - Remote-relay logs should show "Thread reply received"
   - If no logs appear, Slack isn't sending events (config issue)

---

## Current Setup Summary

**You are running System 1** with:
- Linux server: `time-machine.singapura-sargas.ts.net`
- remote-relay on port 8464
- Tailscale Funnel exposing port 8464

**Slack App Configuration Needed:**
1. Interactivity Request URL: `https://time-machine.singapura-sargas.ts.net/slack/actions` ✓ (buttons work)
2. Event Subscriptions Request URL: `https://time-machine.singapura-sargas.ts.net/slack/events` ← **CHECK THIS**
