# Claude Slack Notify - Codemap

## Overview

Slack notifications for Claude Code with clickable buttons that work from mobile and desktop. Supports local Mac terminals, SSH sessions, and JupyterLab terminals.

## Architecture

**Remote is the canonical Slack endpoint.** All button clicks go to Remote first.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CANONICAL ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phone/Slack → Remote tunnel → MCP server (Remote)                     │
│                                      ↓                                  │
│                    ┌─────────────────┴─────────────────┐                │
│                    ↓                                   ↓                │
│           Input Actions                        Focus Action             │
│       (1, 2, continue, push)                  (focus terminal)          │
│                    ↓                                   ↓                │
│         tmux send-keys                    Forward to Mac tunnel         │
│          (handled locally)                (~/.claude/.mac-tunnel-url)   │
│                                                        ↓                │
│                                              Mac MCP /focus endpoint    │
│                                                        ↓                │
│                                                  focus-helper           │
│                                                        ↓                │
│                                           Focus Mac terminal window     │
│                                                                         │
│  Benefits:                                                              │
│  • Buttons work even when Mac is off (input actions)                   │
│  • Fast response (Remote ACKs Slack immediately)                       │
│  • Focus still works when Mac is reachable                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
claude-slack-notify/
├── bin/                          # Executable scripts
│   ├── claude-slack-notify       # Main CLI: register, notify, link commands
│   ├── local-tunnel              # Mac: Start tunnel + MCP server for buttons
│   ├── remote-tunnel             # Linux: Start tunnel + relay when Mac is closed
│   ├── focus-helper              # Mac: Handle claude-focus:// URLs
│   ├── mcp-server                # Launcher script for MCP server
│   ├── slack-notify-start        # Hook: Start timing on user prompt
│   ├── slack-notify-check        # Hook: Check elapsed time and notify
│   └── get-session-id            # Get Claude session ID
│
├── mcp-server/                   # Node.js MCP server
│   ├── src/
│   │   ├── index.ts              # Entry point (starts server)
│   │   ├── server.ts             # Express app + MCP setup
│   │   ├── remote-relay.ts       # Linux webhook handler with auto-detect
│   │   ├── remote-relay.test.ts  # Tests for remote-relay
│   │   ├── routes/
│   │   │   └── slack.ts          # POST /slack/actions handler
│   │   ├── lib/
│   │   │   ├── slack-verify.ts   # Slack signature verification
│   │   │   ├── focus-executor.ts # Execute focus-helper with URLs
│   │   │   ├── session-store.ts  # Read session files from ~/.claude/instances/
│   │   │   └── *.test.ts         # Unit tests
│   │   └── tools/
│   │       └── index.ts          # MCP tool definitions
│   ├── dist/                     # Compiled JavaScript
│   └── package.json              # Dependencies + scripts
│
├── commands/
│   └── slack-notify.md           # Claude /slack-notify command definition
│
├── install.sh                    # Installation script
├── CLAUDE.md                     # Project instructions for Claude
└── .claude/
    └── codemap.md                # This file
```

## Key Files

### Scripts (bin/)

| File | Purpose | Platform |
|------|---------|----------|
| `claude-slack-notify` | Main CLI - register sessions, send notifications, create SSH links | All |
| `local-tunnel` | Start tunnel + MCP server with /focus endpoint for forwarding | macOS |
| `remote-tunnel` | Start tunnel + MCP server (canonical Slack endpoint) | Linux |
| `focus-helper` | Handle `claude-focus://` URLs, switch terminals, send input | macOS |
| `mcp-server` | Launcher script for the Node.js MCP server | All |

### MCP Server (mcp-server/src/)

| File | Purpose |
|------|---------|
| `server.ts` | Express app with MCP endpoints and Slack routes |
| `remote-relay.ts` | Standalone webhook receiver for Linux (port 8464) |
| `routes/slack.ts` | Handle Slack button clicks, /focus endpoint, smart routing |
| `lib/focus-executor.ts` | Execute focus-helper with focus URLs |
| `lib/slack-verify.ts` | Verify Slack request signatures |
| `lib/session-store.ts` | Read session JSON files |

### Runtime Files (~/.claude/)

| File | Purpose |
|------|---------|
| `instances/*.json` | Registered Claude sessions (on machine running Claude) |
| `links/*.json` | SSH link info (on local Mac only) |
| `threads/*.json` | Thread mapping for reply routing (thread_ts → session) |
| `slack-downloads/` | Downloaded images from Slack thread replies |
| `.slack-config` | Slack App ID + tokens for API access |
| `slack-signing-secret` | Slack signing secret for request verification |
| `.mac-tunnel-url` | Mac's tunnel URL for remote-relay auto-detect |
| `.tunnel.pid` | PID of running cloudflared tunnel |
| `.mcp-server.pid` | PID of running MCP server |
| `.remote-relay.pid` | PID of running remote relay |
| `.localtunnel-subdomain` | Stable Localtunnel subdomain (local-tunnel) |
| `.remote-localtunnel-subdomain` | Stable Localtunnel subdomain (remote-tunnel) |

## Button Value Formats

Slack button values encode session info for the MCP server:

```
Traditional (local sessions):
  {session_id}|{action}
  Example: abc123|continue

Direct URL (SSH/Jupyter sessions):
  url:{focus_url}|{action}
  Example: url:claude-focus://ssh-linked/link123/host/user/22/main:0.0|push
```

The `url:` prefix tells MCP server to use the URL directly without session lookup.

## Thread Replies

When bot token is configured (`local-tunnel --setup` → enable thread replies):
1. Notifications are sent via `chat.postMessage` API (not webhook)
2. The `thread_ts` is saved to `~/.claude/threads/{ts}.json`
3. Slack Events API sends replies to `/slack/events`
4. The reply text (+ file paths for images) is routed to the correct tmux session

**Image support:** Images in thread replies are downloaded to `~/.claude/slack-downloads/` and the file path is sent to Claude (requires `files:read` bot scope).

**Focus URL query parameters:**
- `?action=continue` - Send predefined action input
- `?text=hello%20world` - Send arbitrary text (URL-encoded)

## Focus URL Schemes

```
Local terminals:
  claude-focus://iterm2/{session_uuid}
  claude-focus://iterm-tmux/{tty}/{tmux_target}
  claude-focus://terminal/{tty}              # TTY like /dev/ttys001
  claude-focus://terminal/frontmost          # Fallback: focus frontmost window
  claude-focus://terminal-tmux/{tty}/{tmux_target}
  claude-focus://tmux/{tmux_target}

SSH sessions:
  claude-focus://ssh-linked/{link_id}/{host}/{user}/{port}/{tmux_target}
  claude-focus://ssh-tmux/{host}/{user}/{port}/{tmux_target}
  claude-focus://jupyter-tmux/{link_id}/{host}/{user}/{port}/{tmux_target}
```

## Terminal Detection & TTY Gotchas

**Problem:** When Claude Code runs `/slack-notify`, it executes the script as a subprocess without a controlling TTY. This causes `tty` to return "not a tty" and terminal detection fails.

**Solution:** The `detect_terminal()` function in `bin/claude-slack-notify` uses a fallback chain:
1. Try `tty` command directly
2. If that fails, try `ps -o tty= -p $PPID` to get parent's TTY
3. If that also fails (Claude's process tree is fully detached), fall back to `frontmost`

The `frontmost` special value tells `focus-helper` to just activate Terminal.app without looking for a specific tab. This works because Claude is typically running in the user's active terminal window anyway.

**Why iTerm2 doesn't have this problem:** iTerm2 exposes `$ITERM_SESSION_ID` which persists across subprocesses, so detection always works.

## Testing Commands

```bash
# Build MCP server
cd mcp-server && bun run build

# Run tests
bun run test

# Type check
bun run typecheck

# Start MCP server (for development)
bun run dev

# Start remote relay (for development)
bun run dev:relay
```

## Common Workflows

### Local Mac Development
```bash
local-tunnel              # Start tunnel (uses Tailscale Funnel if available)
# In Claude: /slack-notify

# Force specific backend:
local-tunnel --use-tailscale    # Force Tailscale Funnel
local-tunnel --use-localtunnel  # Force Localtunnel
```

### SSH to Linux Server
```bash
# On Mac:
claude-slack-notify link --host user@server
# Follow prompts, then in Claude: /slack-notify
```

### Linux Server (Mac Closed)
```bash
# Config is auto-synced when you use `link --host` from Mac
# Just start the remote tunnel:
remote-tunnel --background    # Uses Tailscale Funnel if available

# Force specific backend:
remote-tunnel --use-tailscale    # Force Tailscale Funnel
remote-tunnel --use-localtunnel  # Force Localtunnel

# In Claude: /slack-notify
```

## Current Focus
> Last updated: 2026-01-22

### Recent Changes
- **Remote as canonical endpoint**: Remote server now receives all Slack button clicks
  - Input actions (1, 2, continue, push) handled locally on Remote
  - Focus action forwarded to Mac's `/focus` endpoint
  - Buttons work even when Mac is offline (input only)
- **Instant button response**: ACK Slack immediately, process in background
- **Mac tunnel URL sync**: `link --host` stores Mac's tunnel URL on remote
- **Removed Slack URL auto-update**: `local-tunnel` no longer changes Slack Request URL

### Previous Changes
- **Simplified setup output**: Streamlined `install.sh` and `local-tunnel --setup`
- **`/slack-notify stop`**: Unregister session and stop tunnel
- **`update` command**: Quick script update from repo
- **`status` command**: Show system overview

### Runtime Files Added
| File | Purpose |
|------|---------|
| `~/.claude/.mac-tunnel-url` | Mac's tunnel URL for Focus forwarding (on remote) |
| `~/.claude/.env` | Tailscale API key (never copied to remotes) |
| `.claudeignore` | Prevents Claude from reading credentials |
