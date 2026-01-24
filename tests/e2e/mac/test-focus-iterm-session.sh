#!/usr/bin/env bash
#
# Test: iTerm Session ID Lookup
#
# This validates the PRESERVED BEHAVIOR for finding iTerm2 sessions by ID.
# The focus-helper uses session ID (not TTY) for reliable window targeting.
#
# Key patterns in focus-helper:
# - switch_iterm_session "id" "$session_id"
# - Session ID from $ITERM_SESSION_ID environment variable
# - AppleScript lookup: if (id of s) is "$target"
#
# This test requires Mac and is skipped on Linux.

set -euo pipefail

# Skip on non-Mac platforms
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Skipping Mac-only test on $(uname)"
    exit 0  # Success - skipped tests pass
fi

# Source test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/assertions.sh"

echo "=== Test: iTerm Session ID Lookup (Mac Only) ==="

# Get the focus-helper path
FOCUS_HELPER="$(cd "$SCRIPT_DIR/../../.." && pwd)/bin/focus-helper"

if [[ ! -x "$FOCUS_HELPER" ]]; then
    echo "FAIL: focus-helper not found at: $FOCUS_HELPER"
    exit 1
fi

echo "Testing that focus-helper supports session ID lookup..."

# Verify the session ID lookup pattern exists
# switch_iterm_session "id" "$ARG1" is the key pattern
ID_SWITCH_PATTERN='switch_iterm_session "id"'

if ! grep -q "$ID_SWITCH_PATTERN" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing session ID switch pattern"
    echo "  Expected pattern: $ID_SWITCH_PATTERN"
    exit 1
fi

echo "  - Found session ID switch pattern"

# Verify the AppleScript session ID comparison
APPLESCRIPT_ID_PATTERN='if ($property of s) is "$target"'

if ! grep -q 'if ($property of s) is "$target"' "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing AppleScript session lookup"
    exit 1
fi

echo "  - Found AppleScript session property lookup"

# Verify iterm2 case in main switch handles session ID
ITERM2_CASE='iterm2)'

if ! grep -q "$ITERM2_CASE" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing iterm2 case handler"
    exit 1
fi

echo "  - Found iterm2 case handler"

# Verify send_iterm_input uses session ID
ITERM_INPUT_ID='send_iterm_input "id"'

if ! grep -q "$ITERM_INPUT_ID" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing iTerm input by ID"
    exit 1
fi

echo "  - Found iTerm input by session ID"

# Check for local-tmux session ID support (new format)
LOCAL_TMUX_SESSION_ID='iterm_session_id'

if ! grep -q "$LOCAL_TMUX_SESSION_ID" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing local-tmux session ID support"
    exit 1
fi

echo "  - Found local-tmux session ID support"

# Optional: Test actual iTerm session lookup if iTerm is running
if osascript -e 'tell application "System Events" to return exists application process "iTerm2"' 2>/dev/null | grep -q "true"; then
    echo ""
    echo "iTerm2 is running, testing session enumeration..."

    # Get count of sessions (basic sanity check)
    SESSION_COUNT=$(osascript -e '
tell application "iTerm2"
    set sessionCount to 0
    repeat with w in windows
        repeat with t in tabs of w
            repeat with s in sessions of t
                set sessionCount to sessionCount + 1
            end repeat
        end repeat
    end repeat
    return sessionCount
end tell
' 2>/dev/null || echo "0")

    echo "  - Found $SESSION_COUNT iTerm2 session(s)"

    if [[ "$SESSION_COUNT" -gt 0 ]]; then
        # Get first session ID
        FIRST_SESSION_ID=$(osascript -e '
tell application "iTerm2"
    repeat with w in windows
        repeat with t in tabs of w
            repeat with s in sessions of t
                return id of s
            end repeat
        end repeat
    end repeat
end tell
' 2>/dev/null || echo "")

        if [[ -n "$FIRST_SESSION_ID" ]]; then
            echo "  - Sample session ID: $FIRST_SESSION_ID"
        fi
    fi
else
    echo ""
    echo "iTerm2 not running, skipping live session test"
fi

echo ""
echo "=== Test: iTerm Session ID Lookup - PASSED ==="
echo ""
echo "Verified focus-helper contains session ID lookup patterns:"
echo "  1. switch_iterm_session 'id' call pattern"
echo "  2. AppleScript property comparison"
echo "  3. iterm2 case handler"
echo "  4. send_iterm_input by ID"
echo "  5. local-tmux session ID support"
