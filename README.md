# Claude Slack Notify

Slack notifications for Claude Code with clickable buttons to focus terminals and send commands.

Designed for orchestrating multiple AI agents: get notified when attention is needed, click to jump to the right terminal, and send commands without context switching.

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click switches to the exact terminal tab
- **Time-based notifications**: Only notifies for tasks taking >30 seconds
- **Cross-platform**: macOS, Windows, Linux, and remote SSH

## Requirements

| Requirement | Purpose |
|-------------|---------|
| Bash (macOS/Linux) or PowerShell (Windows) | Core shell |
| curl | Sending notifications |
| Claude Code CLI | Integration |
| jq (optional) | Richer notification context |
| tmux (optional) | Action buttons (1/2/Continue/Push) |

### Platform Support

| Platform | Focus | Actions | Notes |
|----------|-------|---------|-------|
| macOS (iTerm2, Terminal.app) | Yes | Yes (with tmux) | Full support |
| Windows (Terminal, ConEmu) | Yes | Yes (WSL + tmux) | Requires registry |
| Linux (GNOME, Konsole, VS Code) | Yes | Yes (with tmux) | X11/Wayland required |
| Docker/Containers | No | No | Notifications only |
| Remote SSH | Yes | Yes (with tmux) | SSH key auth required |

## Terminal Types

<details>
<summary>macOS</summary>

| Terminal | tmux | Type |
|----------|------|------|
| iTerm2 | No | `iterm2` |
| iTerm2 | Yes | `iterm-tmux` |
| Terminal.app | No | `terminal` |
| Terminal.app | Yes | `terminal-tmux` |

</details>

<details>
<summary>Windows</summary>

| Terminal | tmux | Type |
|----------|------|------|
| Windows Terminal | No | `windows-terminal` |
| Windows Terminal | Yes (WSL) | `wt-tmux` |
| ConEmu / Cmder | No | `conemu` |
| Git Bash / MSYS2 | No | `mintty` |
| WSL | No | `wsl` |
| WSL | Yes | `wsl-tmux` |

</details>

<details>
<summary>Linux</summary>

| Terminal | tmux | Type |
|----------|------|------|
| GNOME Terminal | No | `gnome-terminal` |
| Konsole | No | `konsole` |
| VS Code | No | `vscode` |
| Any | Yes | `linux-tmux` |

</details>

<details>
<summary>Remote SSH / JupyterLab</summary>

| Configuration | Type | Focus | Input |
|--------------|------|-------|-------|
| Linked SSH + tmux | `ssh-linked` | Local terminal | SSH to remote |
| Direct SSH + tmux | `ssh-tmux` | None | SSH to remote |
| JupyterLab + tmux | `jupyter-tmux` | Chrome tab | SSH to remote |

</details>

## Installation

### macOS / Linux

```bash
./install.sh              # Install
./install.sh --uninstall  # Uninstall
./install.sh --link       # Development (symlinks)
```

### Windows

```powershell
.\install.ps1             # Install (run as Administrator)
.\install.ps1 -Uninstall  # Uninstall
```

Works from Git Bash, MSYS2, Cygwin, or WSL. Uses Windows Registry for `claude-focus://` URLs.

### Docker

```dockerfile
RUN git clone https://github.com/yourusername/claude-slack-notify.git /tmp/csn && \
    /tmp/csn/install.sh && rm -rf /tmp/csn
```

Focus buttons do not work in containers (no desktop), but notifications are sent.

### macOS Permissions

On first Focus button click, grant automation permission when prompted. If denied, enable in **System Settings > Privacy & Security > Automation**:
- ClaudeFocus.app > iTerm (or Terminal)
- ClaudeFocus.app > System Events
- ClaudeFocus.app > Google Chrome (for JupyterLab)

**Troubleshooting**: Check `~/.claude/logs/focus-debug.log` or reinstall with `./install.sh`.

## Setup

1. **Create Slack webhook**: [api.slack.com/apps](https://api.slack.com/apps) > Create New App > Incoming Webhooks > Add to Workspace

2. **Save webhook URL**:
   ```bash
   echo 'https://hooks.slack.com/services/...' > ~/.claude/slack-webhook-url
   ```

3. **Register session**: In Claude, run `/slack-notify` or `/slack-notify MyProject`

## Remote SSH Sessions

Configure Focus buttons to switch to your local terminal while sending input to a remote Claude session.

### Quick Start

```bash
claude-slack-notify link --host user@server  # Creates link, SSHs, starts tmux
claude                                        # Start Claude
/slack-notify                                 # Register in Slack
```

The `--host` flag accepts SSH config aliases, user@hostname, or user@ip. Extra SSH options like `-p 2222` are passed through.

### How It Works

```
LOCAL (macOS)                    REMOTE (Linux)
┌─────────────────┐              ┌─────────────────┐
│ iTerm2 Tab      │──── SSH ────▶│ tmux pane       │
│ (Focus here)    │              │ (Input here)    │
└─────────────────┘              └─────────────────┘
```

### Requirements

- **Local**: macOS with iTerm2 or Terminal.app
- **Remote**: tmux (for action buttons)
- **SSH**: Key-based authentication

### Managing Links

```bash
claude-slack-notify links        # List active links
claude-slack-notify links clean  # Remove links >24 hours old
```

## JupyterLab Support

Link a JupyterLab terminal in Chrome to focus the tab and send input via SSH.

### Setup

1. Open JupyterLab in Chrome (make it the active tab)
2. From your Mac terminal:
   ```bash
   claude-slack-notify link --jupyter --host user@jupyter-server
   ```
3. In JupyterLab terminal:
   ```bash
   source ~/.claude/jupyter-env && tmux new -s claude
   claude
   /slack-notify
   ```

Requires Chrome, tmux on remote, and SSH key authentication.

## Architecture

```
Claude hooks ──▶ claude-slack-notify ──▶ Slack webhook
                                               │
                                               ▼
                               User clicks Focus button
                                               │
                                               ▼
                  URL handler (ClaudeFocus.app / Registry) ──▶ focus-helper ──▶ Terminal
```

<details>
<summary>URL Scheme Reference</summary>

The `claude-focus://` scheme encodes terminal type and target:

**macOS**: `iterm2`, `iterm-tmux`, `terminal`, `terminal-tmux`
**Windows**: `windows-terminal`, `wt-tmux`, `conemu`, `mintty`, `wsl`, `wsl-tmux`
**Remote**: `ssh-linked`, `ssh-tmux`

Example: `claude-focus://iterm-tmux/<tty>/<session:window.pane>`

</details>

## Configuration

### Slack Buttons

Configure in `~/.claude/button-config` (format: `LABEL|ACTION` per line):
```
1|1
2|2
Continue|continue
Push|push
```

Reconfigure with `./install.sh --configure`. Focus button is always included.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_NOTIFY_MIN_SECONDS` | 30 | Minimum task duration before notifying |
| `SLACK_WEBHOOK_URL` | - | Alternative to ~/.claude/slack-webhook-url |
| `CLAUDE_SSH_PORT` | 22 | SSH port for remote sessions |

### Claude Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-start", "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10 }] }]
  }
}
```

Install `jq` for richer notification context.

## Commands

```bash
claude-slack-notify register [name]     # Register instance
claude-slack-notify list                # List instances
claude-slack-notify start               # Start timing
claude-slack-notify check               # Notify if >30s elapsed
claude-slack-notify "message" [status]  # Custom notification

# SSH linking
claude-slack-notify link --host user@server
claude-slack-notify link --jupyter --host user@server
claude-slack-notify links [clean]       # List or clean links
```

**Status colors**: `started` (green), `waiting` (orange), `error` (red), default (blue)

## Files

| Path | Purpose |
|------|---------|
| `~/.claude/bin/claude-slack-notify` | Main script |
| `~/.claude/bin/slack-notify-{start,check}` | Hook wrappers |
| `~/.claude/bin/focus-helper` | Terminal switcher (macOS: AppleScript, Windows: PowerShell) |
| `~/.claude/commands/slack-notify.md` | Claude command |
| `~/.claude/slack-webhook-url` | Webhook URL |
| `~/.claude/button-config` | Button configuration |
| `~/.claude/instances/` | Registered instances |
| `~/.claude/links/` | SSH link data |
| `~/.claude/logs/focus-debug.log` | Debug log |

**macOS**: `~/Applications/ClaudeFocus.app` (URL handler)
**Windows**: Registry `HKCU\Software\Classes\claude-focus`

## Debugging

```bash
tail -f ~/.claude/logs/focus-debug.log
```

## License

MIT
