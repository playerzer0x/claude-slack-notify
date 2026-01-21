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
