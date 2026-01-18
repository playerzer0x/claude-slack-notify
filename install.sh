#!/bin/bash
set -euo pipefail

# =============================================================================
# Claude Slack Notify - Installation Script
# Sends Slack notifications with clickable "Focus Terminal" buttons
#
# Supports: iTerm2, Terminal.app, tmux (and combinations)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
BIN_DIR="$CLAUDE_DIR/bin"
COMMANDS_DIR="$CLAUDE_DIR/commands"
APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/ClaudeFocus.app"
LAUNCHAGENT_PATH="$HOME/Library/LaunchAgents/com.claude.focus-watcher.plist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for --uninstall flag
if [[ "${1:-}" == "--uninstall" ]]; then
    echo_info "Uninstalling Claude Slack Notify..."

    # Stop and remove LaunchAgent
    launchctl unload "$LAUNCHAGENT_PATH" 2>/dev/null || true
    rm -f "$LAUNCHAGENT_PATH"

    # Remove ClaudeFocus.app
    rm -rf "$APP_PATH"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP_PATH" 2>/dev/null || true

    # Remove scripts
    rm -f "$BIN_DIR/claude-slack-notify"
    rm -f "$BIN_DIR/focus-helper"
    rm -f "$COMMANDS_DIR/slack-notify.md"

    echo_info "Uninstalled successfully"
    echo_warn "Note: ~/.claude/slack-webhook-url and ~/.claude/instances/ were preserved"
    exit 0
fi

echo_info "Installing Claude Slack Notify..."

# Create directories
mkdir -p "$BIN_DIR" "$COMMANDS_DIR" "$APP_DIR" "$HOME/Library/LaunchAgents"

# Install scripts
cp "$SCRIPT_DIR/bin/claude-slack-notify" "$BIN_DIR/"
cp "$SCRIPT_DIR/bin/focus-helper" "$BIN_DIR/"
chmod +x "$BIN_DIR/claude-slack-notify" "$BIN_DIR/focus-helper"
echo_info "Installed scripts to $BIN_DIR/"

# Install Claude command
cp "$SCRIPT_DIR/commands/slack-notify.md" "$COMMANDS_DIR/"
echo_info "Installed Claude command to $COMMANDS_DIR/"

# macOS-specific: Install ClaudeFocus.app and LaunchAgent
if [[ "$(uname)" == "Darwin" ]]; then
    # Create LaunchAgent that watches for focus requests
    cat > "$LAUNCHAGENT_PATH" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.focus-watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>while true; do if [ -f /tmp/claude-focus-request ]; then URL=$(cat /tmp/claude-focus-request); rm -f /tmp/claude-focus-request; ~/.claude/bin/focus-helper "$URL"; fi; sleep 0.2; done</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

    # Load the LaunchAgent
    launchctl unload "$LAUNCHAGENT_PATH" 2>/dev/null || true
    launchctl load "$LAUNCHAGENT_PATH"
    echo_info "LaunchAgent installed and loaded"

    # Create minimal AppleScript app that writes URL to file
    SCRIPT_SOURCE='on open location theURL
    do shell script "echo " & quoted form of theURL & " > /tmp/claude-focus-request"
end open location'

    TEMP_SCRIPT=$(mktemp /tmp/ClaudeFocus.XXXXXX.applescript)
    echo "$SCRIPT_SOURCE" > "$TEMP_SCRIPT"

    rm -rf "$APP_PATH"
    osacompile -o "$APP_PATH" "$TEMP_SCRIPT"
    rm "$TEMP_SCRIPT"

    # Add URL scheme to Info.plist
    PLIST="$APP_PATH/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.claude.focus" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'Claude Focus Handler'" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string 'claude-focus'" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :LSBackgroundOnly bool true" "$PLIST" 2>/dev/null || true

    # Register with Launch Services
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"
    echo_info "ClaudeFocus.app installed to $APP_PATH"
else
    echo_warn "Not macOS - skipping ClaudeFocus.app installation"
    echo_warn "Slack notifications will work but without clickable focus buttons"
fi

# Setup hooks if settings.json exists
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
    if ! grep -q "claude-slack-notify" "$SETTINGS_FILE" 2>/dev/null; then
        echo_warn "Add these hooks to $SETTINGS_FILE for automatic notifications:"
        echo ""
        echo '  "hooks": {'
        echo '    "PreToolUse": ['
        echo '      {'
        echo '        "matcher": "Bash|Edit|Write",'
        echo '        "hooks": ['
        echo '          {'
        echo '            "type": "command",'
        echo '            "command": "CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify start"'
        echo '          }'
        echo '        ]'
        echo '      }'
        echo '    ],'
        echo '    "PostToolUse": ['
        echo '      {'
        echo '        "matcher": "Bash|Edit|Write",'
        echo '        "hooks": ['
        echo '          {'
        echo '            "type": "command",'
        echo '            "command": "CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify check"'
        echo '          }'
        echo '        ]'
        echo '      }'
        echo '    ]'
        echo '  }'
    fi
fi

echo ""
echo "=========================================="
echo_info "Installation complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Get a Slack webhook URL from https://api.slack.com/apps"
echo "2. Save it: echo 'YOUR_WEBHOOK_URL' > ~/.claude/slack-webhook-url"
echo "3. In Claude, run: /slack-notify"
echo ""
echo "The Focus Terminal button will switch to the correct terminal tab."
echo ""
