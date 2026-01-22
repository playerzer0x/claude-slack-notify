#!/bin/bash
# Integration tests for focus button scenarios
# Run on Mac with local-tunnel running, or on remote for linked session tests

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
TEST_RESULTS=()

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_test() { echo -e "${YELLOW}[TEST]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; TEST_RESULTS+=("PASS: $1"); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; TEST_RESULTS+=("FAIL: $1"); }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; TEST_RESULTS+=("SKIP: $1"); }

# Test Case 1: Local Terminal.app (requires macOS)
test_local_terminal() {
    log_test "Case 1: Local Terminal.app"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_skip "Not running on macOS"
        return
    fi

    if [[ "$TERM_PROGRAM" != "Apple_Terminal" ]]; then
        log_skip "Not running in Terminal.app (TERM_PROGRAM=$TERM_PROGRAM)"
        return
    fi

    if [[ -n "$TMUX" ]]; then
        log_skip "Running in tmux (use test 2 instead)"
        return
    fi

    # Create a test session ID
    SESSION_ID="test-terminal-$$"

    # Register session
    CLAUDE_INSTANCE_ID="$SESSION_ID" "$SCRIPT_DIR/claude-slack-notify" register "test-terminal"

    # Check session file
    if [[ -f "$CLAUDE_DIR/instances/${SESSION_ID}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
        if [[ "$term_type" == "terminal" ]]; then
            log_pass "Session registered as terminal type"
        else
            log_fail "Expected term_type=terminal, got $term_type"
        fi
        # Cleanup
        rm -f "$CLAUDE_DIR/instances/${SESSION_ID}.json"
    else
        log_fail "Session file not created"
    fi
}

# Test Case 2: Local Terminal.app + tmux
test_local_terminal_tmux() {
    log_test "Case 2: Local Terminal.app + tmux"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_skip "Not running on macOS"
        return
    fi

    if [[ -z "$TMUX" ]]; then
        log_skip "Not running in tmux"
        return
    fi

    SESSION_ID="test-terminal-tmux-$$"
    CLAUDE_INSTANCE_ID="$SESSION_ID" "$SCRIPT_DIR/claude-slack-notify" register "test-terminal-tmux"

    if [[ -f "$CLAUDE_DIR/instances/${SESSION_ID}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
        if [[ "$term_type" == "terminal-tmux" || "$term_type" == "iterm-tmux" ]]; then
            log_pass "Session registered as $term_type type"
        else
            log_fail "Expected term_type=terminal-tmux or iterm-tmux, got $term_type"
        fi
        rm -f "$CLAUDE_DIR/instances/${SESSION_ID}.json"
    else
        log_fail "Session file not created"
    fi
}

# Test Case 3: Local iTerm2
test_local_iterm() {
    log_test "Case 3: Local iTerm2"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_skip "Not running on macOS"
        return
    fi

    if [[ -z "$ITERM_SESSION_ID" ]]; then
        log_skip "Not running in iTerm2"
        return
    fi

    if [[ -n "$TMUX" ]]; then
        log_skip "Running in tmux (use test 4 instead)"
        return
    fi

    SESSION_ID="test-iterm-$$"
    CLAUDE_INSTANCE_ID="$SESSION_ID" "$SCRIPT_DIR/claude-slack-notify" register "test-iterm"

    if [[ -f "$CLAUDE_DIR/instances/${SESSION_ID}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
        if [[ "$term_type" == "iterm2" ]]; then
            log_pass "Session registered as iterm2 type"
        else
            log_fail "Expected term_type=iterm2, got $term_type"
        fi
        rm -f "$CLAUDE_DIR/instances/${SESSION_ID}.json"
    else
        log_fail "Session file not created"
    fi
}

# Test Case 4: Local iTerm2 + tmux
test_local_iterm_tmux() {
    log_test "Case 4: Local iTerm2 + tmux"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_skip "Not running on macOS"
        return
    fi

    if [[ -z "$ITERM_SESSION_ID" ]] || [[ -z "$TMUX" ]]; then
        log_skip "Not running in iTerm2 + tmux"
        return
    fi

    SESSION_ID="test-iterm-tmux-$$"
    CLAUDE_INSTANCE_ID="$SESSION_ID" "$SCRIPT_DIR/claude-slack-notify" register "test-iterm-tmux"

    if [[ -f "$CLAUDE_DIR/instances/${SESSION_ID}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
        if [[ "$term_type" == "iterm-tmux" ]]; then
            log_pass "Session registered as iterm-tmux type"
        else
            log_fail "Expected term_type=iterm-tmux, got $term_type"
        fi
        rm -f "$CLAUDE_DIR/instances/${SESSION_ID}.json"
    else
        log_fail "Session file not created"
    fi
}

# Test Case 5: Link creates correct tmux environment
test_link_tmux_env() {
    log_test "Case 5: Link command sets tmux environment"

    # This test must be run INSIDE a linked tmux session on the remote
    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    if [[ -z "$SSH_CONNECTION" ]]; then
        log_skip "Not in SSH session (run this on remote)"
        return
    fi

    # Check tmux session environment
    link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2-)
    ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2-)

    # Handle tmux's "-VAR" format for unset variables
    [[ "$link_id" == "-CLAUDE_LINK_ID" ]] && link_id=""
    [[ "$ssh_host" == "-CLAUDE_SSH_HOST" ]] && ssh_host=""

    if [[ -n "$link_id" && -n "$ssh_host" ]]; then
        log_pass "Tmux environment has CLAUDE_LINK_ID=$link_id and CLAUDE_SSH_HOST=$ssh_host"
    else
        log_fail "Missing tmux environment variables (LINK_ID='$link_id', SSH_HOST='$ssh_host')"
    fi
}

# Test Case 6: SSH-linked session registration
test_ssh_linked_registration() {
    log_test "Case 6: SSH-linked session registration"

    if [[ -z "$SSH_CONNECTION" ]]; then
        log_skip "Not in SSH session"
        return
    fi

    # Get link variables from tmux environment if not in shell
    local link_id="$CLAUDE_LINK_ID"
    local ssh_host="$CLAUDE_SSH_HOST"

    if [[ -z "$link_id" && -n "$TMUX" ]]; then
        link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2-)
        [[ "$link_id" == "-CLAUDE_LINK_ID" ]] && link_id=""
    fi
    if [[ -z "$ssh_host" && -n "$TMUX" ]]; then
        ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2-)
        [[ "$ssh_host" == "-CLAUDE_SSH_HOST" ]] && ssh_host=""
    fi

    if [[ -z "$link_id" ]]; then
        log_fail "CLAUDE_LINK_ID not set (not a linked session). Run 'claude-slack-notify remote' from Mac first."
        return
    fi

    SESSION_ID="test-ssh-linked-$$"

    # Temporarily export for the registration
    export CLAUDE_LINK_ID="$link_id"
    export CLAUDE_SSH_HOST="$ssh_host"

    CLAUDE_INSTANCE_ID="$SESSION_ID" "$SCRIPT_DIR/claude-slack-notify" register "test-ssh-linked"

    if [[ -f "$CLAUDE_DIR/instances/${SESSION_ID}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
        if [[ "$term_type" == "ssh-linked" ]]; then
            log_pass "Session registered as ssh-linked type"

            # Also verify FOCUS_URL uses correct hostname
            focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${SESSION_ID}.json" | cut -d'"' -f4)
            if [[ "$focus_url" == *"$ssh_host"* ]]; then
                log_pass "Focus URL uses SSH alias hostname ($ssh_host)"
            else
                log_fail "Focus URL does not contain SSH host alias. focus_url=$focus_url expected_host=$ssh_host"
            fi
        else
            log_fail "Expected term_type=ssh-linked, got $term_type"
        fi
        rm -f "$CLAUDE_DIR/instances/${SESSION_ID}.json"
    else
        log_fail "Session file not created"
    fi
}

# Test Case 7: Link file exists on Mac
test_link_file_exists() {
    log_test "Case 7: Link file exists on Mac"

    if [[ "$(uname)" != "Darwin" ]]; then
        log_skip "Not running on macOS"
        return
    fi

    local link_id="$CLAUDE_LINK_ID"
    if [[ -z "$link_id" && -n "$TMUX" ]]; then
        link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2-)
        [[ "$link_id" == "-CLAUDE_LINK_ID" ]] && link_id=""
    fi

    if [[ -z "$link_id" ]]; then
        # Check if any link files exist
        if [[ -d "$CLAUDE_DIR/links" ]]; then
            local count
            count=$(find "$CLAUDE_DIR/links" -name "*.json" 2>/dev/null | wc -l)
            if [[ "$count" -gt 0 ]]; then
                log_pass "Found $count link file(s) in $CLAUDE_DIR/links"
                # Show details of most recent
                local latest
                latest=$(ls -t "$CLAUDE_DIR/links"/*.json 2>/dev/null | head -1)
                if [[ -n "$latest" ]]; then
                    local term_type term_target
                    term_type=$(grep -o '"term_type": *"[^"]*"' "$latest" | cut -d'"' -f4)
                    term_target=$(grep -o '"term_target": *"[^"]*"' "$latest" | cut -d'"' -f4)
                    echo "  Latest link: $(basename "$latest") type=$term_type"
                fi
            else
                log_skip "No link files found. Run 'claude-slack-notify link' to create one."
            fi
        else
            log_skip "Links directory doesn't exist"
        fi
        return
    fi

    link_file="$CLAUDE_DIR/links/${link_id}.json"
    if [[ -f "$link_file" ]]; then
        log_pass "Link file exists: $link_file"

        # Verify link file has required fields
        term_type=$(grep -o '"term_type": *"[^"]*"' "$link_file" | cut -d'"' -f4)
        term_target=$(grep -o '"term_target": *"[^"]*"' "$link_file" | cut -d'"' -f4)

        if [[ -n "$term_type" && -n "$term_target" ]]; then
            log_pass "Link file has term_type=$term_type and term_target"
        else
            log_fail "Link file missing required fields"
        fi
    else
        log_fail "Link file not found: $link_file"
    fi
}

# Test tmux environment variable reading
test_tmux_env_reading() {
    log_test "Case 8: Tmux environment variable reading"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Set a test variable in tmux environment
    local test_val="test-value-$$"
    tmux set-environment CLAUDE_TEST_VAR "$test_val"

    # Try to read it back
    local read_val
    read_val=$(tmux show-environment CLAUDE_TEST_VAR 2>/dev/null | cut -d= -f2-)

    if [[ "$read_val" == "$test_val" ]]; then
        log_pass "Can read/write tmux session environment variables"
    else
        log_fail "Failed to read tmux environment. Expected '$test_val', got '$read_val'"
    fi

    # Cleanup
    tmux set-environment -u CLAUDE_TEST_VAR 2>/dev/null || true
}

# Print summary
print_summary() {
    echo ""
    echo "========================================="
    echo "Test Summary"
    echo "========================================="
    local pass_count=0
    local fail_count=0
    local skip_count=0

    for result in "${TEST_RESULTS[@]}"; do
        echo "$result"
        case "$result" in
            PASS:*) ((pass_count++)) ;;
            FAIL:*) ((fail_count++)) ;;
            SKIP:*) ((skip_count++)) ;;
        esac
    done

    echo ""
    echo "Passed: $pass_count  Failed: $fail_count  Skipped: $skip_count"

    if [[ $fail_count -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Show help
show_help() {
    echo "Usage: $0 [test-number|all|local|remote]"
    echo ""
    echo "Test numbers:"
    echo "  1  Local Terminal.app (no tmux)"
    echo "  2  Local Terminal.app + tmux"
    echo "  3  Local iTerm2 (no tmux)"
    echo "  4  Local iTerm2 + tmux"
    echo "  5  Link command sets tmux environment (remote)"
    echo "  6  SSH-linked session registration (remote)"
    echo "  7  Link file exists on Mac"
    echo "  8  Tmux environment variable reading"
    echo ""
    echo "Groups:"
    echo "  local   Run tests appropriate for local Mac"
    echo "  remote  Run tests appropriate for remote Linux"
    echo "  all     Run all tests (skips inappropriate ones)"
    echo ""
    echo "Environment variables:"
    echo "  SLACK_NOTIFY_DEBUG=1  Enable debug output"
}

# Main
case "${1:-all}" in
    -h|--help|help) show_help ;;
    1) test_local_terminal ;;
    2) test_local_terminal_tmux ;;
    3) test_local_iterm ;;
    4) test_local_iterm_tmux ;;
    5) test_link_tmux_env ;;
    6) test_ssh_linked_registration ;;
    7) test_link_file_exists ;;
    8) test_tmux_env_reading ;;
    local)
        # Local Mac tests
        test_local_terminal
        test_local_terminal_tmux
        test_local_iterm
        test_local_iterm_tmux
        test_link_file_exists
        test_tmux_env_reading
        print_summary
        ;;
    remote)
        # Remote Linux tests (inside linked session)
        test_link_tmux_env
        test_ssh_linked_registration
        test_tmux_env_reading
        print_summary
        ;;
    all)
        # Run all tests, each will skip if not applicable
        test_local_terminal
        test_local_terminal_tmux
        test_local_iterm
        test_local_iterm_tmux
        test_link_tmux_env
        test_ssh_linked_registration
        test_link_file_exists
        test_tmux_env_reading
        print_summary
        ;;
    *)
        echo "Unknown test: $1" >&2
        show_help
        exit 1
        ;;
esac
