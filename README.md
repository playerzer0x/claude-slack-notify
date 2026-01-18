# Claude Slack Notify

Slack notifications for Claude Code with clickable "Focus Terminal" buttons that switch to the correct terminal tab.

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click in Slack switches to the exact terminal tab
- **Auto-detection**: Works with macOS, Windows, and Linux terminals
- **Time-based notifications**: Only notifies for tasks taking >30 seconds

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

## Installation

### macOS

```bash
./install.sh
```

To uninstall:
```bash
./install.sh --uninstall
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

## Configuration

### Environment Variables

- `CLAUDE_NOTIFY_MIN_SECONDS`: Minimum task duration before notifying (default: 30)
- `SLACK_WEBHOOK_URL`: Alternative to ~/.claude/slack-webhook-url file

### Claude Hooks

Add to `~/.claude/settings.json` for automatic notifications:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify start"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify check"
          }
        ]
      }
    ]
  }
}
```

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
```

### Status Colors

- `started` - Green
- `waiting` - Orange
- `error` - Red
- (default) - Blue

## Files

### Common (all platforms)
- `~/.claude/bin/claude-slack-notify` - Main notification script
- `~/.claude/commands/slack-notify.md` - Claude command definition
- `~/.claude/slack-webhook-url` - Slack webhook URL
- `~/.claude/instances/` - Registered instance data
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
