# Claude Slack Notify

Slack notifications for Claude Code with clickable buttons to focus terminals and send commands.

Designed for orchestrating multiple AI agents: get notified when attention is needed, click to jump to the right terminal, and send commands without context switching.

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click switches to the exact terminal tab
- **Time-based notifications**: Only notifies for tasks taking >30 seconds
- **Cross-platform**: macOS, Windows, Linux, and remote SSH

## Requirements

- **Shell**: Bash (macOS/Linux) or PowerShell (Windows)
- **curl**: For sending notifications
- **Claude Code CLI**: Required for integration
- **jq** (recommended): Enables richer notifications and auto-configures hooks
- **tmux** (optional): Required for action buttons (1/2/Continue/Push)

### Platform Support

| Platform | Focus | Actions | Notes |
|----------|-------|---------|-------|
| macOS | Yes | Yes (with tmux) | iTerm2 or Terminal.app |
| Windows | Yes | Yes (WSL + tmux) | Requires registry setup |
| Linux | Yes | Yes (with tmux) | X11/Wayland required |
| Docker | No | No | Notifications only |
| Remote SSH | Yes | Yes (with tmux) | SSH key auth required |

## Installation

### macOS / Linux

```bash
./install.sh              # Install
./install.sh --uninstall  # Uninstall
```

### Windows

```powershell
.\install.ps1             # Install (run as Administrator)
.\install.ps1 -Uninstall  # Uninstall
```

### Docker

```dockerfile
RUN git clone https://github.com/yourusername/claude-slack-notify.git /tmp/csn && \
    /tmp/csn/install.sh && rm -rf /tmp/csn
```

Focus buttons do not work in containers, but notifications are sent.

### macOS Permissions

On first Focus button click, grant automation permission when prompted. If denied, enable in **System Settings > Privacy & Security > Automation** for ClaudeFocus.app.

## Setup

### Quick Setup (with jq)

If you have `jq` installed, the installer handles most setup automatically:

1. **Create Slack app** (choose one method):

   **Option A - Use manifest (fastest)**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps) > Create New App > From an app manifest
   - Select your workspace, paste contents of `slack-app-manifest.json`, create
   - Go to Incoming Webhooks > Add New Webhook to Workspace > Select channel

   **Option B - Manual**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps) > Create New App > From scratch
   - Enable Incoming Webhooks > Add New Webhook to Workspace

2. **Run installer**: `./install.sh`
   - Prompts for webhook URL (paste when asked)
   - Auto-configures hooks in `~/.claude/settings.json`

3. **Register session**: In Claude, run `/slack-notify` or `/slack-notify MyProject`

### Manual Setup (without jq)

If `jq` is not available, add hooks manually to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-start", "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10 }] }],
    "Notification": [
      { "matcher": "idle_prompt", "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10 }] },
      { "matcher": "elicitation_dialog", "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10 }] },
      { "matcher": "permission_prompt", "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10 }] }
    ]
  }
}
```

**Note**: Notification hooks fire when Claude waits for input (plan approval, questions, permissions).

## Remote SSH Sessions

Focus your local terminal while sending input to a remote Claude session.

```bash
claude-slack-notify link --host user@server  # Creates link, SSHs, starts tmux
claude                                        # Start Claude on remote
/slack-notify                                 # Register in Slack
```

**Requirements**: macOS locally, tmux on remote, SSH key authentication.

### JupyterLab

```bash
# From Mac terminal (with JupyterLab open in Chrome):
claude-slack-notify link --jupyter --host user@jupyter-server

# In JupyterLab terminal:
source ~/.claude/jupyter-env && tmux new -s claude
claude
/slack-notify
```

## MCP Server (Mobile Support)

The MCP server enables Slack button actions from mobile devices. Without it, Focus and action buttons only work on desktop.

### Setup

1. **Start the MCP server**:
   ```bash
   ~/.claude/bin/mcp-server
   ```

2. **Expose with ngrok** (or similar):
   ```bash
   ngrok http 8463
   ```

3. **Configure Slack Interactivity**:
   - Go to your Slack app settings ([api.slack.com/apps](https://api.slack.com/apps))
   - Navigate to **Interactivity & Shortcuts**
   - Enable Interactivity
   - Set Request URL to: `https://your-ngrok-url.ngrok.io/slack/actions`
   - Save Changes

4. **Add signing secret** (for security):
   ```bash
   # Get signing secret from Slack app > Basic Information > Signing Secret
   echo 'your_signing_secret' > ~/.claude/slack-signing-secret
   ```

### How It Works

- When you click a button in Slack, the request goes to your ngrok URL
- The MCP server verifies the Slack signature and executes the action locally
- Focus switches to the correct terminal, or input is sent to tmux

### Persistent Setup

For always-on mobile support, run the MCP server and ngrok as background services:

```bash
# Using launchd (macOS) or systemd (Linux)
# See examples in mcp-server/examples/ (if available)

# Or simply:
nohup ~/.claude/bin/mcp-server > ~/.claude/logs/mcp-server.log 2>&1 &
```

## Configuration

### Slack Buttons

Configure in `~/.claude/button-config` (format: `LABEL|ACTION` per line):
```
1|1
2|2
Continue|continue
Push|push
```

Reconfigure with `./install.sh --configure`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_NOTIFY_MIN_SECONDS` | 30 | Minimum task duration before notifying |
| `SLACK_WEBHOOK_URL` | - | Alternative to ~/.claude/slack-webhook-url |
| `CLAUDE_SSH_PORT` | 22 | SSH port for remote sessions |

## Debugging

```bash
tail -f ~/.claude/logs/focus-debug.log
```

## License

MIT
