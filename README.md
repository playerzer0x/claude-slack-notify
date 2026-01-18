# Claude Slack Notify

Slack notifications for Claude Code with clickable "Focus Terminal" buttons that switch to the correct terminal tab.

## Features

- **Multi-instance support**: Run multiple Claude sessions with unique names
- **Clickable focus buttons**: One click in Slack switches to the exact terminal tab
- **Auto-detection**: Works with iTerm2, Terminal.app, tmux, and combinations
- **Time-based notifications**: Only notifies for tasks taking >30 seconds

## Supported Configurations

| Terminal | tmux | Type |
|----------|------|------|
| iTerm2 | No | `iterm2` |
| iTerm2 | Yes | `iterm-tmux` |
| Terminal.app | No | `terminal` |
| Terminal.app | Yes | `terminal-tmux` |

## Installation

```bash
./install.sh
```

To uninstall:
```bash
./install.sh --uninstall
```

## Setup

1. **Get a Slack webhook URL**:
   - Go to https://api.slack.com/apps
   - Create New App → From scratch → Name it "Claude Notifier"
   - Enable Incoming Webhooks
   - Add New Webhook to Workspace
   - Choose a channel and copy the URL

2. **Save the webhook URL**:
   ```bash
   echo 'https://hooks.slack.com/services/...' > ~/.claude/slack-webhook-url
   ```

3. **Register a Claude session**:
   In Claude, run `/slack-notify` or `/slack-notify MyProject`

## How It Works

### Architecture

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

### URL Scheme

The `claude-focus://` URL scheme encodes the terminal type and target:

- `claude-focus://iterm2/<session-uuid>` - Pure iTerm2
- `claude-focus://iterm-tmux/<tty>/<session:window.pane>` - iTerm2 + tmux
- `claude-focus://terminal/<tty>` - Pure Terminal.app
- `claude-focus://terminal-tmux/<tty>/<session:window.pane>` - Terminal.app + tmux

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

- `~/.claude/bin/claude-slack-notify` - Main notification script
- `~/.claude/bin/focus-helper` - Terminal tab switching helper
- `~/.claude/commands/slack-notify.md` - Claude command definition
- `~/.claude/slack-webhook-url` - Slack webhook URL
- `~/.claude/instances/` - Registered instance data
- `~/Applications/ClaudeFocus.app` - URL scheme handler
- `~/Library/LaunchAgents/com.claude.focus-watcher.plist` - File watcher service

## Debugging

Check the focus helper log:
```bash
tail -f /tmp/focus-debug.log
```

## License

MIT
