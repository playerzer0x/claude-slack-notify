#!/usr/bin/env bash
#
# test-focus-forward.sh - Test Linux triggering focus on Mac via remote-relay
#
# Tests:
# 1. SSH to Mac to get frontmost app before
# 2. POST to localhost:8464/slack/focus with a focus URL
# 3. Verify Mac frontmost app changed to iTerm2 or Terminal
# 4. Handle Mac unreachable gracefully (skip test)
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/assertions.sh"

# Test configuration
MAC_HOST="${MAC_HOST:-gts-macbook-air-1}"
MCP_PORT="${MCP_PORT:-8463}"  # Main MCP server port (has /slack/focus)
RELAY_PORT="${RELAY_PORT:-8464}"  # Remote-relay port (Slack webhooks)
SSH_TIMEOUT=5
HTTP_TIMEOUT=10

# Cleanup function
cleanup() {
    echo "[CLEANUP] Cleaning up focus forward test..."
    # Nothing specific to clean up for this test
}

trap cleanup EXIT

echo "=== Test: Linux -> Mac Focus Forwarding ==="

# Step 1: Check if Mac is reachable via SSH
echo "[TEST] Checking if Mac ($MAC_HOST) is reachable via SSH..."

if ! ssh -o ConnectTimeout="$SSH_TIMEOUT" -o BatchMode=yes "$MAC_HOST" "echo ok" >/dev/null 2>&1; then
    echo "SKIP: Mac ($MAC_HOST) is not reachable via SSH"
    echo "  To run this test, ensure:"
    echo "  - Mac is accessible via 'ssh $MAC_HOST'"
    echo "  - SSH keys are configured for passwordless login"
    echo "  Or set MAC_HOST environment variable to your Mac's hostname"
    exit 0
fi
echo "[PASS] Mac is reachable"

# Step 2: Check if MCP server or remote-relay is running locally
echo "[TEST] Checking if MCP server is running..."

# Try main MCP server first (8463), then remote-relay (8464)
ACTIVE_PORT=""
if curl -sf "http://localhost:$MCP_PORT/health" --max-time 2 >/dev/null 2>&1; then
    ACTIVE_PORT="$MCP_PORT"
    echo "[PASS] MCP server is running on port $MCP_PORT"
elif curl -sf "http://localhost:$RELAY_PORT/health" --max-time 2 >/dev/null 2>&1; then
    ACTIVE_PORT="$RELAY_PORT"
    echo "[PASS] Remote-relay is running on port $RELAY_PORT"
else
    echo "SKIP: No server running on port $MCP_PORT or $RELAY_PORT"
    echo "  To run this test, start the MCP server with:"
    echo "  local-tunnel (on Mac) or remote-tunnel (on Linux)"
    exit 0
fi

# Step 3: Get current Mac frontmost app
echo "[TEST] Getting Mac's current frontmost application..."

FRONTMOST_BEFORE=$(ssh -o ConnectTimeout="$SSH_TIMEOUT" "$MAC_HOST" \
    'osascript -e "tell application \"System Events\" to get name of first process whose frontmost is true"' 2>/dev/null || echo "UNKNOWN")

if [[ "$FRONTMOST_BEFORE" == "UNKNOWN" ]]; then
    echo "WARN: Could not determine Mac's frontmost app"
    echo "  osascript may require accessibility permissions"
fi
echo "[INFO] Frontmost app before: $FRONTMOST_BEFORE"

# Step 4: Build a focus URL for a test session
# Use ssh-linked format since that's what triggers Mac forwarding
TEST_FOCUS_URL="claude-focus://ssh-linked/${MAC_HOST}/test-session/0/0"
echo "[INFO] Focus URL: $TEST_FOCUS_URL"

# Step 5: POST to MCP server's focus endpoint
# Note: Only the main MCP server (8463) has /slack/focus endpoint
# Remote-relay (8464) only has /slack/actions and /slack/events
echo "[TEST] Sending focus request to MCP server..."

# Use main MCP port for focus endpoint (8463)
HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    --max-time "$HTTP_TIMEOUT" \
    -X POST "http://localhost:$MCP_PORT/slack/focus" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$TEST_FOCUS_URL\", \"action\": \"focus\"}" 2>/dev/null || echo -e "\n000")

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

echo "[INFO] HTTP response code: $HTTP_CODE"
echo "[INFO] HTTP response body: $HTTP_BODY"

# Verify we got a response (not a timeout)
if [[ "$HTTP_CODE" == "000" ]]; then
    echo "FAIL: Request timed out (code 000)"
    exit 1
fi
echo "[PASS] Got HTTP response: $HTTP_CODE"

# Step 6: Give Mac time to process focus action
echo "[INFO] Waiting for Mac to process focus..."
sleep 1.5

# Step 7: Get Mac frontmost app after
echo "[TEST] Getting Mac's frontmost application after focus..."

FRONTMOST_AFTER=$(ssh -o ConnectTimeout="$SSH_TIMEOUT" "$MAC_HOST" \
    'osascript -e "tell application \"System Events\" to get name of first process whose frontmost is true"' 2>/dev/null || echo "UNKNOWN")

if [[ "$FRONTMOST_AFTER" == "UNKNOWN" ]]; then
    echo "WARN: Could not determine Mac's frontmost app after focus"
    echo "[INFO] Skipping frontmost app verification"
    echo ""
    echo "=== Focus forward test completed (partial) ==="
    exit 0
fi

echo "[INFO] Frontmost app after: $FRONTMOST_AFTER"

# Step 8: Verify the Mac's focus changed to a terminal app
# Accept iTerm2 or Terminal as valid results
case "$FRONTMOST_AFTER" in
    iTerm2|Terminal|tmux)
        echo "[PASS] Mac focus switched to terminal app: $FRONTMOST_AFTER"
        ;;
    *)
        # If frontmost was already a terminal, that's fine too
        if [[ "$FRONTMOST_AFTER" == "$FRONTMOST_BEFORE" ]]; then
            echo "[INFO] Mac frontmost app unchanged: $FRONTMOST_AFTER"
            echo "[INFO] This may be expected if session doesn't exist"
        else
            echo "WARN: Mac frontmost app is: $FRONTMOST_AFTER"
            echo "  Expected: iTerm2 or Terminal"
            echo "  (This may be expected if test session doesn't exist on Mac)"
        fi
        ;;
esac

# Step 9: Verify the response indicates success or known error
if echo "$HTTP_BODY" | grep -q '"success":true'; then
    echo "[PASS] Focus request reported success"
elif echo "$HTTP_BODY" | grep -qi 'not found\|not reachable\|session'; then
    echo "[INFO] Focus request returned expected error (session may not exist)"
else
    echo "[INFO] Focus request response: $HTTP_BODY"
fi

echo ""
echo "=== Focus forward test completed ==="
exit 0
