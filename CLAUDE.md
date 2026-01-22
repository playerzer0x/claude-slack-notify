# Claude Code Notes for claude-slack-notify

Project-specific context for Claude Code sessions working on this codebase.

## Architecture Overview

```
Local Mac                              Remote Server (time-machine)
─────────────                          ────────────────────────────
┌─────────────────┐                    ┌─────────────────┐
│ local-tunnel    │                    │ Claude Code     │
│  ├─ ngrok       │◄───── Slack ──────►│  └─ /slack-notify│
│  └─ MCP server  │                    │     (hooks)     │
├─────────────────┤                    └─────────────────┘
│ focus-helper    │◄─────────────────── SSH ──────────────
│ ~/.claude/links/│                    │ ~/.claude/instances/
└─────────────────┘                    └─────────────────┘
```

**Key insight**: For linked SSH sessions, the session file is on the **remote**, but the MCP server runs on the **local** Mac.

## Common Pitfalls

### 1. Button Clicks Not Working for SSH-Linked Sessions

**Symptom**: Clicking Slack buttons does nothing for remote sessions.

**Root cause**: The MCP server on local Mac tries to look up the session by ID, but the session file (`~/.claude/instances/*.json`) only exists on the remote server.

**Solution** (implemented): For `ssh-linked` and `jupyter-tmux` sessions, embed the focus URL directly in the button value instead of the session ID:
- Old format: `session_id|action`
- New format: `url:claude-focus://ssh-linked/...|action`

The MCP server detects the `url:` prefix and uses the URL directly without session lookup.

**Files involved**:
- `bin/claude-slack-notify` - Generates button values (lines ~893-943)
- `mcp-server/src/routes/slack.ts` - Parses button values
- `mcp-server/src/lib/focus-executor.ts` - `executeFocusUrl()` function

### 2. MCP Server Running Old Code

**Symptom**: Changes to MCP server code don't take effect.

**Root cause**: Two dist locations exist:
1. `~/.claude/mcp-server-dist/dist/` - Installed copy (used in production)
2. `./mcp-server/dist/` - Development copy

The `bin/mcp-server` script **prioritizes the installed copy**. After rebuilding, you must:
1. Copy new dist to installed location
2. Restart the MCP server process

**Solution** (implemented): `local-tunnel` now:
- Auto-rebuilds if source is newer than dist
- Copies to installed location automatically
- Always restarts MCP server on startup
- Kills MCP server on Ctrl+C

### 3. Link File Location

**Remember**: Link files (`~/.claude/links/*.json`) only exist on the **local Mac** where `claude-slack-notify link` was run. The remote server doesn't have them.

The `focus-helper` script reads link files to find the local terminal info for focusing.

### 4. Focus Button Doesn't Work - nginx/Caddy Blocking Tailscale Funnel

**Symptom**: Clicking Focus button in Slack does nothing. No new entries in `~/.claude/logs/focus-debug.log` on Mac.

**Root cause**: On Linux server, nginx or Caddy is already listening on port 443 for the Tailscale domain (e.g., `time-machine.singapura-sargas.ts.net`). Tailscale Funnel can't intercept HTTPS traffic because nginx/Caddy handles it first.

**Diagnosis**:
```bash
# Check what's on port 443
ss -tlnp | grep :443

# Test if funnel is working (should show mode:remote-relay)
curl -sk "https://your-server.ts.net/health"
# If you see something else (like port:3007), nginx is intercepting
```

**Solution**: Either:
1. Stop nginx/Caddy if not needed:
   ```bash
   sudo systemctl stop nginx && sudo systemctl disable nginx
   ```
2. Or add a reverse proxy rule in nginx for `/slack/*` → `localhost:8464`

**Files involved**:
- `/etc/nginx/sites-available/*` - nginx config
- `~/.claude/bin/remote-tunnel` - starts Tailscale Funnel

### 5. Focus Button Doesn't Work - Mac MCP Server Self-Loop

**Symptom**: Clicking Focus button shows "Mac returned 404: Cannot POST /focus" in server logs.

**Root cause**: Two bugs combined:
1. `local-tunnel` writes Mac's own tunnel URL to `~/.claude/.mac-tunnel-url`
2. `forwardToMac()` in slack.ts called `/focus` instead of `/slack/focus`
3. MCP server on Mac reads `.mac-tunnel-url` and tries to forward to itself

**Diagnosis**:
```bash
# On Mac - check if .mac-tunnel-url exists and points to self
cat ~/.claude/.mac-tunnel-url
# If this shows your Mac's tunnel URL, that's the bug
```

**Solution** (implemented in code):
1. Fixed endpoint: `forwardToMac()` now calls `/slack/focus` not `/focus`
2. Fixed self-loop: `loadMacTunnelUrl()` returns null on Mac (`process.platform === 'darwin'`)

**Workaround** (before fix is deployed):
```bash
# On Mac, delete the self-referencing file
rm ~/.claude/.mac-tunnel-url
# Restart MCP server
```

**Files involved**:
- `mcp-server/src/routes/slack.ts` - `loadMacTunnelUrl()` and `forwardToMac()`
- `bin/local-tunnel` - writes `.mac-tunnel-url` (line ~161)

### 6. Terminal.app Detection Fails (No Buttons on Mac)

**Symptom**: Running `/slack-notify` in Claude on Mac Terminal.app shows notification but no buttons.

**Root cause**: Claude Code runs scripts as subprocesses without a controlling TTY. The `tty` command returns "not a tty" and terminal detection fails, resulting in `term_type: "unknown"` and empty `focus_url`.

**Why iTerm2 works**: iTerm2 exposes `$ITERM_SESSION_ID` environment variable which persists across subprocesses.

**Solution** (implemented): `detect_terminal()` in `bin/claude-slack-notify` uses a fallback chain:
1. Try `tty` command directly
2. If that fails, try `ps -o tty= -p $PPID` to get parent's TTY
3. If that also fails, use `frontmost` as a special value

The `frontmost` value tells `focus-helper` to just activate Terminal.app without looking for a specific tab. This works because Claude is typically running in the user's active terminal window.

**Files involved**:
- `bin/claude-slack-notify` - `detect_terminal()` function (~line 1101)
- `bin/focus-helper` - `switch_terminal_tab()` and `send_terminal_input()` handle `frontmost`

## Development Workflow

### Making MCP Server Changes

```bash
# 1. Edit source files in mcp-server/src/

# 2. Just run local-tunnel - it handles everything:
local-tunnel
# - Rebuilds if source changed
# - Copies to ~/.claude/mcp-server-dist/
# - Restarts MCP server
# - Starts ngrok

# 3. On remote, update the notification script:
scp bin/claude-slack-notify remote:~/.claude/bin/

# 4. Re-run /slack-notify in Claude on remote to get new button format
```

### Testing Button Clicks

```bash
# Watch logs in real-time:
tail -f ~/.claude/mcp-server.log ~/.claude/logs/focus-debug.log

# Check MCP server is running:
curl http://localhost:8463/health

# Check ngrok is tunneling:
cat ~/.claude/.ngrok.log | grep '"url"'
```

### Debugging Checklist

If buttons aren't working:

1. **Is MCP server running?**
   ```bash
   curl http://localhost:8463/health
   ```

2. **Is it running NEW code?**
   ```bash
   # Check timestamps
   ls -la ~/.claude/mcp-server-dist/dist/routes/slack.js
   ls -la ./mcp-server/dist/routes/slack.js
   ```

3. **Is ngrok URL correct in Slack app?**
   ```bash
   cat ~/.claude/.ngrok.log | grep '"url"'
   ```
   Then verify this matches the Request URL in Slack app settings.

4. **Is the remote script updated?**
   ```bash
   ssh remote 'grep -c "BUTTON_VALUE_PREFIX" ~/.claude/bin/claude-slack-notify'
   # Should return 4 (not 0)
   ```

5. **Check logs after clicking**:
   ```bash
   tail ~/.claude/mcp-server.log
   tail ~/.claude/logs/focus-debug.log
   ```

## File Reference

| File | Purpose |
|------|---------|
| `bin/claude-slack-notify` | Main CLI - register, notify, link commands |
| `bin/local-tunnel` | Starts ngrok + MCP server for button support |
| `bin/focus-helper` | Handles `claude-focus://` URLs, switches terminals |
| `bin/mcp-server` | Launcher script for MCP server |
| `mcp-server/src/routes/slack.ts` | Handles Slack button click webhooks |
| `mcp-server/src/lib/focus-executor.ts` | Executes focus-helper with URLs |
| `mcp-server/src/lib/session-store.ts` | Reads session files from ~/.claude/instances/ |
| `~/.claude/instances/*.json` | Session registration (on machine running Claude) |
| `~/.claude/links/*.json` | Link info for SSH sessions (on local Mac only) |
