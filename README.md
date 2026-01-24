<p align="center">
  <img src="public/banner.jpg" alt="Claude Slack Notify" width="100%">
</p>

# Claude Slack Notify

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/playerzer0x/claude-slack-notify/releases)

Slack notifications for Claude Code with clickable buttons to focus terminals and send commands.

**Get notified when Claude needs input. Break free from your terminal.** 

This adds Slack notifications so you can step away while Claude works - get pinged when it needs input, click to jump back, or respond directly from Slack (even on mobile).

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click switches to the exact terminal tab
- **Mobile support**: Respond to Claude from your phone via Slack buttons
- **Time-based notifications**: Only notifies for tasks taking >30 seconds
- **Cross-platform**: macOS, Windows, Linux, and remote SSH

## Quick Start

```bash
git clone https://github.com/playerzer0x/claude-slack-notify.git
cd claude-slack-notify
./install.sh
```

The installer guides you through creating a Slack app, configuring webhooks, and setting up button actions.

Then start the tunnel (in a separate terminal or background):

```bash
local-tunnel              # Foreground (see status)
local-tunnel --background # Background (for convenience)
```

And in Claude Code:

```
/slack-notify
```

> **Note**: The tunnel runs indefinitely by default, persisting through sleep/wake cycles for overnight tasks. To enable auto-shutdown, set `CLAUDE_TUNNEL_IDLE_TIMEOUT=3600` (seconds).

## Installation

### Prerequisites

- **[bun](https://bun.sh)** - Required to build the CLI binary
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

- **Tailscale** (recommended) - For stable tunnel URLs
  - macOS: `brew install tailscale`
  - Linux: `curl -fsSL https://tailscale.com/install.sh | sh`

### macOS

```bash
# Clone and install
git clone https://github.com/playerzer0x/claude-slack-notify.git
cd claude-slack-notify
./install.sh

# Verify CLI installed
claude-notify --version  # Should show 1.1.0

# Start tunnel
local-tunnel
```

### Linux (Remote Server)

```bash
# Install bun first
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Clone and install
git clone https://github.com/playerzer0x/claude-slack-notify.git
cd claude-slack-notify
./install.sh

# Verify CLI installed
claude-notify --version  # Should show 1.1.0

# Start tunnel (if running Claude directly on Linux)
remote-tunnel
```

### Manual CLI Build

If the installer didn't build the CLI (bun not found), build it manually:

```bash
cd cli
bun install
bun run build

# Binary created at ../bin/claude-notify
# Copy to PATH
cp ../bin/claude-notify ~/.claude/bin/
```

### Verify Installation

```bash
# Check CLI version
claude-notify --version

# Check system status
claude-notify status

# List registered sessions
ls ~/.claude/instances/
```

## Tailscale Funnel Setup (Recommended)

Tailscale Funnel provides stable URLs without third-party services. **It's free** - included in the Personal plan (up to 3 users, 100 devices).

### Installation

**macOS:**
```bash
brew install tailscale
```

**Linux:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### First-Time Setup

1. **Connect Tailscale:** `tailscale up`
2. **Run the tunnel:** `local-tunnel` (or `remote-tunnel` on Linux)
   - Funnel is auto-enabled if needed
   - If prompted for API key, go to https://login.tailscale.com/admin/settings/keys
   - Generate key, paste when prompted
   - Key is saved to `~/.claude/.env`

### Verify

```bash
tailscale funnel status
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

Focus your local terminal while sending input to a remote Claude session.

### Setup

**On your Mac** (full install):
```bash
./install.sh
```

**On the remote server** (notifications only - no tunnel needed):
```bash
git clone https://github.com/playerzer0x/claude-slack-notify.git
cd claude-slack-notify
./install.sh
```

The remote install skips tunnel setup since the tunnel runs on your local Mac.

### Usage

```bash
# On your Mac:
claude-slack-notify remote myserver           # Connect to remote, start tmux session
claude                                        # Start Claude on remote
/slack-notify                                 # Register in Slack
```

**Requirements**: macOS locally, tmux on remote, SSH key authentication.

### JupyterLab

```bash
# In JupyterLab terminal:
claude-slack-notify jupyter    # First run prompts for URL, starts tmux
claude
/slack-notify
```

## Configuration

### Thread Replies

Reply to notifications directly from Slack (even on mobile). Supports text and images.

**Setup:**

1. **Invite the bot** to your notification channel:
   ```
   /invite @YourBotName
   ```

2. **Add bot scopes** in your Slack app (OAuth & Permissions):
   - `chat:write` - Send messages
   - `files:read` - Download images from replies

3. **Enable Events API** (Event Subscriptions):
   - Enable Events → Set Request URL: `<tunnel-url>/slack/events`
   - Subscribe to bot event: `message.channels`
   - Save changes

The Request URLs auto-update when you start the tunnel.

**Image replies:** When you reply to a notification with an image, it's downloaded to `~/.claude/slack-downloads/` and Claude receives the file path.

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

### Claude Code

| Command | Platform | Description |
|---------|----------|-------------|
| `/slack-notify` | Any | Register session (tunnel must be running) |
| `/slack-notify local` | macOS | Start tunnel + register |
| `/slack-notify remote` | Linux | Start tunnel + register |
| `/slack-notify clean` | Any | Kill stale claude-* tmux sessions (>1 day) |
| `/slack-notify stop` | Any | Unregister + stop tunnel |

### CLI Commands

The CLI binary (`claude-slack-notify` or `claude-notify`) provides these commands:

```bash
claude-slack-notify register [--name <name>]     # Register current session
claude-slack-notify notify [options]             # Send a Slack notification
claude-slack-notify launch [--name <name>]       # Start Claude in a tmux session
claude-slack-notify remote [hostname]            # Connect to remote server with linking
claude-slack-notify status                       # Show system status
claude-slack-notify clean [--sessions] [--links] # Clean up stale sessions
```

### Installation & Tunnel Commands

```bash
# Installation
./install.sh              # Install (builds CLI if bun available)
./install.sh --uninstall  # Uninstall completely
./install.sh --configure  # Reconfigure buttons
./install.sh --link       # Install with symlinks (development)
./install.sh --update     # Quick update (non-interactive)

# Tunnel (macOS)
local-tunnel              # Start tunnel (foreground)
local-tunnel --background # Start tunnel (background)
local-tunnel --stop       # Stop tunnel
local-tunnel --status     # Check tunnel status

# Tunnel (Linux)
remote-tunnel              # Start tunnel (foreground)
remote-tunnel --background # Start tunnel (background)
remote-tunnel --stop       # Stop tunnel
remote-tunnel --status     # Check tunnel status
```

## Debugging

```bash
tail -f ~/.claude/mcp-server.log  # MCP server logs
```

## macOS Permissions

On first Focus button click, grant automation permission when prompted. If denied, enable in **System Settings > Privacy & Security > Automation** for ClaudeFocus.app.

## Troubleshooting

**Check tunnel status:**
```bash
local-tunnel --status   # macOS
remote-tunnel --status  # Linux
```

**Common issues:**

1. **"Funnel not enabled"** - Run tunnel interactively first time, it will prompt for API key
2. **"MCP server failed"** - Check `~/.claude/mcp-server.log` for errors
3. **Buttons not working** - Verify tunnel URL matches Slack Request URL in app settings
4. **Focus not switching** - On macOS, check Automation permissions for ClaudeFocus.app

**View logs:**
```bash
tail -f ~/.claude/mcp-server.log        # MCP server
tail -f ~/.claude/tunnel.log            # Tunnel (macOS)
tail -f ~/.claude/remote-tunnel.log     # Tunnel (Linux)
```

## License

MIT
