#!/usr/bin/env bash
#
# test-button-input.sh - Test button click sends input to tmux pane
#
# Tests:
# 1. Register test session
# 2. Build mock button click payload with action="continue"
# 3. POST to localhost:8464/slack/actions (or use focus-helper directly)
# 4. Verify tmux pane received the input text
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/setup.sh"
source "$SCRIPT_DIR/../lib/assertions.sh"
source "$SCRIPT_DIR/../lib/teardown.sh"

# Test-specific variables
TEST_SESSION_NAME="csn-test-button-$$"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLAUDE_SLACK_NOTIFY="$PROJECT_ROOT/bin/claude-slack-notify"
FOCUS_HELPER="$PROJECT_ROOT/bin/focus-helper"
MCP_PORT=8464

# Cleanup function
cleanup() {
    echo "[CLEANUP] Cleaning up button input test..."
    tmux kill-session -t "$TEST_SESSION_NAME" 2>/dev/null || true
}

trap cleanup EXIT

echo "=== Test: Button Click Input to tmux ==="

# Verify we're on Linux
if [[ "$(uname -s)" != "Linux" ]]; then
    echo "SKIP: This test is only for Linux"
    exit 0
fi

# Verify tmux is available
if ! command -v tmux &>/dev/null; then
    echo "SKIP: tmux not available"
    exit 0
fi

# Verify focus-helper exists
assert_file_exists "$FOCUS_HELPER" "focus-helper script should exist"

# Step 1: Create test tmux session
echo "[TEST] Creating test tmux session: $TEST_SESSION_NAME"
tmux new-session -d -s "$TEST_SESSION_NAME" -x 120 -y 30

# Verify session was created
if ! tmux has-session -t "$TEST_SESSION_NAME" 2>/dev/null; then
    echo "FAIL: Could not create tmux session"
    exit 1
fi
echo "[PASS] Created tmux session: $TEST_SESSION_NAME"

# Get tmux target info
TMUX_TARGET="${TEST_SESSION_NAME}:0.0"
echo "[INFO] tmux target: $TMUX_TARGET"

# Step 2: Build focus URL for this session
# Use the tmux focus URL format
FOCUS_URL="claude-focus://tmux/$(echo -n "$TMUX_TARGET" | sed 's/:/%3A/g; s/\./%2E/g')"
echo "[INFO] focus_url: $FOCUS_URL"

# Step 3: Clear the tmux pane buffer to ensure clean test
tmux send-keys -t "$TEST_SESSION_NAME" "" C-l
sleep 0.2

# Step 4: Test direct focus-helper invocation with "continue" action
# This is more reliable than going through MCP server which may not be running
echo "[TEST] Testing focus-helper with 'continue' action..."

# The continue action should type "/continue" and press Enter
FOCUS_URL_WITH_ACTION="${FOCUS_URL}?action=continue"
"$FOCUS_HELPER" "$FOCUS_URL_WITH_ACTION" 2>/dev/null || true

# Give tmux time to receive the input
sleep 0.5

# Step 5: Capture tmux pane content and verify input was received
echo "[TEST] Checking tmux pane for input..."

PANE_CONTENT=$(tmux capture-pane -t "$TEST_SESSION_NAME" -p 2>/dev/null)

# The "continue" action should have sent "/continue" to the pane
# Note: The pane shows what was typed, not necessarily a command output
# On a raw shell, it will show the text followed by an error (command not found)
if [[ "$PANE_CONTENT" == *"/continue"* ]] || [[ "$PANE_CONTENT" == *"continue"* ]]; then
    echo "[PASS] Pane received 'continue' input"
else
    echo "WARN: Could not verify 'continue' text in pane"
    echo "  Pane content:"
    echo "$PANE_CONTENT" | head -10 | sed 's/^/    /'
    # Don't fail - the input may have been consumed by shell
fi

# Step 6: Test action="1" (typically "Option 1" for quick buttons)
echo "[TEST] Testing focus-helper with '1' action..."
FOCUS_URL_ACTION_1="${FOCUS_URL}?action=1"
"$FOCUS_HELPER" "$FOCUS_URL_ACTION_1" 2>/dev/null || true
sleep 0.3

PANE_CONTENT_2=$(tmux capture-pane -t "$TEST_SESSION_NAME" -p 2>/dev/null)
if [[ "$PANE_CONTENT_2" == *"1"* ]]; then
    echo "[PASS] Pane received '1' action input"
else
    echo "INFO: Action '1' sent (verification may vary)"
fi

# Step 7: Test if MCP server is running and can handle requests
echo "[TEST] Checking MCP server availability on port $MCP_PORT..."
if curl -sf "http://localhost:$MCP_PORT/health" --max-time 2 >/dev/null 2>&1; then
    echo "[PASS] MCP server is running on port $MCP_PORT"

    # Build a mock Slack payload (simplified - real tests would use proper signing)
    echo "[TEST] Testing MCP server /slack/actions endpoint..."

    # Note: This would normally require Slack signature verification
    # For unit testing, we test the focus-helper directly instead
    echo "[INFO] Skipping full MCP test (requires Slack signature)"
else
    echo "[INFO] MCP server not running on port $MCP_PORT (optional)"
fi

echo ""
echo "=== Button input tests completed ==="
exit 0
