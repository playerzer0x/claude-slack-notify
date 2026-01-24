#!/usr/bin/env bash
#
# Test: Gastown Pattern for tmux Input
#
# This validates the CRITICAL preserved behavior for sending input to tmux.
# The gastown pattern ensures reliable text input to Claude Code running in tmux.
#
# Pattern (MUST NOT CHANGE):
# 1. tmux send-keys -t $target -l "$text"  (literal mode)
# 2. sleep 0.5  (500ms paste delay - CRITICAL for Claude Code)
# 3. tmux send-keys -t $target Escape      (for local-tmux mode)
# 4. sleep 0.1  (100ms delay)
# 5. tmux send-keys -t $target Enter
#
# This test runs on any platform with tmux available.
# Falls back to static code verification if tmux sessions cannot be created.

set -euo pipefail

# Source test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/assertions.sh"

# Get focus-helper path
FOCUS_HELPER="$(cd "$SCRIPT_DIR/../../.." && pwd)/bin/focus-helper"

echo "=== Test: Gastown Pattern for tmux Input ==="

# First, verify the gastown pattern exists in focus-helper (static check)
echo "Verifying gastown pattern exists in focus-helper..."

if [[ ! -f "$FOCUS_HELPER" ]]; then
    echo "FAIL: focus-helper not found at: $FOCUS_HELPER"
    exit 1
fi

# Check for the critical patterns in focus-helper
# Pattern 1: Literal mode send-keys
if ! grep -q 'send-keys.*-l' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing literal mode send-keys (-l flag)"
    exit 1
fi
echo "  - Found: send-keys -l (literal mode)"

# Pattern 2: Sleep 0.5 for paste delay (in local-tmux section)
if ! grep -q 'sleep 0.5' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing 500ms paste delay"
    exit 1
fi
echo "  - Found: sleep 0.5 (paste delay)"

# Pattern 3: Escape key send
if ! grep -q 'send-keys.*Escape' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing Escape key send"
    exit 1
fi
echo "  - Found: send-keys Escape"

# Pattern 4: Sleep 0.1 after Escape
if ! grep -q 'sleep 0.1' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing 100ms delay after Escape"
    exit 1
fi
echo "  - Found: sleep 0.1 (post-Escape delay)"

# Pattern 5: Enter as separate command
if ! grep -q 'send-keys.*Enter' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing Enter key send"
    exit 1
fi
echo "  - Found: send-keys Enter"

# Pattern 6: Gastown comment (ensures pattern is intentional)
if ! grep -q 'gastown' "$FOCUS_HELPER"; then
    echo "FAIL: focus-helper missing gastown pattern documentation"
    exit 1
fi
echo "  - Found: gastown pattern documentation"

echo ""
echo "Static verification passed. Now attempting runtime test..."

# Check tmux availability
if ! command -v tmux &>/dev/null; then
    echo "Skipping runtime test: tmux not available"
    echo ""
    echo "=== Test: Gastown Pattern - PASSED (static only) ==="
    exit 0
fi

# Test configuration
TEST_SESSION="gastown-test-$$"
TEST_PANE="$TEST_SESSION:0.0"
CAPTURE_FILE="${TMPDIR:-/tmp}/gastown-capture-$$.txt"

# Cleanup function - suppress all errors
cleanup() {
    {
        tmux kill-session -t "$TEST_SESSION" 2>/dev/null
        rm -f "$CAPTURE_FILE" 2>/dev/null
    } >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Kill any existing session with this name first
tmux kill-session -t "$TEST_SESSION" >/dev/null 2>&1 || true

# Create new session - may fail in restricted environments
echo "Creating test tmux session: $TEST_SESSION"
TMUX_CREATE_OUTPUT=$(tmux new-session -d -s "$TEST_SESSION" -x 80 -y 24 2>&1) || true

# Wait for session to be created
sleep 0.5

# Verify session exists before proceeding
if ! tmux has-session -t "$TEST_SESSION" 2>/dev/null; then
    echo "Skipping runtime test: Cannot create tmux session (output: $TMUX_CREATE_OUTPUT)"
    echo ""
    echo "=== Test: Gastown Pattern - PASSED (static only) ==="
    exit 0
fi

# Try to interact with the pane - if this fails, skip runtime test
if ! tmux send-keys -t "$TEST_PANE" "echo test" Enter 2>/dev/null; then
    echo "Skipping runtime test: Cannot send keys to tmux pane"
    tmux kill-session -t "$TEST_SESSION" >/dev/null 2>&1 || true
    echo ""
    echo "=== Test: Gastown Pattern - PASSED (static only) ==="
    exit 0
fi

# Clear the pane and set up capture
sleep 0.2
tmux send-keys -t "$TEST_PANE" "clear" Enter 2>/dev/null || true
sleep 0.3

# The test text we'll send
TEST_TEXT="Hello from gastown test 12345"

echo "Sending input using gastown pattern..."

# ============================================================
# THE GASTOWN PATTERN - THESE STEPS ARE CRITICAL AND PRESERVED
# ============================================================

# Step 1: Send text in literal mode (handles special characters)
tmux send-keys -t "$TEST_PANE" -l "$TEST_TEXT"

# Step 2: Wait for paste to complete (500ms - CRITICAL timing)
sleep 0.5

# Step 3: Send Escape (required for Claude Code in local-tmux mode)
tmux send-keys -t "$TEST_PANE" Escape

# Step 4: Wait for Escape to be processed
sleep 0.1

# Step 5: Send Enter as separate command (more reliable than appending)
tmux send-keys -t "$TEST_PANE" Enter

# ============================================================
# END GASTOWN PATTERN
# ============================================================

# Wait for command to execute
sleep 0.3

# Capture pane content
tmux capture-pane -t "$TEST_PANE" -p > "$CAPTURE_FILE"

echo "Captured pane content:"
cat "$CAPTURE_FILE"
echo ""

# Verify the text was received
echo "Verifying text was submitted..."

PANE_CONTENT=$(cat "$CAPTURE_FILE")
assert_contains "$PANE_CONTENT" "$TEST_TEXT" "Text should appear in tmux pane"

echo ""
echo "=== Test: Gastown Pattern - PASSED (full runtime) ==="
echo ""
echo "Verified that the gastown pattern correctly submits text to tmux:"
echo "  1. send-keys -l (literal mode)"
echo "  2. sleep 0.5 (paste delay)"
echo "  3. send-keys Escape"
echo "  4. sleep 0.1"
echo "  5. send-keys Enter"
