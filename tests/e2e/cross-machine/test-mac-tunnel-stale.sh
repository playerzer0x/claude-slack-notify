#!/usr/bin/env bash
#
# test-mac-tunnel-stale.sh - Test handling of stale .mac-tunnel-url
#
# Tests:
# 1. Backup current .mac-tunnel-url file
# 2. Write a stale/invalid URL
# 3. Trigger focus (should fail fast, not hang)
# 4. Assert HTTP response code is not 000 (timeout)
# 5. Restore backup
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/assertions.sh"

# Test configuration
MCP_PORT="${MCP_PORT:-8463}"  # Main MCP server port (has /slack/focus)
RELAY_PORT="${RELAY_PORT:-8464}"  # Remote-relay port (Slack webhooks)
MAC_TUNNEL_URL_FILE="${HOME}/.claude/.mac-tunnel-url"
BACKUP_FILE="${MAC_TUNNEL_URL_FILE}.test-backup-$$"
HTTP_TIMEOUT=10
STALE_URL="https://stale-tunnel-url-that-does-not-exist.example.com"

# Track whether we need to restore
BACKUP_CREATED=false
ORIGINAL_EXISTS=false

# Cleanup function
cleanup() {
    echo "[CLEANUP] Cleaning up stale tunnel URL test..."

    # Restore the original file if we backed it up
    if [[ "$BACKUP_CREATED" == "true" && -f "$BACKUP_FILE" ]]; then
        mv "$BACKUP_FILE" "$MAC_TUNNEL_URL_FILE"
        echo "[CLEANUP] Restored original .mac-tunnel-url"
    elif [[ "$ORIGINAL_EXISTS" == "false" && -f "$MAC_TUNNEL_URL_FILE" ]]; then
        # We created the file, remove it
        rm -f "$MAC_TUNNEL_URL_FILE"
        echo "[CLEANUP] Removed test .mac-tunnel-url"
    fi
}

trap cleanup EXIT

echo "=== Test: Stale .mac-tunnel-url Handling ==="

# Step 1: Check if MCP server is running locally
# The /slack/focus endpoint is only on the main MCP server (8463), not remote-relay
echo "[TEST] Checking if MCP server is running on port $MCP_PORT..."

if ! curl -sf "http://localhost:$MCP_PORT/health" --max-time 2 >/dev/null 2>&1; then
    # Check if remote-relay is running instead
    if curl -sf "http://localhost:$RELAY_PORT/health" --max-time 2 >/dev/null 2>&1; then
        echo "SKIP: Only remote-relay is running (port $RELAY_PORT)"
        echo "  This test requires the main MCP server (port $MCP_PORT)"
        echo "  Remote-relay doesn't have the /slack/focus endpoint"
        exit 0
    fi
    echo "SKIP: MCP server not running on port $MCP_PORT"
    echo "  To run this test, start the MCP server with:"
    echo "  local-tunnel (on Mac) or remote-tunnel (on Linux)"
    exit 0
fi
echo "[PASS] MCP server is running"

# Step 2: Ensure the .claude directory exists
CLAUDE_DIR="${HOME}/.claude"
if [[ ! -d "$CLAUDE_DIR" ]]; then
    echo "SKIP: ~/.claude directory does not exist"
    exit 0
fi

# Step 3: Backup current .mac-tunnel-url if it exists
echo "[TEST] Backing up current .mac-tunnel-url..."

if [[ -f "$MAC_TUNNEL_URL_FILE" ]]; then
    ORIGINAL_EXISTS=true
    cp "$MAC_TUNNEL_URL_FILE" "$BACKUP_FILE"
    BACKUP_CREATED=true
    echo "[INFO] Backed up existing file to: $BACKUP_FILE"
else
    echo "[INFO] No existing .mac-tunnel-url file"
fi

# Step 4: Write a stale/invalid URL
echo "[TEST] Writing stale tunnel URL..."
echo "$STALE_URL" > "$MAC_TUNNEL_URL_FILE"
echo "[INFO] Wrote stale URL: $STALE_URL"

# Step 5: Build a focus URL that would trigger Mac forwarding
TEST_FOCUS_URL="claude-focus://ssh-linked/test-host/test-session/0/0"
echo "[INFO] Focus URL: $TEST_FOCUS_URL"

# Step 6: Trigger focus and time the response
echo "[TEST] Sending focus request (should fail fast, not hang)..."

START_TIME=$(date +%s.%N)

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    --max-time "$HTTP_TIMEOUT" \
    -X POST "http://localhost:$MCP_PORT/slack/focus" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$TEST_FOCUS_URL\", \"action\": \"focus\"}" 2>/dev/null || echo -e "\n000")

END_TIME=$(date +%s.%N)

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

# Calculate elapsed time
ELAPSED=$(echo "$END_TIME - $START_TIME" | bc 2>/dev/null || echo "?")
echo "[INFO] Request completed in ${ELAPSED}s"
echo "[INFO] HTTP response code: $HTTP_CODE"
echo "[INFO] HTTP response body: $HTTP_BODY"

# Step 7: Assert HTTP response code is not 000 (timeout)
# 000 indicates curl couldn't complete the request at all
if [[ "$HTTP_CODE" == "000" ]]; then
    echo "FAIL: Request timed out (code 000)"
    echo "  The MCP server should fail fast when Mac tunnel is unreachable"
    echo "  Instead it appears to have hung"
    exit 1
fi
echo "[PASS] Got HTTP response (not a timeout): $HTTP_CODE"

# Step 8: Verify the response indicates the failure was handled
# We expect either:
# - A 200 with success:false (graceful handling)
# - A 4xx/5xx error code (server-side error handling)
# Both are acceptable - the key is not hanging

if [[ "$HTTP_CODE" == "200" ]]; then
    # Check if response indicates failure
    if echo "$HTTP_BODY" | grep -q '"success":false'; then
        echo "[PASS] Server returned success:false (graceful error handling)"
    elif echo "$HTTP_BODY" | grep -q '"success":true'; then
        echo "[WARN] Server returned success:true despite stale URL"
        echo "  This may happen if running on Mac (no forwarding needed)"
    else
        echo "[INFO] Server returned 200 with body: $HTTP_BODY"
    fi
elif [[ "$HTTP_CODE" =~ ^[45] ]]; then
    echo "[INFO] Server returned error code $HTTP_CODE (error handling)"
else
    echo "[INFO] Unexpected HTTP code: $HTTP_CODE"
fi

# Step 9: Verify response was reasonably fast (< 7 seconds)
# The internal timeout is 5 seconds, so add buffer
if command -v bc &>/dev/null && [[ "$ELAPSED" != "?" ]]; then
    ELAPSED_INT=$(echo "$ELAPSED" | cut -d. -f1)
    if [[ "$ELAPSED_INT" -lt 7 ]]; then
        echo "[PASS] Response was fast enough (${ELAPSED}s < 7s)"
    else
        echo "WARN: Response took ${ELAPSED}s (expected < 7s)"
    fi
fi

# Step 10: Verify error message mentions the issue
if echo "$HTTP_BODY" | grep -qi 'not reachable\|timeout\|refused\|failed\|mac'; then
    echo "[PASS] Error message indicates Mac tunnel issue"
else
    echo "[INFO] Error message: $HTTP_BODY"
fi

echo ""
echo "=== Stale tunnel URL test completed ==="
exit 0
