#!/usr/bin/env bash
#
# Test: Focus Stealing Prevention via Window Minimization
#
# This validates the PRESERVED BEHAVIOR for preventing focus stealing on Mac.
# When focusing an iTerm2 window, other windows are temporarily minimized to
# prevent SSH sessions or other active terminals from stealing focus back.
#
# The key logic in focus-helper's switch_iterm_session():
# 1. Find the target window by session ID
# 2. Minimize other windows (focus stealing prevention)
# 3. Focus the target window with retry loop
# 4. Restore minimized windows
#
# This test requires Mac (AppleScript) and is skipped on Linux.

set -euo pipefail

# Skip on non-Mac platforms
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Skipping Mac-only test on $(uname)"
    exit 0  # Success - skipped tests pass
fi

# Source test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/assertions.sh"

echo "=== Test: Focus Stealing Prevention (Mac Only) ==="

# Check if iTerm2 is available
if ! osascript -e 'tell application "System Events" to return exists application process "iTerm2"' 2>/dev/null | grep -q "true"; then
    echo "Skipping: iTerm2 not running"
    exit 0
fi

# Get the focus-helper path
FOCUS_HELPER="$(cd "$SCRIPT_DIR/../../.." && pwd)/bin/focus-helper"

if [[ ! -x "$FOCUS_HELPER" ]]; then
    echo "FAIL: focus-helper not found at: $FOCUS_HELPER"
    exit 1
fi

echo "Testing that focus-helper exists and has minimization logic..."

# Verify the minimization pattern exists in focus-helper
# This is a static check that the critical code hasn't been removed
MINIMIZE_PATTERN="set minimizedWindows to"
RESTORE_PATTERN="set miniaturized of w to false"

if ! grep -q "$MINIMIZE_PATTERN" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing minimization logic"
    echo "  Expected pattern: $MINIMIZE_PATTERN"
    exit 1
fi

if ! grep -q "$RESTORE_PATTERN" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing restore logic"
    echo "  Expected pattern: $RESTORE_PATTERN"
    exit 1
fi

echo "  - Found window minimization logic"
echo "  - Found window restore logic"

# Verify retry loop exists for fullscreen windows
RETRY_PATTERN="maxAttempts to 3"
FULLSCREEN_RETRY="maxAttempts to 4"

if ! grep -q "$RETRY_PATTERN" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing retry loop"
    exit 1
fi

if ! grep -q "$FULLSCREEN_RETRY" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing fullscreen retry adjustment"
    exit 1
fi

echo "  - Found retry loop (3 attempts normal, 4 for fullscreen)"

# Verify the focus verification pattern
VERIFY_PATTERN="set focusSuccess to true"

if ! grep -q "$VERIFY_PATTERN" "$FOCUS_HELPER"; then
    echo "FAIL: Focus helper missing focus verification"
    exit 1
fi

echo "  - Found focus verification logic"

echo ""
echo "=== Test: Focus Stealing Prevention - PASSED ==="
echo ""
echo "Verified focus-helper contains critical anti-focus-stealing patterns:"
echo "  1. Window minimization (minimizedWindows)"
echo "  2. Window restoration (miniaturized to false)"
echo "  3. Retry loops (3 normal, 4 fullscreen)"
echo "  4. Focus verification (focusSuccess)"
echo ""
echo "NOTE: Full runtime testing requires manual verification on Mac"
echo "      with multiple iTerm2 windows and active SSH sessions."
