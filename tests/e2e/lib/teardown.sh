#!/usr/bin/env bash
#
# Test Teardown - Cleans up test fixtures after E2E tests
#

# Teardown test environment
teardown_test_environment() {
    echo ""
    echo "[TEARDOWN] Cleaning up test environment..."

    # Kill test tmux session if it exists
    if [[ "${TEST_TMUX_AVAILABLE:-false}" == "true" ]]; then
        if tmux has-session -t "$TEST_TMUX_SESSION" 2>/dev/null; then
            tmux kill-session -t "$TEST_TMUX_SESSION" 2>/dev/null || true
            echo "[TEARDOWN] Killed tmux session: $TEST_TMUX_SESSION"
        fi
    fi

    # Remove test instance directory
    if [[ -n "${TEST_INSTANCE_DIR:-}" ]] && [[ -d "$TEST_INSTANCE_DIR" ]]; then
        rm -rf "$TEST_INSTANCE_DIR"
        echo "[TEARDOWN] Removed test instance directory: $TEST_INSTANCE_DIR"
    fi

    # Remove test log directory
    if [[ -n "${TEST_LOG_DIR:-}" ]] && [[ -d "$TEST_LOG_DIR" ]]; then
        rm -rf "$TEST_LOG_DIR"
        echo "[TEARDOWN] Removed test log directory: $TEST_LOG_DIR"
    fi

    # Kill any test mock servers
    kill_mock_servers

    echo "[TEARDOWN] Cleanup complete"
}

# Kill any running mock servers from tests
kill_mock_servers() {
    # Kill mock Slack server if running
    if [[ -n "${MOCK_SLACK_PID:-}" ]] && kill -0 "$MOCK_SLACK_PID" 2>/dev/null; then
        kill "$MOCK_SLACK_PID" 2>/dev/null || true
        echo "[TEARDOWN] Killed mock Slack server (PID: $MOCK_SLACK_PID)"
    fi

    # Kill mock MCP server if running
    if [[ -n "${MOCK_MCP_PID:-}" ]] && kill -0 "$MOCK_MCP_PID" 2>/dev/null; then
        kill "$MOCK_MCP_PID" 2>/dev/null || true
        echo "[TEARDOWN] Killed mock MCP server (PID: $MOCK_MCP_PID)"
    fi

    # Kill any processes listening on test ports (9999 for mock Slack)
    if command -v lsof &>/dev/null; then
        local pid
        pid=$(lsof -ti:9999 2>/dev/null || true)
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
            echo "[TEARDOWN] Killed process on port 9999"
        fi
    fi
}

# Cleanup a specific test's artifacts
cleanup_test_artifacts() {
    local test_name="$1"
    local artifact_dir="$TEST_LOG_DIR/$test_name"

    if [[ -d "$artifact_dir" ]]; then
        rm -rf "$artifact_dir"
    fi
}

# Force cleanup - more aggressive cleanup for stuck resources
force_cleanup() {
    echo "[TEARDOWN] Forcing cleanup of all test resources..."

    # Kill all tmux sessions that match our test pattern
    tmux list-sessions 2>/dev/null | grep "^e2e-test-" | cut -d: -f1 | while read -r session; do
        tmux kill-session -t "$session" 2>/dev/null || true
        echo "[TEARDOWN] Killed stale tmux session: $session"
    done

    # Remove all test temp directories
    rm -rf "${TMPDIR:-/tmp}"/claude-slack-notify-test-* 2>/dev/null || true

    echo "[TEARDOWN] Force cleanup complete"
}
