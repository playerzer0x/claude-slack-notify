# Claude Slack Notify - Codemap

## Overview

Slack notifications for Claude Code with clickable buttons that work from mobile and desktop. Supports local Mac terminals, SSH sessions, and JupyterLab terminals.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER SCENARIOS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Mac-Based (slack-tunnel on Mac)                                        │
│  ─────────────────────────────────────────────────────────────────────  │
│  Phone/Slack → cloudflared (Mac) → MCP server (Mac) → focus-helper     │
│                                         ↓                               │
│                               ┌─────────┴─────────┐                     │
│                               ↓                   ↓                     │
│                         Local terminal      SSH → tmux (Linux)          │
│                         (iTerm2/Terminal)                               │
│                                                                         │
│  Remote-Only (remote-tunnel on Linux, Mac closed)                       │
│  ─────────────────────────────────────────────────────────────────────  │
│  Phone/Slack → cloudflared (Linux) → remote-relay (Linux)              │
│                                            ↓                            │
│                              ┌─────────────┴─────────────┐              │
│                              ↓                           ↓              │
│                    Mac reachable?               Mac unreachable?        │
│                              ↓                           ↓              │
│                    Proxy to Mac MCP           Direct tmux send-keys     │
│                    (Focus works)              (input only)              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
claude-slack-notify/
├── bin/                          # Executable scripts
│   ├── claude-slack-notify       # Main CLI: register, notify, link commands
│   ├── slack-tunnel              # Mac: Start tunnel + MCP server for buttons
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
| `slack-tunnel` | Start cloudflared + MCP server, update Slack Request URL | macOS |
| `remote-tunnel` | Start cloudflared + remote-relay for Mac-less operation | Linux |
| `focus-helper` | Handle `claude-focus://` URLs, switch terminals, send input | macOS |
| `mcp-server` | Launcher script for the Node.js MCP server | All |

### MCP Server (mcp-server/src/)

| File | Purpose |
|------|---------|
| `server.ts` | Express app with MCP endpoints and Slack routes |
| `remote-relay.ts` | Standalone webhook receiver for Linux (port 8464) |
| `routes/slack.ts` | Handle Slack button clicks, parse action values |
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

When bot token is configured (`slack-tunnel --setup` → enable thread replies):
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
  claude-focus://terminal/{tty}
  claude-focus://terminal-tmux/{tty}/{tmux_target}
  claude-focus://tmux/{tmux_target}

SSH sessions:
  claude-focus://ssh-linked/{link_id}/{host}/{user}/{port}/{tmux_target}
  claude-focus://ssh-tmux/{host}/{user}/{port}/{tmux_target}
  claude-focus://jupyter-tmux/{link_id}/{host}/{user}/{port}/{tmux_target}
```

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
slack-tunnel              # Start tunnel (interactive)
# In Claude: /slack-notify
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
remote-tunnel --background

# In Claude: /slack-notify
```

## Current Focus
> Last updated: 2026-01-21

### Recent Changes
- **Thread reply images**: Slack thread replies with images are downloaded to `~/.claude/slack-downloads/` and paths sent to Claude
- **Enhanced notifications**: Full context extraction from transcript (text + tool calls), truncation handling for Slack limits
- **Auto-update Events URL**: Both `slack-tunnel` and `remote-tunnel` now auto-update the Events Request URL alongside Actions URL
- **Bot scopes documented**: `chat:write` + `files:read` required for thread replies with images
- **Thread replies**: Slack thread reply routing to tmux sessions via Events API (text + images)
