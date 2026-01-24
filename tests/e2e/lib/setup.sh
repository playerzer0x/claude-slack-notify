#!/usr/bin/env bash
#
# Test Setup - Creates test fixtures for E2E tests
#

# Test session name
export TEST_TMUX_SESSION="e2e-test-$$"

# Test instance directory (temporary)
export TEST_INSTANCE_DIR="${TMPDIR:-/tmp}/claude-slack-notify-test-$$"

# Test log directory
export TEST_LOG_DIR="${TMPDIR:-/tmp}/claude-slack-notify-test-logs-$$"

# Original directory for cleanup reference
export TEST_ORIGINAL_DIR="$(pwd)"

# Setup test environment
setup_test_environment() {
    echo "[SETUP] Creating test environment..."

    # Create test instance directory
    mkdir -p "$TEST_INSTANCE_DIR"
    echo "[SETUP] Created test instance directory: $TEST_INSTANCE_DIR"

    # Create test log directory
    mkdir -p "$TEST_LOG_DIR"
    echo "[SETUP] Created test log directory: $TEST_LOG_DIR"

    # Create test tmux session if tmux is available
    if command -v tmux &>/dev/null; then
        # Kill any existing test session first
        tmux kill-session -t "$TEST_TMUX_SESSION" 2>/dev/null || true

        # Create a new detached session
        tmux new-session -d -s "$TEST_TMUX_SESSION" -x 120 -y 30
        echo "[SETUP] Created tmux session: $TEST_TMUX_SESSION"

        export TEST_TMUX_AVAILABLE=true
    else
        echo "[SETUP] tmux not available, skipping session creation"
        export TEST_TMUX_AVAILABLE=false
    fi

    # Create sample instance files for testing
    create_sample_instances

    echo "[SETUP] Test environment ready"
}

# Create sample instance files
create_sample_instances() {
    # Sample local instance
    cat > "$TEST_INSTANCE_DIR/test-local-instance.json" <<EOF
{
    "id": "test-local-instance",
    "type": "local",
    "term_type": "tmux",
    "tmux_session": "$TEST_TMUX_SESSION",
    "tmux_window": "0",
    "tmux_pane": "0",
    "focus_url": "claude-focus://tmux/$TEST_TMUX_SESSION/0/0",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "last_seen": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    # Sample SSH-linked instance
    cat > "$TEST_INSTANCE_DIR/test-ssh-instance.json" <<EOF
{
    "id": "test-ssh-instance",
    "type": "ssh-linked",
    "hostname": "test-server",
    "remote_tmux_session": "remote-session",
    "remote_tmux_window": "0",
    "remote_tmux_pane": "0",
    "focus_url": "claude-focus://ssh-linked/test-server/remote-session/0/0",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "last_seen": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    # Sample jupyter-tmux instance
    cat > "$TEST_INSTANCE_DIR/test-jupyter-instance.json" <<EOF
{
    "id": "test-jupyter-instance",
    "type": "jupyter-tmux",
    "jupyter_url": "http://localhost:8888",
    "tmux_session": "jupyter",
    "focus_url": "claude-focus://jupyter-tmux/jupyter/0/0",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "last_seen": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    echo "[SETUP] Created sample instance files"
}

# Get a test instance file path
get_test_instance() {
    local name="$1"
    echo "$TEST_INSTANCE_DIR/$name.json"
}

# Create a custom test instance
create_test_instance() {
    local name="$1"
    local content="$2"
    echo "$content" > "$TEST_INSTANCE_DIR/$name.json"
}
