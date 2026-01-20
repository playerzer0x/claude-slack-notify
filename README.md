# Claude Slack Notify

Slack notifications for Claude Code with clickable buttons to focus terminals and send commands.

**Keep working with Claude in your preferred terminal.** This adds Slack notifications so you can step away while Claude works - get pinged when it needs input, click to jump back, or respond directly from Slack (even on mobile).

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click switches to the exact terminal tab
- **Mobile support**: Respond to Claude from your phone via Slack buttons
- **Time-based notifications**: Only notifies for tasks taking >30 seconds
- **Cross-platform**: macOS, Windows, Linux, and remote SSH

## Quick Start

### 1. Create Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → **From an app manifest**

Paste the contents of `slack-app-manifest.json`, then:
- Go to **Incoming Webhooks** → Add New Webhook to Workspace → Select channel
- Copy the webhook URL

### 2. Install

```bash
./install.sh
```

The installer will:
- Install `jq` if needed (for auto-configuration)
- Build and install the MCP server
- Configure hooks in `~/.claude/settings.json`
- Prompt for your Slack webhook URL

### 3. Enable Slack Buttons (Optional)

To respond to Claude from Slack (including mobile):

```bash
slack-tunnel
```

This starts an ngrok tunnel and guides you through configuring Slack Interactivity.

### 4. Start Using

In Claude Code, run:

```
/slack-notify
```

Or with a custom name:

```
/slack-notify MyProject
```

## Platform Support

| Platform | Focus | Actions | Notes |
|----------|-------|---------|-------|
| macOS | Yes | Yes (with tmux) | iTerm2 or Terminal.app |
| Windows | Yes | Yes (WSL + tmux) | Requires registry setup |
| Linux | Yes | Yes (with tmux) | X11/Wayland required |
| Docker | No | No | Notifications only |
| Remote SSH | Yes | Yes (with tmux) | SSH key auth required |

## Remote SSH Sessions

Focus your local terminal while sending input to a remote Claude session:

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

## Configuration

### Slack Buttons

Configure action buttons in `~/.claude/button-config`:

```
1|1
2|2
Continue|continue
Push|push
```

Format: `LABEL|ACTION` per line. Reconfigure with `./install.sh --configure`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_NOTIFY_MIN_SECONDS` | 30 | Minimum task duration before notifying |
| `SLACK_WEBHOOK_URL` | - | Alternative to ~/.claude/slack-webhook-url |
| `CLAUDE_SSH_PORT` | 22 | SSH port for remote sessions |

## Commands

```bash
./install.sh              # Install
./install.sh --uninstall  # Uninstall completely
./install.sh --configure  # Reconfigure buttons
./install.sh --link       # Install with symlinks (development)
slack-tunnel              # Start ngrok tunnel for mobile support
```

## Debugging

```bash
tail -f ~/.claude/mcp-server.log  # MCP server logs
```

## macOS Permissions

On first Focus button click, grant automation permission when prompted. If denied, enable in **System Settings > Privacy & Security > Automation** for ClaudeFocus.app.

## License

MIT
