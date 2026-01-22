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
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Box drawing characters (used by print_header)
BOX_TL="╭"
BOX_TR="╮"
BOX_BL="╰"
BOX_BR="╯"
BOX_H="─"
BOX_V="│"

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Print a horizontal line
print_line() {
    local width="${1:-60}"
    local char="${2:--}"
    for ((i=0; i<width; i++)); do printf "%s" "$char"; done
}

# Print text centered in a box
print_box_line() {
    local text="$1"
    local width="${2:-60}"
    local text_len=${#text}
    local padding=$(( (width - text_len - 2) / 2 ))
    printf "${BOX_V}%*s%s%*s${BOX_V}\n" "$padding" "" "$text" "$((width - text_len - padding - 2))" ""
}

# Print a header box
print_header() {
    local title="$1"
    local width="${2:-50}"
    local inner_width=$((width - 2))
    local title_len=${#title}
    local left_pad=$(( (inner_width - title_len) / 2 ))
    local right_pad=$(( inner_width - title_len - left_pad ))

    echo ""
    # Top border
    printf "${CYAN}${BOX_TL}"
    for ((i=0; i<inner_width; i++)); do printf "${BOX_H}"; done
    printf "${BOX_TR}${NC}\n"
    # Title line
    printf "${CYAN}${BOX_V}${NC}${BOLD}"
    printf "%*s%s%*s" "$left_pad" "" "$title" "$right_pad" ""
    printf "${NC}${CYAN}${BOX_V}${NC}\n"
    # Bottom border
    printf "${CYAN}${BOX_BL}"
    for ((i=0; i<inner_width; i++)); do printf "${BOX_H}"; done
    printf "${BOX_BR}${NC}\n"
    echo ""
}

# Print a section header
print_section() {
    local title="$1"
    echo ""
    echo -e "${BOLD}${BLUE}▸ $title${NC}"
    echo -ne "${DIM}"
    print_line 40 "─"
    echo -e "${NC}"
}

# Check for --update flag (quick non-interactive update)
if [[ "${1:-}" == "--update" ]]; then
    echo_info "Updating Claude Slack Notify scripts..."

    # Create directories if needed
    mkdir -p "$BIN_DIR" "$COMMANDS_DIR"

    # Copy scripts
    for script in claude-slack-notify slack-notify-start slack-notify-check get-session-id focus-helper mcp-server local-tunnel remote-tunnel; do
        if [[ -f "$SCRIPT_DIR/bin/$script" ]]; then
            cp "$SCRIPT_DIR/bin/$script" "$BIN_DIR/"
            chmod +x "$BIN_DIR/$script"
        fi
    done
    echo_info "Updated scripts in $BIN_DIR/"

    # Copy command docs
    cp "$SCRIPT_DIR/commands/slack-notify.md" "$COMMANDS_DIR/"
    echo_info "Updated command docs"

    # Rebuild MCP server if source exists
    if [[ -d "$SCRIPT_DIR/mcp-server" ]]; then
        echo_info "Rebuilding MCP server..."
        cd "$SCRIPT_DIR/mcp-server"
        if command -v bun &>/dev/null; then
            bun install --silent && bun run build
        elif command -v npm &>/dev/null; then
            npm install --silent && npm run build
        fi

        # Copy to installed location
        MCP_DIST_DIR="$CLAUDE_DIR/mcp-server-dist"
        rm -rf "$MCP_DIST_DIR"
        mkdir -p "$MCP_DIST_DIR"
        cp -r "$SCRIPT_DIR/mcp-server/dist" "$MCP_DIST_DIR/"
        cp -r "$SCRIPT_DIR/mcp-server/node_modules" "$MCP_DIST_DIR/"
        cp "$SCRIPT_DIR/mcp-server/package.json" "$MCP_DIST_DIR/"
        echo_info "MCP server rebuilt and installed"
        cd "$SCRIPT_DIR"
    fi

    # Save repo path for `claude-slack-notify update`
    echo "$SCRIPT_DIR" > "$CLAUDE_DIR/.repo-path"

    echo ""
    echo -e "${GREEN}✓ Update complete!${NC}"
    echo ""
    exit 0
fi

# Check for --uninstall flag
if [[ "${1:-}" == "--uninstall" ]]; then
    echo_info "Uninstalling Claude Slack Notify..."

    # Stop and remove LaunchAgent
    launchctl unload "$LAUNCHAGENT_PATH" 2>/dev/null || true
    rm -f "$LAUNCHAGENT_PATH"
    echo_info "Removed LaunchAgent"

    # Remove ClaudeFocus.app
    rm -rf "$APP_PATH"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP_PATH" 2>/dev/null || true
    echo_info "Removed ClaudeFocus.app"

    # Remove scripts
    rm -f "$BIN_DIR/claude-slack-notify"
    rm -f "$BIN_DIR/slack-notify-start"
    rm -f "$BIN_DIR/slack-notify-check"
    rm -f "$BIN_DIR/get-session-id"
    rm -f "$BIN_DIR/focus-helper"
    rm -f "$BIN_DIR/mcp-server"
    rm -f "$BIN_DIR/local-tunnel"
    rm -f "$BIN_DIR/remote-tunnel"
    rm -f "$COMMANDS_DIR/slack-notify.md"
    echo_info "Removed scripts from ~/.claude/bin/"

    # Remove MCP server runtime files and dist
    rm -f "$CLAUDE_DIR/.mcp-server.port"
    rm -f "$CLAUDE_DIR/.mcp-server.pid"
    rm -f "$CLAUDE_DIR/mcp-server.log"
    rm -f "$CLAUDE_DIR/focus-request"
    rm -rf "$CLAUDE_DIR/mcp-server-dist"

    # Remove configuration files
    rm -f "$CLAUDE_DIR/slack-webhook-url"
    rm -f "$CLAUDE_DIR/button-config"
    rm -rf "$CLAUDE_DIR/instances/"
    rm -f "$CLAUDE_DIR/settings.json.backup"
    rm -f "$CLAUDE_DIR/.slack-config"
    echo_info "Removed configuration files"

    # Remove tunnel-related files
    rm -f "$CLAUDE_DIR/.tunnel-url"
    rm -f "$CLAUDE_DIR/.tunnel.pid"
    rm -f "$CLAUDE_DIR/.tunnel.log"
    rm -f "$CLAUDE_DIR/.tunnel-watchdog.pid"
    rm -f "$CLAUDE_DIR/.tunnel-last-activity"
    rm -f "$CLAUDE_DIR/.mac-tunnel-url"
    rm -f "$CLAUDE_DIR/.localtunnel-subdomain"
    rm -f "$CLAUDE_DIR/tunnel.log"
    # Remote-tunnel files
    rm -f "$CLAUDE_DIR/.remote-relay.pid"
    rm -f "$CLAUDE_DIR/.remote-relay.port"
    rm -f "$CLAUDE_DIR/.remote-tunnel.pid"
    rm -f "$CLAUDE_DIR/.remote-tunnel-url"
    rm -f "$CLAUDE_DIR/.remote-tunnel.log"
    rm -f "$CLAUDE_DIR/.remote-tunnel-watchdog.pid"
    rm -f "$CLAUDE_DIR/.relay-last-activity"
    rm -f "$CLAUDE_DIR/.remote-localtunnel-subdomain"
    rm -f "$CLAUDE_DIR/remote-tunnel.log"
    rm -f "$CLAUDE_DIR/remote-relay.log"
    echo_info "Removed tunnel files"

    # Remove MCP server and hooks from settings.json
    SETTINGS_FILE="$CLAUDE_DIR/settings.json"
    if [[ -f "$SETTINGS_FILE" ]] && command -v jq &> /dev/null; then
        # Check if slack-notify MCP server exists
        if jq -e '.mcpServers["slack-notify"]' "$SETTINGS_FILE" &>/dev/null 2>&1; then
            jq 'del(.mcpServers["slack-notify"])' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            echo_info "Removed slack-notify from mcpServers"
        fi

        # Check if hooks contain slack-notify references and remove them
        if grep -q "slack-notify" "$SETTINGS_FILE" 2>/dev/null; then
            # Remove hook entries that reference slack-notify scripts
            # Structure: .hooks.EventName[] = {hooks: [{command: "..."}], matcher?: "..."}
            jq '
              if .hooks then
                .hooks |= (
                  with_entries(
                    .value |= if type == "array" then
                      map(select(
                        (.hooks // []) | all(.command | test("slack-notify") | not)
                      ))
                    else . end
                  ) |
                  with_entries(select(.value | (type != "array") or (length > 0)))
                )
              else . end |
              if .hooks == {} then del(.hooks) else . end
            ' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            echo_info "Removed slack-notify hooks from settings.json"
        fi

        # Remove slack-notify permissions (both old and new patterns)
        if grep -q 'Bash(SESSION_ID=' "$SETTINGS_FILE" 2>/dev/null; then
            jq '.permissions.allow = ([.permissions.allow // []] | flatten | map(select(startswith("Bash(SESSION_ID=") | not)))' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
            echo_info "Removed slack-notify permissions from settings.json"
        fi
    elif [[ -f "$SETTINGS_FILE" ]]; then
        echo_warn "jq not found - manually remove 'slack-notify' entries from ~/.claude/settings.json"
    fi

    echo ""
    echo_info "Uninstall complete!"
    exit 0
fi

echo_info "Installing Claude Slack Notify..."

# Check for jq dependency and install if possible
if ! command -v jq &> /dev/null; then
    JQ_INSTALLED=false

    if [[ "$(uname)" == "Darwin" ]]; then
        if command -v brew &>/dev/null && brew install jq 2>/dev/null; then
            JQ_INSTALLED=true
        fi
    elif [[ "$(uname)" == "Linux" ]]; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get update -qq && sudo apt-get install -y jq 2>/dev/null && JQ_INSTALLED=true
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y jq 2>/dev/null && JQ_INSTALLED=true
        elif command -v yum &>/dev/null; then
            sudo yum install -y jq 2>/dev/null && JQ_INSTALLED=true
        fi
    fi

    if [[ "$JQ_INSTALLED" == "true" ]]; then
        echo_info "Installed jq"
    else
        echo_warn "jq not found. Install manually: brew install jq (macOS) or apt install jq (Linux)"
    fi
fi

# Check for localtunnel dependency and install if possible (for Slack button support)
if ! command -v lt &>/dev/null; then
    LT_INSTALLED=false

    if command -v bun &>/dev/null; then
        bun add -g localtunnel 2>/dev/null && LT_INSTALLED=true
    elif command -v npm &>/dev/null; then
        if [[ "$(uname)" == "Darwin" ]]; then
            npm install -g localtunnel 2>/dev/null && LT_INSTALLED=true
        else
            sudo npm install -g localtunnel 2>/dev/null && LT_INSTALLED=true
        fi
    fi

    if [[ "$LT_INSTALLED" == "true" ]]; then
        echo_info "Installed localtunnel"
    else
        echo_warn "localtunnel not found. Install manually: bun add -g localtunnel"
    fi
fi

# Check Tailscale status and provide setup info
print_section "Tunnel Backends"

if command -v tailscale &>/dev/null; then
    if tailscale status &>/dev/null 2>&1; then
        TS_DNS=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
        echo -e "  ${GREEN}✓${NC} Tailscale: ${BOLD}$TS_DNS${NC}"
    else
        echo -e "  ${YELLOW}!${NC} Tailscale installed but not connected (run: tailscale up)"
    fi
else
    echo -e "  ${YELLOW}!${NC} Tailscale not installed ${DIM}(recommended: brew install tailscale)${NC}"
fi

if command -v lt &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Localtunnel available"
else
    echo -e "  ${YELLOW}!${NC} Localtunnel not installed"
fi
echo ""

# Create directories
mkdir -p "$BIN_DIR" "$COMMANDS_DIR" "$APP_DIR" "$HOME/Library/LaunchAgents"

# Install scripts (copy for portability, especially in Docker containers)
# Use --link flag for development to create symlinks instead
SCRIPTS="claude-slack-notify slack-notify-start slack-notify-check get-session-id focus-helper mcp-server local-tunnel remote-tunnel"
if [[ "${1:-}" == "--link" ]]; then
    for script in $SCRIPTS; do ln -sf "$SCRIPT_DIR/bin/$script" "$BIN_DIR/"; done
    echo_info "Scripts symlinked to $BIN_DIR/"
else
    for script in $SCRIPTS; do rm -f "$BIN_DIR/$script"; cp "$SCRIPT_DIR/bin/$script" "$BIN_DIR/"; chmod +x "$BIN_DIR/$script"; done
    echo_info "Scripts installed to $BIN_DIR/"
fi

cp "$SCRIPT_DIR/commands/slack-notify.md" "$COMMANDS_DIR/"

# Build MCP server (optional - for Slack button actions)
MCP_DIST_DIR="$CLAUDE_DIR/mcp-server-dist"
if [[ -d "$SCRIPT_DIR/mcp-server" ]]; then
    cd "$SCRIPT_DIR/mcp-server"
    MCP_BUILD_SUCCESS=false
    if command -v bun &> /dev/null; then
        bun install --silent && bun run build && MCP_BUILD_SUCCESS=true
    elif command -v npm &> /dev/null; then
        npm install --silent && npm run build && MCP_BUILD_SUCCESS=true
    else
        echo_warn "bun/npm not found - MCP server not built"
    fi

    if [[ "$MCP_BUILD_SUCCESS" == "true" ]]; then
        echo_info "MCP server built"
        if [[ "${1:-}" != "--link" ]]; then
            rm -rf "$MCP_DIST_DIR"
            mkdir -p "$MCP_DIST_DIR"
            cp -r "$SCRIPT_DIR/mcp-server/dist" "$MCP_DIST_DIR/"
            cp -r "$SCRIPT_DIR/mcp-server/node_modules" "$MCP_DIST_DIR/"
            cp "$SCRIPT_DIR/mcp-server/package.json" "$MCP_DIST_DIR/"
        fi
    fi
    cd "$SCRIPT_DIR"
fi

# macOS-specific: Install ClaudeFocus.app and LaunchAgent
if [[ "$(uname)" == "Darwin" ]]; then

    # Create LaunchAgent that watches for focus requests
    # Uses ~/.claude/focus-request (user-owned, not world-writable /tmp)
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
        <string>FOCUS_FILE="$HOME/.claude/focus-request"; while true; do if [ -f "$FOCUS_FILE" ]; then URL=$(cat "$FOCUS_FILE"); rm -f "$FOCUS_FILE"; ~/.claude/bin/focus-helper "$URL"; fi; sleep 0.05; done</string>
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

    # Create minimal AppleScript app that writes URL to file
    SCRIPT_SOURCE='on open location theURL
    do shell script "umask 077 && echo " & quoted form of theURL & " > ~/.claude/focus-request"
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
    echo_info "ClaudeFocus.app installed"
else
    echo_info "Linux detected - run ${BOLD}remote-tunnel${NC} for Slack button support"
fi

# Add ~/.claude/bin to PATH if not already there
add_to_path() {
    local shell_rc="$1"
    if [[ -f "$shell_rc" ]]; then
        if ! grep -q 'export PATH="\$HOME/.claude/bin:\$PATH"' "$shell_rc" 2>/dev/null; then
            echo '' >> "$shell_rc"
            echo '# Claude Code tools' >> "$shell_rc"
            echo 'export PATH="$HOME/.claude/bin:$PATH"' >> "$shell_rc"
            echo_info "Added ~/.claude/bin to PATH in $shell_rc"
            return 0
        fi
    fi
    return 1
}

PATH_ADDED=false
if [[ "$SHELL" == */zsh ]]; then
    add_to_path "$HOME/.zshrc" && PATH_ADDED=true
elif [[ "$SHELL" == */bash ]]; then
    add_to_path "$HOME/.bashrc" && PATH_ADDED=true
fi

if [[ "$PATH_ADDED" == "true" ]]; then
    echo_warn "Restart your shell or run: source ~/.${SHELL##*/}rc"
fi

# =============================================================================
# Configure Slack Buttons
# =============================================================================
BUTTON_CONFIG="$CLAUDE_DIR/button-config"
DEFAULT_BUTTONS="1|1
2|2
Continue|continue
Push|push"

configure_buttons() {
    print_section "Slack Buttons"

    # Show current/default config
    if [[ -f "$BUTTON_CONFIG" ]]; then
        echo -e "  Current: $(paste -sd', ' "$BUTTON_CONFIG" | cut -d'|' -f1 | tr '\n' ' ')"
    else
        echo -e "  Default: 1, 2, Continue, Push"
    fi

    # Interactive mode only if not using --link or --uninstall and terminal is interactive
    if [[ -t 0 && "${1:-}" != "--link" ]]; then
        echo -ne "  ${YELLOW}?${NC} Configure buttons? [y/N] "
        read -r -n 1 response
        echo ""

        if [[ "$response" =~ ^[Yy]$ ]]; then
            configure_buttons_interactive
            return
        fi
    fi

    # Use defaults if no config exists
    if [[ ! -f "$BUTTON_CONFIG" ]]; then
        echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
    fi
}

configure_buttons_interactive() {
    echo ""
    echo -e "  Format: ${BOLD}LABEL|ACTION${NC} (max 4 buttons, Enter to finish)"
    echo ""

    local buttons=()
    local count=0

    while [[ $count -lt 4 ]]; do
        echo -ne "  Button $((count + 1)) label: "
        read -r label
        [[ -z "$label" ]] && break

        echo -ne "  Action to send [${label}]: "
        read -r action
        [[ -z "$action" ]] && action="$label"

        buttons+=("$label|$action")
        ((count++))
    done

    if [[ ${#buttons[@]} -eq 0 ]]; then
        echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
        echo_info "Using default buttons"
    else
        printf '%s\n' "${buttons[@]}" > "$BUTTON_CONFIG"
        echo_info "Saved ${#buttons[@]} button(s)"
    fi
}

# Only configure buttons interactively on fresh install or when --configure flag is passed
if [[ "${1:-}" == "--configure" || ( ! -f "$BUTTON_CONFIG" && "${1:-}" != "--uninstall" ) ]]; then
    configure_buttons "${1:-}"
elif [[ ! -f "$BUTTON_CONFIG" ]]; then
    echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
fi

# =============================================================================
# Setup hooks and permissions in settings.json
# =============================================================================
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# Permissions needed for /slack-notify command
# Pattern matches the register command which contains SESSION_ID= and claude-slack-notify
SLACK_PERMISSIONS='[
  "Bash(SESSION_ID=*claude-slack-notify*)"
]'

# Our hooks to add
# Hook events (from official docs):
# - UserPromptSubmit: When user submits a prompt (start timer)
# - Stop: When main agent finishes responding (notify if elapsed > threshold)
# - SubagentStop: When a subagent (Task) finishes (notify if elapsed > threshold)
# - PermissionRequest: When user shown a permission dialog (notify immediately)
# - Notification: Various notification events (idle_prompt, elicitation_dialog, permission_prompt)
SLACK_HOOKS='{
  "hooks": {
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-start", "timeout": 5}]}
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]}
    ],
    "SubagentStop": [
      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]}
    ],
    "PermissionRequest": [
      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]}
    ],
    "Notification": [
      {"matcher": "idle_prompt", "hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]},
      {"matcher": "elicitation_dialog", "hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]},
      {"matcher": "permission_prompt", "hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-check", "timeout": 10}]}
    ]
  }
}'

if [[ -f "$SETTINGS_FILE" ]]; then
    HOOKS_CONFIGURED=false
    PERMS_CONFIGURED=false

    # Check what's already configured
    if grep -q "slack-notify-start" "$SETTINGS_FILE" 2>/dev/null; then
        HOOKS_CONFIGURED=true
    fi
    if grep -q 'Bash(SESSION_ID=:\*)' "$SETTINGS_FILE" 2>/dev/null; then
        PERMS_CONFIGURED=true
    fi

    if command -v jq &> /dev/null; then
        # Create backup before any changes
        if [[ "$HOOKS_CONFIGURED" != "true" || "$PERMS_CONFIGURED" != "true" ]]; then
            cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
        fi

        # Add hooks if not already configured
        if [[ "$HOOKS_CONFIGURED" != "true" ]]; then
            # Deep merge: combine hooks arrays instead of replacing
            MERGED=$(jq -s '
              def merge_hooks:
                reduce .[] as $item ({};
                  . as $acc |
                  $item | to_entries | reduce .[] as $e ($acc;
                    if .[$e.key] then
                      .[$e.key] += $e.value
                    else
                      .[$e.key] = $e.value
                    end
                  )
                );
              .[0] * {hooks: ([.[0].hooks // {}, .[1].hooks] | merge_hooks)}
            ' "$SETTINGS_FILE" <(echo "$SLACK_HOOKS") 2>/dev/null)

            if [[ -n "$MERGED" ]] && echo "$MERGED" | jq . > /dev/null 2>&1; then
                echo "$MERGED" > "$SETTINGS_FILE"
                echo_info "Hooks added to settings.json"
            else
                echo_warn "Failed to merge hooks - add manually"
            fi
        fi

        # Add permissions if not already configured
        if [[ "$PERMS_CONFIGURED" != "true" ]]; then
            # Merge permissions: add our permissions to existing allow list
            MERGED=$(jq --argjson perms "$SLACK_PERMISSIONS" '
              .permissions.allow = ((.permissions.allow // []) + $perms | unique)
            ' "$SETTINGS_FILE" 2>/dev/null)

            if [[ -n "$MERGED" ]] && echo "$MERGED" | jq . > /dev/null 2>&1; then
                echo "$MERGED" > "$SETTINGS_FILE"
                echo_info "Bash permissions added to settings.json"
            else
                echo_warn "Failed to add permissions - add manually"
            fi
        fi
    else
        # No jq - show manual instructions
        if [[ "$HOOKS_CONFIGURED" != "true" || "$PERMS_CONFIGURED" != "true" ]]; then
            echo_warn "jq not found - manual settings.json configuration required"
            echo_warn "Install jq for automatic configuration: brew install jq"
        fi
    fi
fi

# =============================================================================
# Slack App Setup (Interactive)
# =============================================================================
SLACK_CONFIG_FILE="$CLAUDE_DIR/.slack-config"
WEBHOOK_FILE="$CLAUDE_DIR/slack-webhook-url"

if [[ -d "$SCRIPT_DIR/mcp-server/dist" && -t 0 && "${1:-}" != "--link" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS: Full setup via local-tunnel (handles app, webhook, channel)
        if [[ ! -f "$SLACK_CONFIG_FILE" ]]; then
            echo ""
            echo -ne "${YELLOW}?${NC} Set up Slack app now? [Y/n] "
            read -r response

            if [[ ! "$response" =~ ^[Nn]$ ]]; then
                "$BIN_DIR/local-tunnel" --setup
            fi
        fi
    else
        # Linux: Config is synced from Mac via `claude-slack-notify remote`
        if [[ ! -f "$SLACK_CONFIG_FILE" ]]; then
            echo_info "Slack config needed"
            echo -e "  Run on Mac: ${BOLD}claude-slack-notify remote${NC} (syncs config automatically)"
        fi
    fi
fi

# =============================================================================
# Button Configuration
# =============================================================================
# Only configure buttons interactively on fresh install or when --configure flag is passed
if [[ "${1:-}" == "--configure" || ( ! -f "$BUTTON_CONFIG" && "${1:-}" != "--uninstall" ) ]]; then
    configure_buttons "${1:-}"
elif [[ ! -f "$BUTTON_CONFIG" ]]; then
    echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
fi

# =============================================================================
# Auto-configure MCP Server in settings.json
# =============================================================================
if [[ -d "$SCRIPT_DIR/mcp-server/dist" ]] && command -v jq &> /dev/null; then
    MCP_CONFIGURED=false

    if [[ -f "$SETTINGS_FILE" ]]; then
        if jq -e '.mcpServers["slack-notify"]' "$SETTINGS_FILE" &>/dev/null 2>&1; then
            MCP_CONFIGURED=true
        else
            [[ ! -f "$SETTINGS_FILE.backup" ]] && cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
            MCP_CONFIG="{\"mcpServers\": {\"slack-notify\": {\"type\": \"stdio\", \"command\": \"$HOME/.claude/bin/mcp-server\"}}}"
            MERGED=$(jq ". * $MCP_CONFIG" "$SETTINGS_FILE" 2>/dev/null)
            if [[ -n "$MERGED" ]] && echo "$MERGED" | jq . > /dev/null 2>&1; then
                echo "$MERGED" > "$SETTINGS_FILE"
                echo_info "MCP server added to settings.json"
                MCP_CONFIGURED=true
            fi
        fi
    else
        echo "{\"mcpServers\": {\"slack-notify\": {\"type\": \"stdio\", \"command\": \"$HOME/.claude/bin/mcp-server\"}}}" | jq . > "$SETTINGS_FILE"
        echo_info "Created settings.json with MCP server"
        MCP_CONFIGURED=true
    fi
fi

# Save repo path for `claude-slack-notify update`
echo "$SCRIPT_DIR" > "$CLAUDE_DIR/.repo-path"

# =============================================================================
# Final Summary
# =============================================================================
print_header "Installation Complete" 50

echo -e "  ${GREEN}✓${NC} Scripts: ${BOLD}~/.claude/bin/${NC}"
[[ "$(uname)" == "Darwin" ]] && echo -e "  ${GREEN}✓${NC} ClaudeFocus.app + LaunchAgent"
[[ -d "$SCRIPT_DIR/mcp-server/dist" ]] && echo -e "  ${GREEN}✓${NC} MCP server"
[[ -f "$SLACK_CONFIG_FILE" ]] && echo -e "  ${GREEN}✓${NC} Slack configured"
echo ""

echo -e "${BOLD}Next Steps${NC}"
echo -e "  1. Start tunnel:  ${CYAN}local-tunnel${NC}"
echo -e "  2. In Claude:     ${CYAN}/slack-notify${NC}"
echo ""
