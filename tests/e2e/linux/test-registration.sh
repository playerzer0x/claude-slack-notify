#!/usr/bin/env bash
#
# test-registration.sh - Test session registration flow on Linux
#
# Tests:
# 1. Create test tmux session
# 2. Run `claude-slack-notify register` with TMUX environment set
# 3. Verify instance file created in ~/.claude/instances/
# 4. Check file contains focus_url and term_target
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/setup.sh"
source "$SCRIPT_DIR/../lib/assertions.sh"
source "$SCRIPT_DIR/../lib/teardown.sh"

# Test-specific variables
TEST_SESSION_NAME="csn-test-registration-$$"
INSTANCES_DIR="${HOME}/.claude/instances"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLAUDE_SLACK_NOTIFY="$PROJECT_ROOT/bin/claude-slack-notify"

# Track the instance file we create
CREATED_INSTANCE_FILE=""
TEST_INSTANCE_ID=""

# Cleanup function
cleanup() {
    echo "[CLEANUP] Cleaning up registration test..."

    # Kill test tmux session
    tmux kill-session -t "$TEST_SESSION_NAME" 2>/dev/null || true

    # Remove the instance file we created
    if [[ -n "$CREATED_INSTANCE_FILE" && -f "$CREATED_INSTANCE_FILE" ]]; then
        rm -f "$CREATED_INSTANCE_FILE" 2>/dev/null || true
    fi

    # Also try to clean up by instance ID if we know it
    if [[ -n "$TEST_INSTANCE_ID" ]]; then
        rm -f "$INSTANCES_DIR/${TEST_INSTANCE_ID}.json" 2>/dev/null || true
    fi
}

# Set trap for cleanup
trap cleanup EXIT

echo "=== Test: Session Registration on Linux ==="

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

# Verify claude-slack-notify script exists
assert_file_exists "$CLAUDE_SLACK_NOTIFY" "claude-slack-notify script should exist"

# Step 1: Create test tmux session
echo "[TEST] Creating test tmux session: $TEST_SESSION_NAME"
tmux new-session -d -s "$TEST_SESSION_NAME" -x 120 -y 30

# Verify session was created
if ! tmux has-session -t "$TEST_SESSION_NAME" 2>/dev/null; then
    echo "FAIL: Could not create tmux session"
    exit 1
fi
echo "[PASS] Created tmux session: $TEST_SESSION_NAME"

# Step 2: Get the tmux environment variables for this session
# We need to set these so claude-slack-notify can detect tmux properly
echo "[TEST] Getting tmux environment from session..."

TMUX_SOCKET=$(tmux display-message -t "$TEST_SESSION_NAME" -p '#{socket_path}')
TMUX_PID=$(tmux display-message -t "$TEST_SESSION_NAME" -p '#{pid}')

# Construct TMUX env var format: /path/to/socket,pid,session_index
# We use ${SESSION_NAME}:0 as target since we just created window 0
TMUX_ENV="${TMUX_SOCKET},${TMUX_PID},0"
echo "[INFO] TMUX env: $TMUX_ENV"

# Step 3: Run register command with proper TMUX environment
echo "[TEST] Running register command with TMUX environment..."

# Set TMUX environment variable so the script can detect tmux
# Also generate a unique instance ID for the session file
CUSTOM_NAME="test-registration-$$"
TEST_INSTANCE_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-$$-$(date +%s)")
export TMUX="$TMUX_ENV"
export CLAUDE_INSTANCE_ID="$TEST_INSTANCE_ID"

echo "[INFO] CLAUDE_INSTANCE_ID: $TEST_INSTANCE_ID"

# Capture the number of instance files before
INSTANCE_COUNT_BEFORE=$(ls "$INSTANCES_DIR"/*.json 2>/dev/null | wc -l || echo "0")

# Run register
INSTANCE_NAME=$("$CLAUDE_SLACK_NOTIFY" register "$CUSTOM_NAME" 2>/dev/null)

if [[ -z "$INSTANCE_NAME" ]]; then
    echo "FAIL: Register command did not return instance name"
    exit 1
fi
echo "[PASS] Register returned instance name: $INSTANCE_NAME"

# Step 4: Verify instance file was created
echo "[TEST] Checking for instance file..."

# Wait a moment for file to be written
sleep 0.2

# Look for file containing our instance name
INSTANCE_FILE=""
for f in "$INSTANCES_DIR"/*.json; do
    [[ -f "$f" ]] || continue
    if grep -q "\"name\": \"$INSTANCE_NAME\"" "$f" 2>/dev/null; then
        INSTANCE_FILE="$f"
        break
    fi
done

if [[ -z "$INSTANCE_FILE" || ! -f "$INSTANCE_FILE" ]]; then
    echo "FAIL: Instance file not found for $INSTANCE_NAME"
    echo "  Looking for name: $INSTANCE_NAME"
    # Check count
    INSTANCE_COUNT_AFTER=$(ls "$INSTANCES_DIR"/*.json 2>/dev/null | wc -l || echo "0")
    echo "  Files before: $INSTANCE_COUNT_BEFORE, after: $INSTANCE_COUNT_AFTER"
    echo "  Directory contents:"
    ls -la "$INSTANCES_DIR" 2>/dev/null || echo "  (directory does not exist)"
    exit 1
fi

CREATED_INSTANCE_FILE="$INSTANCE_FILE"
echo "[PASS] Instance file created: $INSTANCE_FILE"

# Step 5: Verify instance file contents
echo "[TEST] Verifying instance file contents..."

INSTANCE_CONTENT=$(cat "$INSTANCE_FILE")
echo "[DEBUG] Instance content:"
echo "$INSTANCE_CONTENT" | head -10

# Check for focus_url field
FOCUS_URL=$(echo "$INSTANCE_CONTENT" | grep -o '"focus_url": *"[^"]*"' | cut -d'"' -f4)
assert_not_empty "$FOCUS_URL" "Instance should have focus_url"
echo "[PASS] focus_url present: $FOCUS_URL"

# Check for term_target field
TERM_TARGET=$(echo "$INSTANCE_CONTENT" | grep -o '"term_target": *"[^"]*"' | cut -d'"' -f4)
assert_not_empty "$TERM_TARGET" "Instance should have term_target"
echo "[PASS] term_target present: $TERM_TARGET"

# Check for term_type field
TERM_TYPE=$(echo "$INSTANCE_CONTENT" | grep -o '"term_type": *"[^"]*"' | cut -d'"' -f4)
assert_not_empty "$TERM_TYPE" "Instance should have term_type"
echo "[PASS] term_type: $TERM_TYPE"

# Verify term_type is one of the expected types
# Note: On a remote server accessed via SSH, it may detect ssh-linked or ssh-tmux
case "$TERM_TYPE" in
    tmux|linux-tmux|gnome-terminal|konsole|vscode|ssh-linked|ssh-tmux|jupyter-tmux)
        echo "[PASS] Valid term_type: $TERM_TYPE"
        ;;
    *)
        echo "WARN: Unexpected term_type: $TERM_TYPE"
        ;;
esac

# Verify focus_url has correct protocol
assert_contains "$FOCUS_URL" "claude-focus://" "focus_url should use claude-focus:// protocol"
echo "[PASS] focus_url has correct protocol"

# Verify term_target is not empty (specific content depends on session type)
# For ssh-linked: contains link_id|host|user|port|tmux_target
# For pure tmux: contains session:window.pane
assert_not_empty "$TERM_TARGET" "term_target should not be empty"
echo "[PASS] term_target is set: $TERM_TARGET"

echo ""
echo "=== All registration tests passed ==="
exit 0
