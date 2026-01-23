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
2. Notification is sent → `~/.claude/threads/{thread_ts}.json` is created **on the machine that sent the notification**
3. User replies in Slack thread
4. Slack POSTs event to remote-relay on Linux
5. remote-relay looks up thread:
   - **Found locally** (Linux session): Handle via `tmux send-keys`
   - **Not found locally** (Mac session): Forward to Mac's MCP server
6. Target machine extracts focus_url from thread info
7. Sends text to terminal

### Thread File Location (Critical!)

Thread files are stored **on the machine that sent the notification**:

| Notification sent from | Thread file location | Reply handling |
|------------------------|---------------------|----------------|
| Linux (ssh-linked, tmux) | Linux `~/.claude/threads/` | Linux handles locally |
| Mac (iTerm2, Terminal.app) | Mac `~/.claude/threads/` | Linux forwards to Mac |

**This is why Mac session replies require forwarding** - the thread mapping only exists on Mac.

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

## Terminal Input Handling (Mac)

When sending text to Mac terminals (thread replies or button inputs), proper session targeting is critical.

### iTerm2 Session Targeting

The session UUID from `$ITERM_SESSION_ID` uniquely identifies the exact tab:

```
claude-focus://iterm2/w0t0p0:3A7B9C2D-E4F5-6789-ABCD-EF0123456789
                      └─────────────────────────────────────────┘
                                    Session UUID
```

**focus-helper** uses this UUID to target the exact session:

```applescript
tell application "iTerm2"
    repeat with s in sessions of t
        if (id of s) is "w0t0p0:3A7B9C2D..." then
            -- 1. Select this specific session
            select s
            -- 2. Bring window to front
            set index of w to 1
            -- 3. Activate iTerm2
            activate
            -- 4. Wait for focus to settle
            delay 0.15
            -- 5. Send text (without newline)
            tell s to write text "user input" newline NO
            -- 6. Wait for text to appear
            delay 0.1
            -- 7. Send Return via System Events (now correctly targeted)
            tell application "System Events"
                key code 36
            end tell
        end if
    end repeat
end tell
```

**Why this sequence matters:**
- `write text` alone with `& return` sends a newline character, which Claude Code doesn't interpret as "submit"
- System Events `key code 36` sends a proper Return keypress, but goes to the **frontmost app**
- We must ensure the correct session is frontmost before sending the keystroke

### Terminal.app Handling

Similar approach - select the correct tab by TTY before sending keystrokes:

```applescript
tell application "Terminal"
    repeat with t in tabs of w
        if (tty of t) is "/dev/ttys001" then
            set frontmost of w to true
            set selected of t to true
            activate
            delay 0.1
            -- Now System Events goes to the right place
        end if
    end repeat
end tell
```

### Common Pitfalls

1. **Text appears but doesn't submit**: Using `write text` with newline character instead of System Events Return
2. **Wrong window receives input**: Not waiting for focus to settle (`delay 0.15`) before System Events
3. **Input goes to wrong app**: Not activating the terminal app before System Events keystroke

---

## Current Setup Summary

**You are running System 1** with:
- Linux server: `time-machine.singapura-sargas.ts.net`
- remote-relay on port 8464
- Tailscale Funnel exposing port 8464

**Slack App Configuration Needed:**
1. Interactivity Request URL: `https://time-machine.singapura-sargas.ts.net/slack/actions` ✓ (buttons work)
2. Event Subscriptions Request URL: `https://time-machine.singapura-sargas.ts.net/slack/events` ← **CHECK THIS**
