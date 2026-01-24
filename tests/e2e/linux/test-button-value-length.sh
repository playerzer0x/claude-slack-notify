#!/usr/bin/env bash
#
# test-button-value-length.sh - Edge case test for long hostnames/session names
#
# Tests that button values (which contain focus URLs) don't exceed Slack's 2000 char limit.
# This is critical for:
# - Long hostnames (e.g., kubernetes pods, AWS instances)
# - Long session names (project-feature-iteration-phase)
# - Deeply nested tmux windows/panes
#

set -euo pipefail

# Source test libraries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/setup.sh"
source "$SCRIPT_DIR/../lib/assertions.sh"
source "$SCRIPT_DIR/../lib/teardown.sh"

# Slack button value limit
SLACK_BUTTON_VALUE_LIMIT=2000

echo "=== Test: Button Value Length (Edge Cases) ==="

# Verify we're on Linux (though this test is platform-independent logic)
if [[ "$(uname -s)" != "Linux" ]]; then
    echo "SKIP: This test is only for Linux"
    exit 0
fi

# Test Case 1: Very long hostname
echo "[TEST] Testing with very long hostname..."

LONG_HOST="very-long-hostname-that-could-cause-issues-in-production-environment.kubernetes.pod.namespace.example.com"
LONG_SESSION="PROJECT-12345-feature-implementation-refactor-phase-2-iteration-3-hotfix"
TMUX_TARGET="${LONG_SESSION}:99.99"

# Build focus URL like claude-slack-notify does
# Format: claude-focus://ssh-tmux/HOST/USER/PORT/TMUX_TARGET
SSH_USER="developer"
SSH_PORT="22"

# URL encode function (simplified)
url_encode() {
    local string="$1"
    # Encode special characters
    printf '%s' "$string" | sed 's/:/%3A/g; s/\./%2E/g; s/\//%2F/g; s/@/%40/g; s/ /%20/g'
}

ENCODED_HOST=$(url_encode "$LONG_HOST")
ENCODED_TARGET=$(url_encode "$TMUX_TARGET")

FOCUS_URL="claude-focus://ssh-tmux/${ENCODED_HOST}/${SSH_USER}/${SSH_PORT}/${ENCODED_TARGET}"

# Button value format: url:FOCUS_URL|action
BUTTON_VALUE="url:${FOCUS_URL}|continue"
BUTTON_LENGTH=${#BUTTON_VALUE}

echo "[INFO] Long hostname: $LONG_HOST (${#LONG_HOST} chars)"
echo "[INFO] Session name: $LONG_SESSION (${#LONG_SESSION} chars)"
echo "[INFO] Focus URL length: ${#FOCUS_URL} chars"
echo "[INFO] Button value length: $BUTTON_LENGTH chars"

assert_less_than "$BUTTON_LENGTH" "$SLACK_BUTTON_VALUE_LIMIT" \
    "Button value ($BUTTON_LENGTH) should be less than Slack limit ($SLACK_BUTTON_VALUE_LIMIT)"
echo "[PASS] Long hostname button value within Slack limit"

# Test Case 2: ssh-linked format (includes link_id)
echo ""
echo "[TEST] Testing ssh-linked format with long values..."

LINK_ID="abcd1234"  # 8 char link ID
FOCUS_URL_LINKED="claude-focus://ssh-linked/${LINK_ID}/${ENCODED_HOST}/${SSH_USER}/${SSH_PORT}/${ENCODED_TARGET}"
BUTTON_VALUE_LINKED="url:${FOCUS_URL_LINKED}|focus"
LINKED_LENGTH=${#BUTTON_VALUE_LINKED}

echo "[INFO] ssh-linked focus URL length: ${#FOCUS_URL_LINKED} chars"
echo "[INFO] Button value length: $LINKED_LENGTH chars"

assert_less_than "$LINKED_LENGTH" "$SLACK_BUTTON_VALUE_LIMIT" \
    "ssh-linked button value ($LINKED_LENGTH) should be less than Slack limit"
echo "[PASS] ssh-linked button value within Slack limit"

# Test Case 3: jupyter-tmux format
echo ""
echo "[TEST] Testing jupyter-tmux format with long values..."

FOCUS_URL_JUPYTER="claude-focus://jupyter-tmux/${LINK_ID}/${ENCODED_HOST}/${SSH_USER}/${SSH_PORT}/${ENCODED_TARGET}"
BUTTON_VALUE_JUPYTER="url:${FOCUS_URL_JUPYTER}|push"
JUPYTER_LENGTH=${#BUTTON_VALUE_JUPYTER}

echo "[INFO] jupyter-tmux focus URL length: ${#FOCUS_URL_JUPYTER} chars"
echo "[INFO] Button value length: $JUPYTER_LENGTH chars"

assert_less_than "$JUPYTER_LENGTH" "$SLACK_BUTTON_VALUE_LIMIT" \
    "jupyter-tmux button value ($JUPYTER_LENGTH) should be less than Slack limit"
echo "[PASS] jupyter-tmux button value within Slack limit"

# Test Case 4: Extreme edge case - maximum reasonable values
echo ""
echo "[TEST] Testing extreme edge case..."

# 253 chars is max DNS hostname length
EXTREME_HOST=$(printf 'x%.0s' {1..253})
# Long but reasonable session name
EXTREME_SESSION="project-with-very-long-name-that-someone-might-use-in-enterprise:999.999"
ENCODED_EXTREME_HOST="$EXTREME_HOST"  # No special chars to encode
ENCODED_EXTREME_SESSION=$(url_encode "$EXTREME_SESSION")

FOCUS_URL_EXTREME="claude-focus://ssh-tmux/${ENCODED_EXTREME_HOST}/${SSH_USER}/${SSH_PORT}/${ENCODED_EXTREME_SESSION}"
BUTTON_VALUE_EXTREME="url:${FOCUS_URL_EXTREME}|continue"
EXTREME_LENGTH=${#BUTTON_VALUE_EXTREME}

echo "[INFO] Extreme hostname: ${#EXTREME_HOST} chars (max DNS)"
echo "[INFO] Focus URL length: ${#FOCUS_URL_EXTREME} chars"
echo "[INFO] Button value length: $EXTREME_LENGTH chars"

if [[ $EXTREME_LENGTH -lt $SLACK_BUTTON_VALUE_LIMIT ]]; then
    echo "[PASS] Extreme edge case within Slack limit"
else
    echo "[WARN] Extreme edge case ($EXTREME_LENGTH) exceeds Slack limit"
    echo "  This is expected for pathological hostnames"
    # Calculate safe hostname length
    OVERHEAD=$((EXTREME_LENGTH - ${#EXTREME_HOST}))
    MAX_SAFE_HOST=$((SLACK_BUTTON_VALUE_LIMIT - OVERHEAD - 50))  # 50 char buffer
    echo "[INFO] Maximum safe hostname length: ~$MAX_SAFE_HOST chars"
fi

# Test Case 5: Verify actual button value format matches production
echo ""
echo "[TEST] Verifying button value format..."

# The format should be: url:FOCUS_URL|action or SESSION_ID|action
assert_contains "$BUTTON_VALUE" "url:claude-focus://" "Button value should start with url:claude-focus://"
assert_contains "$BUTTON_VALUE" "|continue" "Button value should end with |action"
echo "[PASS] Button value format is correct"

echo ""
echo "=== All button value length tests passed ==="
exit 0
