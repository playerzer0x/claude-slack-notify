# Claude Slack Notify

Slack notifications for Claude Code with clickable "Focus Terminal" buttons that switch to the correct terminal tab.

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click in Slack switches to the exact terminal tab
- **Auto-detection**: Works with macOS, Windows, and Linux terminals
- **Time-based notifications**: Only notifies for tasks taking >30 seconds
- **Remote SSH support**: Focus local terminal and send input to remote Linux via SSH

## Supported Configurations

### macOS

| Terminal | tmux | Type |
|----------|------|------|
| iTerm2 | No | `iterm2` |
| iTerm2 | Yes | `iterm-tmux` |
| Terminal.app | No | `terminal` |
| Terminal.app | Yes | `terminal-tmux` |

### Windows

| Terminal | tmux | Type |
|----------|------|------|
| Windows Terminal | No | `windows-terminal` |
| Windows Terminal | Yes (WSL) | `wt-tmux` |
| ConEmu / Cmder | No | `conemu` |
| Git Bash / MSYS2 | No | `mintty` |
| WSL | No | `wsl` |
| WSL | Yes | `wsl-tmux` |

### Linux

| Terminal | tmux | Type |
|----------|------|------|
| GNOME Terminal | No | `gnome-terminal` |
| Konsole | No | `konsole` |
| VS Code | No | `vscode` |
| Any | Yes | `linux-tmux` |

### Remote via SSH

| Configuration | Type | Focus | Input |
|--------------|------|-------|-------|
| Linked SSH + tmux | `ssh-linked` | Local terminal | SSH → remote tmux |
| Direct SSH + tmux | `ssh-tmux` | None | SSH → remote tmux |
| Direct SSH | `ssh` | None | None |

## Installation

### macOS / Linux

```bash
./install.sh
```

To uninstall:
```bash
./install.sh --uninstall
```

For development (symlinks to repo):
```bash
./install.sh --link
```

### Windows

Run in PowerShell (as Administrator if needed for registry):

```powershell
.\install.ps1
```

To uninstall:
```powershell
.\install.ps1 -Uninstall
```

**Note**: On Windows, the script works from Git Bash, MSYS2, Cygwin, or WSL. The Focus Terminal button uses the Windows Registry to handle `claude-focus://` URLs.

### Docker / Containers

The install script copies files (instead of symlinking) for portability. To install in a Docker container:

```dockerfile
# In your Dockerfile
RUN git clone https://github.com/yourusername/claude-slack-notify.git /tmp/claude-slack-notify && \
    /tmp/claude-slack-notify/install.sh && \
    rm -rf /tmp/claude-slack-notify
```

Or install directly from the scripts:

```bash
# Copy the bin scripts to ~/.claude/bin/
mkdir -p ~/.claude/bin
curl -o ~/.claude/bin/claude-slack-notify https://raw.githubusercontent.com/.../bin/claude-slack-notify
curl -o ~/.claude/bin/slack-notify-start https://raw.githubusercontent.com/.../bin/slack-notify-start
curl -o ~/.claude/bin/slack-notify-check https://raw.githubusercontent.com/.../bin/slack-notify-check
chmod +x ~/.claude/bin/*
```

**Note**: In containers, the Focus Terminal button won't work (no desktop environment), but Slack notifications will still be sent.

## Setup

1. **Get a Slack webhook URL**:
   - Go to https://api.slack.com/apps
   - Create New App → From scratch → Name it "Claude Notifier"
   - Enable Incoming Webhooks
   - Add New Webhook to Workspace
   - Choose a channel and copy the URL

2. **Save the webhook URL**:

   macOS/Linux/WSL:
   ```bash
   echo 'https://hooks.slack.com/services/...' > ~/.claude/slack-webhook-url
   ```

   Windows (PowerShell):
   ```powershell
   "https://hooks.slack.com/services/..." | Out-File -FilePath "$env:USERPROFILE\.claude\slack-webhook-url" -Encoding ASCII
   ```

3. **Register a Claude session**:
   In Claude, run `/slack-notify` or `/slack-notify MyProject`

## Remote SSH Sessions

When running Claude on a remote Linux server via SSH, you can configure the Focus button to:
1. Switch to your **local** terminal (the one you SSH'd from)
2. Send input to the **remote** Claude session via SSH

### Setup

**One-liner with --host (recommended)**

```bash
# Using SSH config alias
claude-slack-notify link --host myserver

# Using user@hostname
claude-slack-notify link --host user@myserver

# Using user@ip
claude-slack-notify link --host ubuntu@192.168.1.100

# With extra SSH options (passed through)
claude-slack-notify link --host deploy@prod-server -p 2222
```

This creates a link, SSHs, and **automatically starts a tmux session** named "claude".

**After connecting:**
1. Run `claude` to start Claude
2. In Claude, run `/slack-notify` to register

**Important: tmux is required on the remote** for the input buttons (1/2/Continue/Push) to work. The `--host` option automatically starts tmux for you. Without tmux, only the Focus button works (switches to local terminal).

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ LOCAL MACHINE (macOS)                                           │
│ ┌─────────────────┐                                             │
│ │ iTerm2 Tab      │ ◀── Focus button switches here              │
│ │ (SSH session)   │                                             │
│ └────────┬────────┘                                             │
│          │ SSH                                                  │
└──────────┼──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│ REMOTE LINUX                                                    │
│ ┌─────────────────┐                                             │
│ │ tmux pane       │ ◀── Input sent here via SSH                 │
│ │ (Claude running)│                                             │
│ └─────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

When you click the Focus button in Slack:
1. The focus-helper reads the link file to find your local terminal
2. Switches to that iTerm2/Terminal.app tab
3. Switches the remote tmux to the correct window/pane (via SSH)
4. Sends input to the tmux pane (if action button clicked)

### Managing Links

```bash
# List active links
claude-slack-notify links

# Clean up links older than 24 hours
claude-slack-notify links clean
```

### Requirements

- **Local**: macOS with iTerm2 or Terminal.app
- **Remote**: tmux installed on the Linux server (required for input buttons)
- **SSH**: Key-based authentication (for sending input without password prompts)

**Note**: The `--host` option automatically starts a tmux session. If you connect manually, make sure to run Claude inside tmux:
```bash
tmux new -s claude  # Then run claude inside tmux
```

Without tmux, the Focus button will still switch to your local terminal, but the input buttons (1/2/Continue/Push) won't work.

### Configuration

Set a custom SSH port (default: 22):
```bash
export CLAUDE_SSH_PORT=2222
```

## How It Works

### Architecture (macOS)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude hooks   │────▶│ claude-slack-   │────▶│     Slack       │
│  (start/check)  │     │    notify       │     │   webhook       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  focus-helper   │◀────│  LaunchAgent    │◀────│ ClaudeFocus.app │
│  (AppleScript)  │     │  (file watcher) │     │ (URL handler)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │
        ▼
┌─────────────────┐
│  Terminal tab   │
│  switches       │
└─────────────────┘
```

### Architecture (Windows)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude hooks   │────▶│ claude-slack-   │────▶│     Slack       │
│  (start/check)  │     │    notify       │     │   webhook       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────────┐     ┌─────────────────────────────────────┐
│ focus-helper-       │◀────│ Windows Registry URL Handler        │
│ windows.ps1         │     │ (claude-focus-handler.cmd)          │
│ (Win32 API)         │     └─────────────────────────────────────┘
└─────────────────────┘
        │
        ▼
┌─────────────────┐
│  Terminal window│
│  switches       │
└─────────────────┘
```

### URL Scheme

The `claude-focus://` URL scheme encodes the terminal type and target:

**macOS:**
- `claude-focus://iterm2/<session-uuid>` - Pure iTerm2
- `claude-focus://iterm-tmux/<tty>/<session:window.pane>` - iTerm2 + tmux
- `claude-focus://terminal/<tty>` - Pure Terminal.app
- `claude-focus://terminal-tmux/<tty>/<session:window.pane>` - Terminal.app + tmux

**Windows:**
- `claude-focus://windows-terminal/<wt-session>` - Windows Terminal
- `claude-focus://wt-tmux/<wt-session>/<session:window.pane>` - Windows Terminal + tmux
- `claude-focus://conemu/<pid>` - ConEmu/Cmder
- `claude-focus://mintty/<pid>` - Git Bash/MSYS2/Cygwin
- `claude-focus://wsl/<distro-id>` - WSL
- `claude-focus://wsl-tmux/<distro-id>/<session:window.pane>` - WSL + tmux

**Remote SSH:**
- `claude-focus://ssh-linked/<link_id>/<host>/<user>/<port>/<tmux_target>` - Linked SSH + tmux
- `claude-focus://ssh-tmux/<host>/<user>/<port>/<tmux_target>` - Direct SSH + tmux

## Configuration

### Environment Variables

- `CLAUDE_NOTIFY_MIN_SECONDS`: Minimum task duration before notifying (default: 30)
- `SLACK_WEBHOOK_URL`: Alternative to ~/.claude/slack-webhook-url file

### Claude Hooks

Add to `~/.claude/settings.json` for automatic notifications:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/bin/slack-notify-start",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/bin/slack-notify-check",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The `slack-notify-start` and `slack-notify-check` wrapper scripts automatically extract the `session_id` from the JSON that Claude Code passes to hooks. This ensures consistent instance identification across hook invocations.

**Note:** For richer context extraction from transcripts, install `jq`. The scripts work without it but provide better notification messages with it installed.

## Commands

### claude-slack-notify

```bash
# Register a new instance
claude-slack-notify register [name]

# List all registered instances
claude-slack-notify list

# Start timing a task
claude-slack-notify start

# Check elapsed time and notify if >30s
claude-slack-notify check

# Send a custom notification
claude-slack-notify "message" [status]

# Create a link for SSH sessions (run on LOCAL machine)
claude-slack-notify link

# Create link and SSH in one command
claude-slack-notify link --host <hostname>
claude-slack-notify link --host user@hostname
claude-slack-notify link --host user@192.168.1.100

# List active links
claude-slack-notify links

# Clean up old links (>24 hours)
claude-slack-notify links clean
```

### Status Colors

- `started` - Green
- `waiting` - Orange
- `error` - Red
- (default) - Blue

## Files

### Common (all platforms)
- `~/.claude/bin/claude-slack-notify` - Main notification script
- `~/.claude/bin/slack-notify-start` - Hook wrapper for UserPromptSubmit
- `~/.claude/bin/slack-notify-check` - Hook wrapper for Stop
- `~/.claude/bin/get-session-id` - Helper to get current session ID
- `~/.claude/commands/slack-notify.md` - Claude command definition
- `~/.claude/slack-webhook-url` - Slack webhook URL
- `~/.claude/instances/` - Registered instance data (keyed by session ID)
- `~/.claude/links/` - SSH link data (for remote sessions)
- `~/.claude/logs/focus-debug.log` - Focus helper debug log

### macOS only
- `~/.claude/bin/focus-helper` - Terminal tab switching helper (AppleScript)
- `~/Applications/ClaudeFocus.app` - URL scheme handler
- `~/Library/LaunchAgents/com.claude.focus-watcher.plist` - File watcher service

### Windows only
- `%USERPROFILE%\.claude\bin\focus-helper-windows.ps1` - Terminal switching helper (PowerShell)
- `%USERPROFILE%\.claude\bin\claude-focus-handler.cmd` - URL scheme handler
- Registry: `HKCU\Software\Classes\claude-focus` - URL scheme registration

## Debugging

Check the focus helper log:

macOS/Linux:
```bash
tail -f ~/.claude/logs/focus-debug.log
```

Windows (PowerShell):
```powershell
Get-Content "$env:USERPROFILE\.claude\logs\focus-debug.log" -Wait -Tail 20
```

## License

MIT
