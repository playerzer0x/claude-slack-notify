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
    rm -f "$BIN_DIR/slack-notify-start"
    rm -f "$BIN_DIR/slack-notify-check"
    rm -f "$BIN_DIR/get-session-id"
    rm -f "$BIN_DIR/focus-helper"
    rm -f "$COMMANDS_DIR/slack-notify.md"

    echo_info "Uninstalled successfully"
    echo_warn "Note: ~/.claude/slack-webhook-url and ~/.claude/instances/ were preserved"
    exit 0
fi

echo_info "Installing Claude Slack Notify..."

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
    echo_info "Installed scripts to $BIN_DIR/ (symlinked to repo)"
else
    # Remove existing files/symlinks first, then copy fresh
    rm -f "$BIN_DIR/claude-slack-notify" "$BIN_DIR/slack-notify-start" "$BIN_DIR/slack-notify-check" "$BIN_DIR/get-session-id" "$BIN_DIR/focus-helper"
    cp "$SCRIPT_DIR/bin/claude-slack-notify" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/slack-notify-start" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/slack-notify-check" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/get-session-id" "$BIN_DIR/"
    cp "$SCRIPT_DIR/bin/focus-helper" "$BIN_DIR/"
    chmod +x "$BIN_DIR/claude-slack-notify" "$BIN_DIR/slack-notify-start" "$BIN_DIR/slack-notify-check" "$BIN_DIR/get-session-id" "$BIN_DIR/focus-helper"
    echo_info "Installed scripts to $BIN_DIR/"
fi

# Install Claude command
cp "$SCRIPT_DIR/commands/slack-notify.md" "$COMMANDS_DIR/"
echo_info "Installed Claude command to $COMMANDS_DIR/"

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
    configure_buttons "$1"
elif [[ ! -f "$BUTTON_CONFIG" ]]; then
    echo "$DEFAULT_BUTTONS" > "$BUTTON_CONFIG"
fi

# =============================================================================
# Setup hooks if settings.json exists
# =============================================================================
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [[ -f "$SETTINGS_FILE" ]]; then
    if ! grep -q "claude-slack-notify" "$SETTINGS_FILE" 2>/dev/null; then
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
        echo -e "  ${DIM}(Notification hooks handle plan mode, questions, and permission dialogs)${NC}"
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
echo ""

print_section "Next Steps"
echo ""
echo -e "  ${CYAN}1.${NC} Get a Slack webhook URL:"
echo -e "     ${DIM}https://api.slack.com/apps${NC}"
echo ""
echo -e "  ${CYAN}2.${NC} Save the webhook URL:"
echo -e "     ${DIM}echo 'YOUR_URL' > ~/.claude/slack-webhook-url${NC}"
echo ""
echo -e "  ${CYAN}3.${NC} In Claude, run:"
echo -e "     ${BOLD}/slack-notify${NC}"
echo ""
echo -e "  ${DIM}The Focus button will switch to the correct terminal tab.${NC}"
echo -e "  ${DIM}Run ${BOLD}./install.sh --configure${NC}${DIM} to change button layout.${NC}"
echo ""
