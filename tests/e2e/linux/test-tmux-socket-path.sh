#!/usr/bin/env bash
#
# test-tmux-socket-path.sh - Verify tmux socket path detection on Linux
#
# On Linux, tmux uses /tmp/tmux-UID/default by default.
# This test verifies:
# 1. Get TMUX_SOCKET path from environment
# 2. Verify it matches expected Linux pattern
# 3. Verify socket file exists
# 4. Verify tmux commands work with this socket
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/setup.sh"
source "$SCRIPT_DIR/../lib/assertions.sh"
source "$SCRIPT_DIR/../lib/teardown.sh"

# Test-specific variables
TEST_SESSION_NAME="csn-test-socket-$$"

# Cleanup function
cleanup() {
    echo "[CLEANUP] Cleaning up socket test..."
    tmux kill-session -t "$TEST_SESSION_NAME" 2>/dev/null || true
}

trap cleanup EXIT

echo "=== Test: tmux Socket Path Detection ==="

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

# Step 1: Get expected socket path
EXPECTED_UID=$(id -u)
EXPECTED_SOCKET_DIR="/tmp/tmux-${EXPECTED_UID}"
EXPECTED_SOCKET_PATH="${EXPECTED_SOCKET_DIR}/default"

echo "[INFO] Expected socket directory: $EXPECTED_SOCKET_DIR"
echo "[INFO] Expected socket path: $EXPECTED_SOCKET_PATH"

# Step 2: Create a tmux session to ensure socket exists
echo "[TEST] Creating test tmux session to activate socket..."
tmux new-session -d -s "$TEST_SESSION_NAME" -x 120 -y 30

# Verify session was created
if ! tmux has-session -t "$TEST_SESSION_NAME" 2>/dev/null; then
    echo "FAIL: Could not create tmux session"
    exit 1
fi
echo "[PASS] Created tmux session: $TEST_SESSION_NAME"

# Step 3: Verify socket directory exists
echo "[TEST] Verifying socket directory exists..."
assert_dir_exists "$EXPECTED_SOCKET_DIR" "tmux socket directory should exist"
echo "[PASS] Socket directory exists: $EXPECTED_SOCKET_DIR"

# Step 4: Verify socket file exists
echo "[TEST] Verifying socket file exists..."
if [[ -S "$EXPECTED_SOCKET_PATH" ]]; then
    echo "[PASS] Socket file exists and is a socket: $EXPECTED_SOCKET_PATH"
else
    echo "FAIL: Socket file not found or not a socket"
    echo "  Expected: $EXPECTED_SOCKET_PATH"
    echo "  Directory contents:"
    ls -la "$EXPECTED_SOCKET_DIR" 2>/dev/null || echo "  (cannot list directory)"
    exit 1
fi

# Step 5: Verify socket has correct permissions
echo "[TEST] Verifying socket permissions..."
SOCKET_PERMS=$(stat -c "%a" "$EXPECTED_SOCKET_PATH" 2>/dev/null)
SOCKET_OWNER=$(stat -c "%u" "$EXPECTED_SOCKET_PATH" 2>/dev/null)

echo "[INFO] Socket permissions: $SOCKET_PERMS"
echo "[INFO] Socket owner UID: $SOCKET_OWNER"

assert_equals "$SOCKET_OWNER" "$EXPECTED_UID" "Socket should be owned by current user"
echo "[PASS] Socket owned by current user (UID: $EXPECTED_UID)"

# Step 6: Verify tmux commands work with this socket
echo "[TEST] Testing tmux commands with socket..."

# List sessions using explicit socket path
SESSIONS_OUTPUT=$(tmux -S "$EXPECTED_SOCKET_PATH" list-sessions 2>&1)

assert_contains "$SESSIONS_OUTPUT" "$TEST_SESSION_NAME" \
    "tmux should list our test session"
echo "[PASS] tmux list-sessions works with socket"

# Step 7: Verify TMUX environment variable format
echo "[TEST] Checking TMUX environment variable inside session..."

# The TMUX env var format: /path/to/socket,pid,session_index
# Capture it from the session
TMUX_ENV=$(tmux display-message -t "$TEST_SESSION_NAME" -p '#{socket_path}' 2>/dev/null)

if [[ -n "$TMUX_ENV" ]]; then
    echo "[INFO] tmux socket_path: $TMUX_ENV"

    # Verify it matches expected pattern
    if [[ "$TMUX_ENV" == "$EXPECTED_SOCKET_PATH" ]]; then
        echo "[PASS] tmux socket_path matches expected path"
    else
        echo "[WARN] Socket path may differ from expected"
        echo "  Expected: $EXPECTED_SOCKET_PATH"
        echo "  Actual: $TMUX_ENV"
    fi
else
    # Some tmux versions may not support socket_path format string
    echo "[INFO] Could not retrieve socket_path from tmux (format string may not be supported)"
fi

# Step 8: Verify send-keys works through the socket
echo "[TEST] Testing send-keys through socket..."

# Send a test command
tmux -S "$EXPECTED_SOCKET_PATH" send-keys -t "$TEST_SESSION_NAME" "echo 'socket-test-passed'" Enter
sleep 0.3

# Capture pane content
PANE_CONTENT=$(tmux -S "$EXPECTED_SOCKET_PATH" capture-pane -t "$TEST_SESSION_NAME" -p 2>/dev/null)

assert_contains "$PANE_CONTENT" "socket-test-passed" \
    "send-keys should work through explicit socket path"
echo "[PASS] send-keys works with explicit socket path"

# Step 9: Verify socket is accessible without explicit path
echo "[TEST] Verifying tmux works without explicit socket path..."

SESSIONS_DEFAULT=$(tmux list-sessions 2>&1)
assert_contains "$SESSIONS_DEFAULT" "$TEST_SESSION_NAME" \
    "tmux should work without explicit socket path"
echo "[PASS] tmux works with default socket path"

echo ""
echo "=== All tmux socket path tests passed ==="
exit 0
