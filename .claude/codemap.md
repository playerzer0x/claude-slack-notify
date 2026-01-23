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
│   ├── claude-slack-notify       # Main CLI: register, notify, remote commands
│   ├── local-tunnel              # Mac: Start tunnel + MCP server for buttons
│   ├── remote-tunnel             # Linux: Start tunnel + relay when Mac is closed
│   ├── focus-helper              # Mac: Handle claude-focus:// URLs
│   ├── mcp-server                # Launcher script for MCP server
│   ├── slack-notify-start        # Hook: Cancel stale watcher + start task timing
│   ├── slack-notify-waiting      # Hook: Start 30s stale-response watcher
│   ├── slack-notify-stale-watcher # Background: Sleep 30s then notify if still waiting
│   ├── extract-question-opts     # Python: Extract AskUserQuestion from transcript
│   ├── slack-notify-check        # Hook: Check elapsed time (legacy, for Stop events)
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
| `claude-slack-notify` | Main CLI - register sessions, send notifications, SSH to remote | All |
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
| `threads/*.json` | Thread mapping for reply routing (thread_ts → session) |
| `.remote-host` | Saved remote hostname for `remote` command (on Mac) |
| `.remote-sessions/{host}/*.json` | Multi-session storage per host (on Mac) |
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
URL format (default for ALL sessions since v1.0.4):
  url:{focus_url}|{action}
  Example: url:claude-focus://ssh-linked/link123/host/user/22/main:0.0|push

Legacy format (fallback only):
  {session_id}|{action}
  Example: abc123|continue
```

The `url:` prefix tells MCP server to use the URL directly without session lookup.
**v1.0.4**: URL format is now default for all sessions (more robust across project switches).

## Message Formatting (TOOL_FORMATTER)

Slack notifications extract rich context from Claude's responses using jq-based formatters. Two variants exist:

### Formatters
| Name | Location | Prefix | Use Case |
|------|----------|--------|----------|
| `TOOL_FORMATTER` | `claude-slack-notify` | `●` / `❓` | Completed task summaries |
| `TOOL_FORMATTER_WAITING` | `claude-slack-notify` | `⏳` / `❓` | Waiting/permission prompts |
| `TOOL_FORMATTER` | `slack-notify-waiting` | `⏳` / `❓` | Stale response notifications |

### Supported Tool Formats

| Tool | Format Example |
|------|----------------|
| `AskUserQuestion` | `❓ Which database?\n   1. PostgreSQL - Relational DB\n   2. MongoDB - Document DB` |
| `Bash` | `⏳ Bash: npm install (Install dependencies)` |
| `Edit` | `⏳ Edit: src/index.ts (replacing old_code...)` |
| `Write` | `⏳ Write: src/new-file.ts` |
| `Read` | `⏳ Read: src/index.ts (from line 50)` |
| `Glob` | `⏳ Glob: **/*.ts in src/` |
| `Grep` | `⏳ Grep: TODO in src/` |
| `Task` | `⏳ Task (Explore): Find database config` |
| `WebFetch` | `⏳ WebFetch: https://example.com` |
| `WebSearch` | `⏳ WebSearch: react hooks tutorial` |
| `Skill` | `⏳ Skill: /commit` |
| `EnterPlanMode` | `⏳ Entering plan mode` |
| `ExitPlanMode` | `⏳ Exiting plan mode - awaiting approval` |
| `mcp__*` | `⏳ MCP: server/tool (arg=value)` |

### Context Extraction Flow

```
Hook Event (stdin JSON)
    ↓
┌─────────────────────────────────────┐
│ 1. Direct tool info from hook data  │  (PermissionRequest, Notification)
│    tool_name + tool_input → format  │
└─────────────────────────────────────┘
    ↓ (if no direct info)
┌─────────────────────────────────────┐
│ 2. Extract from transcript          │  (Stop, SubagentStop)
│    transcript_path → read last      │
│    assistant message → format       │
│    text blocks + tool_use blocks    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. Append notification message      │  (if present and different)
│    "Claude needs your permission"   │
└─────────────────────────────────────┘
    ↓
Slack Message Payload
```

### Adding New Tool Formats

To add formatting for a new tool:
1. Add `elif .name == "NewTool" then` block in both formatters
2. Extract relevant fields from `.input`
3. Use appropriate prefix (`⏳` for waiting, `●` for completed, `❓` for questions)
4. Keep output concise (Slack has ~3000 char limit per block)

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

### SSH to Linux Server (simplified)
```bash
# On Mac:
claude-slack-notify remote
# First run: prompts for hostname, syncs Slack config
# Then: SSH + tmux session
# In Claude: /slack-notify
```

### Linux Server (Mac Closed)
```bash
# Run on the Linux server directly:
remote-tunnel --background    # Uses Tailscale Funnel if available

# Force specific backend:
remote-tunnel --use-tailscale    # Force Tailscale Funnel
remote-tunnel --use-localtunnel  # Force Localtunnel

# In Claude: /slack-notify
```

## Troubleshooting

### Focus Button Not Working

#### 1. nginx/Caddy Blocking Port 443 (Linux)

**Symptom**: Clicking Focus button does nothing. No entries in `~/.claude/logs/focus-debug.log` on Mac.

**Root cause**: nginx or Caddy is listening on port 443, intercepting Tailscale Funnel traffic before it reaches the remote-relay.

**Diagnosis**:
```bash
# Check what's on port 443
ss -tlnp | grep :443

# Test if funnel is working (should show mode:remote-relay)
curl -sk "https://your-server.ts.net/health"
# If you see something else (like port:3007), nginx is intercepting
```

**Fix**: Stop nginx/caddy or add a reverse proxy rule:
```bash
sudo systemctl stop nginx && sudo systemctl disable nginx
```

**Prevention**: `remote-tunnel` now warns if another process is on port 443.

#### 2. Mac MCP Server Self-Loop (v1.0.0)

**Symptom**: Server logs show "Mac returned 404: Cannot POST /focus"

**Root cause**: Two bugs:
1. `forwardToMac()` called `/focus` but endpoint is `/slack/focus` (router mounted at `/slack`)
2. Mac read `.mac-tunnel-url` pointing to itself, causing infinite loop

**Fix** (v1.0.1):
- `loadMacTunnelUrl()` returns null on Mac (`process.platform === 'darwin'`)
- `forwardToMac()` now calls `/slack/focus`

**Workaround** (before updating):
```bash
rm ~/.claude/.mac-tunnel-url  # On Mac
# Restart MCP server
```

### Debugging Checklist

1. **Is MCP server running?**
   ```bash
   curl http://localhost:8463/health
   ```

2. **Is it running NEW code?**
   ```bash
   ls -la ~/.claude/mcp-server-dist/dist/routes/slack.js
   ```

3. **Is tunnel URL correct in Slack app?**
   ```bash
   # Tailscale Funnel
   curl -sk "https://your-server.ts.net/health"
   ```

4. **Check logs after clicking**:
   ```bash
   tail ~/.claude/mcp-server.log
   tail ~/.claude/logs/focus-debug.log
   ```

## Version History

| Version | Changes |
|---------|---------|
| v1.0.5 | Dynamic Slack buttons for AskUserQuestion, removed Escape key interrupt |
| v1.0.4 | Fixed cross-session notification pollution, URL-first buttons |
| v1.0.3 | Cross-platform session locking (macOS, Windows Git Bash/MSYS2 support) |
| v1.0.2 | Add port 443 conflict warning in `remote-tunnel` |
| v1.0.1 | Fix Focus button self-loop bug on Mac (platform check + correct endpoint) |
| v1.0.0 | Initial release with remote-as-canonical architecture |

## Current Focus
> Last updated: 2026-01-23

### Recent Changes

- **v1.0.5: Dynamic Slack buttons for AskUserQuestion** (2026-01-23)
  - **Feature**: Slack notifications now show the actual question options as buttons
  - **Implementation**:
    - `bin/extract-question-opts`: Python helper - extracts from MOST RECENT assistant message only (prevents stale buttons)
    - `bin/slack-notify-waiting`: Extracts options IMMEDIATELY when hook fires (100 lines search)
    - `bin/slack-notify-stale-watcher`: Uses pre-saved options, fallback extraction (500 lines)
    - `bin/claude-slack-notify`: Builds dynamic buttons from extracted options
  - **Fix**: Removed Escape key from all input paths (was interrupting Claude)
    - `bin/focus-helper`: Removed from local/SSH tmux input
    - `mcp-server/src/remote-relay.ts`: Removed from relay input
  - **Tool handlers added**: Playwright browser tools, TaskCreate/Update/Get/List, KillShell, TaskOutput

- **v1.0.4: Fixed cross-session notification pollution** (2026-01-22)
  - **Root cause**: Multiple Claude sessions sharing same project directory caused wrong instance names in Slack
  - **Problem flow**: `get-session-id` returned most recent transcript across ALL sessions in project; hooks received correct session_id but instance file lookup failed
  - **Fixes implemented**:
    1. **Removed `$PPID` fallback**: `CLAUDE_INSTANCE_ID` is now required, not guessed
    2. **TERM_TARGET fallback lookup**: When session_id doesn't match, searches instances by tmux session name
    3. **URL-first buttons**: All buttons now use `url:${FOCUS_URL}` format (eliminates session file lookup)
    4. **Stale instance cleanup**: `/slack-notify clean` now removes instance files for dead tmux sessions
  - **Files changed**: `bin/claude-slack-notify`, `bin/slack-notify-start`, `bin/slack-notify-waiting`
  - **Key insight**: Session IDs change across project switches and conversation compaction; tmux session names are stable

- **Fixed instance name preservation on re-registration**: Instance names now persist when `/slack-notify register` runs multiple times
  - Root cause: Cleanup logic deleted instance files BEFORE checking for existing names
  - Fix: Restructured registration into 3 phases:
    1. Extract existing name from files matching `$TERM_TARGET` (before cleanup)
    2. Clean up old session files for this terminal
    3. Use preserved name or generate new if none found
  - Key insight: Lookup by `$TERM_TARGET` (stable) not `$INSTANCE_ID` (which is `$PPID`, unstable)
  - Location: `bin/claude-slack-notify` lines ~1717-1760

- **Stale response notifications with rich context**: Notify when Claude's response has been sitting unanswered for 30s
  - `slack-notify-waiting`: Starts background watcher, extracts full assistant message context
    - Uses `TOOL_FORMATTER` jq filter to format tool calls richly
    - `AskUserQuestion`: Shows questions with numbered options and descriptions
    - `Bash`: Shows command with description
    - Other tools: Shows relevant context (file path, pattern, URL, etc.)
  - `slack-notify-stale-watcher`: Sleeps 30s, sends notification with extracted context if user hasn't responded
  - `slack-notify-start`: Updated to cancel pending watchers when user sends input
  - Hooks: Notification events now use waiting mechanism instead of immediate notify
  - Env: `CLAUDE_NOTIFY_STALE_SECONDS` to customize delay (default: 30)

- **Interactive session menu with arrow navigation**: The `remote` command now uses a clean, interactive menu:
  - Up/Down arrow keys (or j/k vim keys) for navigation
  - Enter to select, 'n' for new session, 'q' to quit
  - Each session name has a unique color (hash-based, consistent)
  - Selected item highlighted with reverse video
  - Hidden cursor during navigation for clean appearance

- **v1.0.3: Cross-platform session locking**: `acquire_session_lock()` now works on:
  - Linux: uses `flock` (existing behavior)
  - WSL: uses `flock` (it's Linux)
  - macOS: mkdir-based locking (atomic operation)
  - Windows (Git Bash/MSYS2): mkdir-based locking with GNU stat
  - Handles BSD vs GNU stat syntax for stale lock detection (1hr timeout)

- **Multi-session support for `remote` command**: When connecting to a host with multiple tmux sessions:
  - Interactive menu shows sessions sorted by last connected time
  - Relative time display (e.g., "connected 10 min ago")
  - `--session NAME` flag for direct session selection
  - `--new` flag still works to force create new session
  - Dead sessions cleaned up automatically
  - Storage: `~/.claude/.remote-sessions/{host}/{session}.json`
  - Migrates from old single-file format automatically

- **Simplified `remote` command**: On Mac, `claude-slack-notify remote` now:
  - First run: prompts for hostname, saves to `~/.claude/.remote-host`, syncs Slack config
  - Creates link file and detects local terminal for Focus button support
  - Passes `CLAUDE_LINK_ID`, `CLAUDE_SSH_HOST`, `CLAUDE_INSTANCE_NAME` to remote tmux
  - Syncs Mac tunnel URL to remote for button routing
  - Removed verbose `link --host` output (~250 lines simplified)
- **v1.0.2**: Port 443 conflict warning in `remote-tunnel`
- **v1.0.1**: Fixed Mac MCP server self-loop bug
- **Remote as canonical endpoint**: Remote server now receives all Slack button clicks
  - Input actions (1, 2, continue, push) handled locally on Remote
  - Focus action forwarded to Mac's `/slack/focus` endpoint
  - Buttons work even when Mac is offline (input only)
- **Instant button response**: ACK Slack immediately, process in background
- **Mac tunnel URL sync**: `remote` syncs Slack config on first run
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
