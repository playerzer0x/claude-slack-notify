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

# Box drawing characters
BOX_TL="╭"
BOX_TR="╮"
BOX_BL="╰"
BOX_BR="╯"
BOX_H="─"
BOX_V="│"
BOX_T="┬"
BOX_B="┴"
BOX_ML="├"
BOX_MR="┤"

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

# Parse flags
HOOKS_ONLY=false
if [[ "${1:-}" == "--hooks-only" ]]; then
    HOOKS_ONLY=true
    echo_info "Installing hooks only (for remote machines)"
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
    rm -f "$BIN_DIR/slack-tunnel"
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
    echo_info "Removed configuration files"

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
    echo_info "jq not found - attempting to install..."
    JQ_INSTALLED=false

    if [[ "$(uname)" == "Darwin" ]]; then
        # macOS - try Homebrew
        if command -v brew &>/dev/null; then
            if brew install jq 2>/dev/null; then
                JQ_INSTALLED=true
                echo_info "jq installed via Homebrew"
            fi
        fi
    elif [[ "$(uname)" == "Linux" ]]; then
        # Linux - try apt, dnf, or yum
        if command -v apt-get &>/dev/null; then
            if sudo apt-get update -qq && sudo apt-get install -y jq 2>/dev/null; then
                JQ_INSTALLED=true
                echo_info "jq installed via apt"
            fi
        elif command -v dnf &>/dev/null; then
            if sudo dnf install -y jq 2>/dev/null; then
                JQ_INSTALLED=true
                echo_info "jq installed via dnf"
            fi
        elif command -v yum &>/dev/null; then
            if sudo yum install -y jq 2>/dev/null; then
                JQ_INSTALLED=true
                echo_info "jq installed via yum"
            fi
        fi
    fi

    if [[ "$JQ_INSTALLED" != "true" ]]; then
        echo_warn "Could not auto-install jq. Install manually for auto-configuration:"
        echo_warn "  macOS:  brew install jq"
        echo_warn "  Ubuntu: sudo apt install jq"
        echo_warn "  Fedora: sudo dnf install jq"
    fi
fi

# Create directories
mkdir -p "$BIN_DIR" "$COMMANDS_DIR" "$APP_DIR" "$HOME/Library/LaunchAgents"

# Install scripts (copy for portability, especially in Docker containers)
# Use --link flag for development to create symlinks instead
if [[ "${1:-}" == "--link" ]]; then
    ln -sf "$SCRIPT_DIR/bin/claude-slack-notify" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/slack-notify-start" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/slack-notify-check" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/get-session-id" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/focus-helper" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/mcp-server" "$BIN_DIR/"
    ln -sf "$SCRIPT_DIR/bin/slack-tunnel" "$BIN_DIR/"
    echo_info "Installed scripts to $BIN_DIR/ (symlinked to repo)"
else
    # Remove existing files/symlinks first, then copy fresh
    rm -f "$BIN_DIR/claude-slack-notify" "$BIN_DIR/slack-notify-start" "$BIN_DIR/slack-notify-check" "$BIN_DIR/get-session-id" "$BIN_DIR/focus-helper" "$BIN_DIR/mcp-server" "$BIN_DIR/slack-tunnel"
    cp "$SCRIPT_DIR/bin/claude-slack-notify" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/slack-notify-start" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/slack-notify-check" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/get-session-id" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/focus-helper" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/mcp-server" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/slack-tunnel" "$BIN_DIR/"
    chmod +x "$BIN_DIR/claude-slack-notify" "$BIN_DIR/slack-notify-start" "$BIN_DIR/slack-notify-check" "$BIN_DIR/get-session-id" "$BIN_DIR/focus-helper" "$BIN_DIR/mcp-server" "$BIN_DIR/slack-tunnel"
    echo_info "Installed scripts to $BIN_DIR/"
fi

# Install Claude command
cp "$SCRIPT_DIR/commands/slack-notify.md" "$COMMANDS_DIR/"
echo_info "Installed Claude command to $COMMANDS_DIR/"

# Build MCP server (optional - for Slack button actions)
# Skip if --hooks-only (remote machines don't need local MCP server)
MCP_DIST_DIR="$CLAUDE_DIR/mcp-server-dist"
if [[ "$HOOKS_ONLY" != "true" && -d "$SCRIPT_DIR/mcp-server" ]]; then
    echo_info "Building MCP server..."
    cd "$SCRIPT_DIR/mcp-server"
    MCP_BUILD_SUCCESS=false
    if command -v bun &> /dev/null; then
        bun install --silent
        bun run build
        MCP_BUILD_SUCCESS=true
        echo_info "MCP server built successfully"
    elif command -v npm &> /dev/null; then
        npm install --silent
        npm run build
        MCP_BUILD_SUCCESS=true
        echo_info "MCP server built successfully"
    else
        echo_warn "Neither bun nor npm found. MCP server not built."
        echo_warn "To build later: cd $SCRIPT_DIR/mcp-server && bun install && bun run build"
    fi

    # Copy MCP server files to ~/.claude/mcp-server-dist/ (unless using --link)
    if [[ "$MCP_BUILD_SUCCESS" == "true" && "${1:-}" != "--link" ]]; then
        rm -rf "$MCP_DIST_DIR"
        mkdir -p "$MCP_DIST_DIR"
        cp -r "$SCRIPT_DIR/mcp-server/dist" "$MCP_DIST_DIR/"
        cp -r "$SCRIPT_DIR/mcp-server/node_modules" "$MCP_DIST_DIR/"
        cp "$SCRIPT_DIR/mcp-server/package.json" "$MCP_DIST_DIR/"
        echo_info "MCP server installed to $MCP_DIST_DIR"
    fi

    cd "$SCRIPT_DIR"
fi

# macOS-specific: Install ClaudeFocus.app and LaunchAgent
# Skip if --hooks-only (remote machines don't need focus app)
if [[ "$HOOKS_ONLY" != "true" && "$(uname)" == "Darwin" ]]; then
    print_section "macOS Focus Button Setup"
    echo ""
    echo -e "  ${DIM}Installing ClaudeFocus.app to enable the 'Focus Terminal' button in Slack.${NC}"
    echo -e "  ${DIM}This app handles claude-focus:// URLs to switch to your terminal.${NC}"
    echo ""
    echo -e "  ${YELLOW}Note:${NC} macOS may prompt you to grant permissions:"
    echo -e "    ${CYAN}•${NC} ${BOLD}Accessibility${NC} - to focus terminal windows"
    echo -e "    ${CYAN}•${NC} ${BOLD}Automation${NC} - to control iTerm2/Terminal.app"
    echo ""
    echo -e "  ${DIM}These are safe to approve - the app only switches window focus.${NC}"
    echo ""

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
    echo_info "LaunchAgent installed and loaded"

    # Create minimal AppleScript app that writes URL to file
    # Uses ~/.claude/focus-request (user-owned, not world-writable /tmp)
    # File is created with 0600 permissions for security
    # Note: Direct invocation doesn't work due to Apple event permissions
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
    echo_info "ClaudeFocus.app installed to $APP_PATH"
else
    echo_warn "Not macOS - skipping ClaudeFocus.app installation"
    echo_warn "Slack notifications will work but without clickable focus buttons"
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
    print_section "Slack Button Configuration"
    echo ""
    echo -e "  ${DIM}Configure the action buttons that appear in Slack notifications.${NC}"
    echo -e "  ${DIM}The Focus button is always included as the primary button.${NC}"
    echo ""

    # Show current/default config
    if [[ -f "$BUTTON_CONFIG" ]]; then
        echo -e "  ${BOLD}Current buttons:${NC}"
        local i=1
        while IFS='|' read -r label action || [[ -n "$label" ]]; do
            [[ -z "$label" || "$label" == \#* ]] && continue
            echo -e "    ${CYAN}$i.${NC} ${BOLD}$label${NC} ${DIM}(sends: $action)${NC}"
            ((i++))
        done < "$BUTTON_CONFIG"
    else
        echo -e "  ${BOLD}Default buttons:${NC}"
        echo -e "    ${CYAN}1.${NC} ${BOLD}1${NC} ${DIM}(sends: 1)${NC}"
        echo -e "    ${CYAN}2.${NC} ${BOLD}2${NC} ${DIM}(sends: 2)${NC}"
        echo -e "    ${CYAN}3.${NC} ${BOLD}Continue${NC} ${DIM}(sends: continue)${NC}"
        echo -e "    ${CYAN}4.${NC} ${BOLD}Push${NC} ${DIM}(sends: push)${NC}"
    fi
    echo ""

    # Interactive mode only if not using --link or --uninstall and terminal is interactive
    if [[ -t 0 && "${1:-}" != "--link" ]]; then
        echo -e "  ${YELLOW}?${NC} Configure buttons? [y/N] "
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
        echo_info "Using default button configuration"
    fi
}

configure_buttons_interactive() {
    echo ""
    print_section "Button Editor"
    echo ""
    echo -e "  ${DIM}Format: LABEL|ACTION${NC}"
    echo -e "  ${DIM}Example: Continue|continue (button says 'Continue', sends 'continue')${NC}"
    echo -e "  ${DIM}Slack allows up to 4 action buttons (plus Focus = 5 total).${NC}"
    echo ""

    local buttons=()
    local count=0
    local max_buttons=4

    while [[ $count -lt $max_buttons ]]; do
        echo -e "  ${CYAN}Button $((count + 1))${NC} (or press Enter to finish):"
        echo -ne "    Label: "
        read -r label

        [[ -z "$label" ]] && break

        echo -ne "    Action to send: "
        read -r action

        if [[ -z "$action" ]]; then
            action="$label"
        fi

        buttons+=("$label|$action")
        ((count++))
        echo -e "    ${GREEN}✓${NC} Added: ${BOLD}$label${NC} ${DIM}→ $action${NC}"
        echo ""
    done

    if [[ ${#buttons[@]} -eq 0 ]]; then
        echo -e "  ${DIM}No buttons configured, using defaults${NC}"
        echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
    else
        printf '%s\n' "${buttons[@]}" > "$BUTTON_CONFIG"
        echo ""
        echo_info "Saved ${#buttons[@]} button(s) to $BUTTON_CONFIG"
    fi
}

# Only configure buttons interactively on fresh install or when --configure flag is passed
if [[ "${1:-}" == "--configure" || ( ! -f "$BUTTON_CONFIG" && "${1:-}" != "--uninstall" ) ]]; then
    configure_buttons "${1:-}"
elif [[ ! -f "$BUTTON_CONFIG" ]]; then
    echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
fi

# =============================================================================
# Setup hooks in settings.json
# =============================================================================
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# Our hooks to add
SLACK_HOOKS='{
  "hooks": {
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "$HOME/.claude/bin/slack-notify-start", "timeout": 5}]}
    ],
    "Stop": [
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
    if grep -q "slack-notify" "$SETTINGS_FILE" 2>/dev/null; then
        # Already configured
        :
    elif command -v jq &> /dev/null; then
        # Auto-merge using jq
        print_section "Claude Hooks"
        echo -e "  ${DIM}Adding notification hooks to $SETTINGS_FILE${NC}"
        echo ""

        # Create backup
        cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"

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
            echo_info "Hooks added to settings.json (backup at settings.json.backup)"
        else
            echo_warn "Failed to merge hooks - restoring backup"
            mv "$SETTINGS_FILE.backup" "$SETTINGS_FILE"
            echo_warn "Add hooks manually (see below)"
        fi
        echo ""
    else
        # No jq - show manual instructions
        print_section "Claude Hooks"
        echo -e "  ${DIM}Add these hooks to $SETTINGS_FILE for automatic notifications:${NC}"
        echo ""
        echo -e "  ${CYAN}\"hooks\": {"
        echo -e "    \"UserPromptSubmit\": ["
        echo -e "      {\"hooks\": [{\"type\": \"command\", \"command\": \"\$HOME/.claude/bin/slack-notify-start\", \"timeout\": 5}]}"
        echo -e "    ],"
        echo -e "    \"Stop\": ["
        echo -e "      {\"hooks\": [{\"type\": \"command\", \"command\": \"\$HOME/.claude/bin/slack-notify-check\", \"timeout\": 10}]}"
        echo -e "    ],"
        echo -e "    \"Notification\": ["
        echo -e "      {\"matcher\": \"idle_prompt\", \"hooks\": [{\"type\": \"command\", \"command\": \"\$HOME/.claude/bin/slack-notify-check\", \"timeout\": 10}]},"
        echo -e "      {\"matcher\": \"elicitation_dialog\", \"hooks\": [{\"type\": \"command\", \"command\": \"\$HOME/.claude/bin/slack-notify-check\", \"timeout\": 10}]},"
        echo -e "      {\"matcher\": \"permission_prompt\", \"hooks\": [{\"type\": \"command\", \"command\": \"\$HOME/.claude/bin/slack-notify-check\", \"timeout\": 10}]}"
        echo -e "    ]"
        echo -e "  }${NC}"
        echo -e "  ${DIM}(Install jq for automatic hook configuration: brew install jq)${NC}"
        echo ""
    fi
fi

# =============================================================================
# Final Summary
# =============================================================================
print_header "Installation Complete" 50

echo -e "  ${GREEN}✓${NC} Scripts installed to ${BOLD}~/.claude/bin/${NC}"
if [[ "$(uname)" == "Darwin" ]]; then
    echo -e "  ${GREEN}✓${NC} ClaudeFocus.app installed"
    echo -e "  ${GREEN}✓${NC} LaunchAgent loaded"
fi
echo -e "  ${GREEN}✓${NC} Button config at ${BOLD}~/.claude/button-config${NC}"
if [[ -d "$SCRIPT_DIR/mcp-server/dist" ]]; then
    echo -e "  ${GREEN}✓${NC} MCP server built (start with: ${BOLD}~/.claude/bin/mcp-server${NC})"
fi
echo ""

WEBHOOK_FILE="$CLAUDE_DIR/slack-webhook-url"

if [[ -f "$WEBHOOK_FILE" ]]; then
    print_section "Webhook Configuration"
    echo ""
    echo -e "  ${GREEN}✓${NC} Webhook URL already configured at ${BOLD}~/.claude/slack-webhook-url${NC}"
    echo ""
else
    print_section "Slack Webhook Setup"
    echo ""
    echo -e "  ${DIM}To receive notifications, you need a Slack webhook URL.${NC}"
    echo ""
    echo -e "  ${BOLD}Quick setup:${NC}"
    echo -e "    1. Go to ${CYAN}https://api.slack.com/apps${NC}"
    echo -e "    2. Create New App → From scratch"
    echo -e "    3. Click ${BOLD}Incoming Webhooks${NC} → Toggle ${BOLD}Activate Incoming Webhooks${NC} to On"
    echo -e "    4. Click ${BOLD}Add New Webhook to Workspace${NC} → Select a channel → Click ${BOLD}Allow${NC}"
    echo -e "    5. Copy the webhook URL"
    echo ""

    if [[ -t 0 ]]; then
        echo -e "  ${YELLOW}?${NC} Paste your Slack webhook URL (or press Enter to skip): "
        read -r webhook_url

        if [[ -n "$webhook_url" ]]; then
            if [[ "$webhook_url" =~ ^https://hooks\.slack\.com/ ]]; then
                echo "$webhook_url" > "$WEBHOOK_FILE"
                chmod 600 "$WEBHOOK_FILE"
                echo_info "Webhook URL saved to ~/.claude/slack-webhook-url"
            else
                echo_warn "URL doesn't look like a Slack webhook (should start with https://hooks.slack.com/)"
                echo_warn "Saving anyway - you can edit ~/.claude/slack-webhook-url later"
                echo "$webhook_url" > "$WEBHOOK_FILE"
                chmod 600 "$WEBHOOK_FILE"
            fi
        else
            echo_warn "Skipped - run this later to set up:"
            echo_warn "  echo 'YOUR_URL' > ~/.claude/slack-webhook-url"
        fi
    else
        echo -e "  ${DIM}(Non-interactive mode - skipping webhook prompt)${NC}"
        echo -e "  ${DIM}Run: echo 'YOUR_URL' > ~/.claude/slack-webhook-url${NC}"
    fi
    echo ""
fi

print_section "Next Steps"
echo ""
echo -e "  ${CYAN}1.${NC} In Claude, run: ${BOLD}/slack-notify${NC}"
echo ""
echo -e "  ${DIM}The Focus button will switch to the correct terminal tab.${NC}"
echo -e "  ${DIM}Run ${BOLD}./install.sh --configure${NC}${DIM} to change button layout.${NC}"
echo ""

# Show slack-tunnel info if MCP server was built
if [[ -d "$SCRIPT_DIR/mcp-server/dist" ]]; then
    print_section "Slack Button Actions (Optional)"
    echo ""
    echo -e "  ${DIM}To respond to Claude directly from Slack (buttons like \"Continue\", \"1\", \"2\"):${NC}"
    echo ""
    echo -e "  ${CYAN}2.${NC} Run: ${BOLD}slack-tunnel${NC}"
    echo -e "     ${DIM}This starts ngrok and displays a URL to add to your Slack app${NC}"
    echo ""
    echo -e "  ${CYAN}3.${NC} Configure your Slack app at ${BOLD}https://api.slack.com/apps${NC}:"
    echo -e "     ${DIM}• Go to Interactivity & Shortcuts → Toggle Interactivity On${NC}"
    echo -e "     ${DIM}• Paste the URL from slack-tunnel into Request URL${NC}"
    echo -e "     ${DIM}• Click Save Changes${NC}"
    echo ""
    echo -e "  ${DIM}Note: Run slack-tunnel whenever you want Slack buttons to work${NC}"
    echo ""
fi

# =============================================================================
# Auto-configure MCP Server in settings.json
# Skip if --hooks-only (remote machines don't need MCP server)
# =============================================================================
if [[ "$HOOKS_ONLY" != "true" && -d "$SCRIPT_DIR/mcp-server/dist" ]]; then
    MCP_CONFIGURED=false

    if [[ -f "$SETTINGS_FILE" ]]; then
        # Check if already configured
        if jq -e '.mcpServers["slack-notify"]' "$SETTINGS_FILE" &>/dev/null 2>&1; then
            MCP_CONFIGURED=true
        elif command -v jq &> /dev/null; then
            print_section "MCP Server Configuration"
            echo -e "  ${DIM}Adding MCP server to settings.json for Slack button actions...${NC}"
            echo ""

            # Create backup if not already done
            if [[ ! -f "$SETTINGS_FILE.backup" ]]; then
                cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"
            fi

            # Add MCP server config
            MCP_CONFIG="{\"mcpServers\": {\"slack-notify\": {\"type\": \"stdio\", \"command\": \"$HOME/.claude/bin/mcp-server\"}}}"

            MERGED=$(jq ". * $MCP_CONFIG" "$SETTINGS_FILE" 2>/dev/null)

            if [[ -n "$MERGED" ]] && echo "$MERGED" | jq . > /dev/null 2>&1; then
                echo "$MERGED" > "$SETTINGS_FILE"
                echo_info "MCP server added to settings.json"
                MCP_CONFIGURED=true
            else
                echo_warn "Failed to add MCP config - add manually (see below)"
            fi
            echo ""
        fi
    else
        # Create new settings.json with MCP config
        if command -v jq &> /dev/null; then
            print_section "MCP Server Configuration"
            echo -e "  ${DIM}Creating settings.json with MCP server config...${NC}"
            echo ""

            echo "{\"mcpServers\": {\"slack-notify\": {\"type\": \"stdio\", \"command\": \"$HOME/.claude/bin/mcp-server\"}}}" | jq . > "$SETTINGS_FILE"
            echo_info "Created settings.json with MCP server config"
            MCP_CONFIGURED=true
            echo ""
        fi
    fi

    # Show manual instructions if auto-config failed
    if [[ "$MCP_CONFIGURED" != "true" ]]; then
        print_section "MCP Server Setup (Manual)"
        echo ""
        echo -e "  ${DIM}The MCP server enables Slack button actions (respond from Slack).${NC}"
        echo -e "  ${DIM}Install jq for automatic configuration: brew install jq${NC}"
        echo ""
        echo -e "  Add to ${BOLD}~/.claude/settings.json${NC}:"
        echo ""
        echo -e "  ${CYAN}\"mcpServers\": {"
        echo -e "    \"slack-notify\": {"
        echo -e "      \"type\": \"stdio\","
        echo -e "      \"command\": \"$HOME/.claude/bin/mcp-server\""
        echo -e "    }"
        echo -e "  }${NC}"
        echo ""
        echo -e "  Restart Claude Code for MCP to take effect"
        echo ""
    fi
fi
