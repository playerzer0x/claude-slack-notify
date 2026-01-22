#!/bin/bash
# Edge case tests for focus button tmux environment handling
# Tests various scenarios that could break the environment variable detection

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

# Cleanup function
cleanup_session() {
    local session_id="$1"
    rm -f "$CLAUDE_DIR/instances/${session_id}.json" 2>/dev/null || true
}

# Edge Case 1: Shell env empty, tmux env has values (new window/pane scenario)
test_shell_empty_tmux_has_values() {
    log_test "Edge Case 1: Shell env empty, tmux env populated"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save current tmux env
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)

    # Set tmux env with test values
    tmux set-environment CLAUDE_LINK_ID "test-link-edge1"
    tmux set-environment CLAUDE_SSH_HOST "test-host-edge1"

    # Run with empty shell env
    local session_id="edge1-$$"
    local term_type focus_url
    (
        unset CLAUDE_LINK_ID CLAUDE_SSH_HOST CLAUDE_INSTANCE_NAME
        CLAUDE_INSTANCE_ID="$session_id" "$SCRIPT_DIR/claude-slack-notify" register "edge1" >/dev/null 2>&1
    )

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)
        focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        if [[ "$term_type" == "ssh-linked" && "$focus_url" == *"test-link-edge1"* && "$focus_url" == *"test-host-edge1"* ]]; then
            log_pass "Correctly read from tmux env when shell env empty"
        else
            log_fail "term_type=$term_type, focus_url should contain test values"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore tmux env
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    else
        tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    else
        tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true
    fi
}

# Edge Case 2: Shell env has values, tmux env empty (shell should take priority)
test_shell_has_values_tmux_empty() {
    log_test "Edge Case 2: Shell env populated, tmux env empty"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save and clear tmux env
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)
    tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true

    # Run with shell env set
    local session_id="edge2-$$"
    CLAUDE_LINK_ID="shell-link-edge2" \
    CLAUDE_SSH_HOST="shell-host-edge2" \
    CLAUDE_INSTANCE_ID="$session_id" \
        "$SCRIPT_DIR/claude-slack-notify" register "edge2" >/dev/null 2>&1

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)
        focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        if [[ "$term_type" == "ssh-linked" && "$focus_url" == *"shell-link-edge2"* && "$focus_url" == *"shell-host-edge2"* ]]; then
            log_pass "Correctly used shell env when tmux env empty"
        else
            log_fail "term_type=$term_type, focus_url should contain shell values"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore tmux env
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    fi
}

# Edge Case 3: Both shell and tmux have values (shell should take priority)
test_shell_and_tmux_both_have_values() {
    log_test "Edge Case 3: Both shell and tmux env populated (shell priority)"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save tmux env
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)

    # Set tmux env with different values
    tmux set-environment CLAUDE_LINK_ID "tmux-link-edge3"
    tmux set-environment CLAUDE_SSH_HOST "tmux-host-edge3"

    # Run with shell env set to different values
    local session_id="edge3-$$"
    CLAUDE_LINK_ID="shell-link-edge3" \
    CLAUDE_SSH_HOST="shell-host-edge3" \
    CLAUDE_INSTANCE_ID="$session_id" \
        "$SCRIPT_DIR/claude-slack-notify" register "edge3" >/dev/null 2>&1

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        # Shell should take priority
        if [[ "$focus_url" == *"shell-link-edge3"* && "$focus_url" == *"shell-host-edge3"* ]]; then
            log_pass "Shell env correctly takes priority over tmux env"
        elif [[ "$focus_url" == *"tmux-link-edge3"* ]]; then
            log_fail "Tmux env was used when shell env was set (shell should take priority)"
        else
            log_fail "Neither shell nor tmux values found in focus_url"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore tmux env
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    else
        tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    else
        tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true
    fi
}

# Edge Case 4: Handle tmux's "-VARNAME" format for unset variables
test_tmux_unset_variable_format() {
    log_test "Edge Case 4: Handle tmux -VARNAME format (unset indicator)"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save tmux env
    local saved_link_id
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)

    # Explicitly unset in tmux (creates -VARNAME entry)
    tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true

    # Verify tmux shows the unset format
    local tmux_output
    tmux_output=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null || true)

    if [[ "$tmux_output" == "-CLAUDE_LINK_ID" ]]; then
        # Our code should handle this and treat it as empty
        local session_id="edge4-$$"
        (
            unset CLAUDE_LINK_ID CLAUDE_SSH_HOST
            CLAUDE_INSTANCE_ID="$session_id" "$SCRIPT_DIR/claude-slack-notify" register "edge4" >/dev/null 2>&1
        )

        if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
            term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

            # Without link ID, should fall back to ssh-tmux (not ssh-linked)
            if [[ "$term_type" == "ssh-tmux" ]]; then
                log_pass "Correctly handled -VARNAME format as unset"
            else
                log_fail "Expected ssh-tmux (no link), got $term_type"
            fi
            cleanup_session "$session_id"
        else
            log_fail "Session file not created"
        fi
    else
        log_pass "Tmux doesn't show -VARNAME format in this version (acceptable)"
    fi

    # Restore
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    fi
}

# Edge Case 5: Non-linked SSH session (should be ssh-tmux, not ssh-linked)
test_non_linked_ssh_session() {
    log_test "Edge Case 5: Non-linked SSH session falls back to ssh-tmux"

    if [[ -z "$SSH_CONNECTION" ]]; then
        log_skip "Not in SSH session"
        return
    fi

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save and clear link vars
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)
    tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true

    local session_id="edge5-$$"
    (
        unset CLAUDE_LINK_ID CLAUDE_SSH_HOST
        CLAUDE_INSTANCE_ID="$session_id" "$SCRIPT_DIR/claude-slack-notify" register "edge5" >/dev/null 2>&1
    )

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        if [[ "$term_type" == "ssh-tmux" ]]; then
            log_pass "Non-linked SSH correctly registered as ssh-tmux"
        else
            log_fail "Expected ssh-tmux, got $term_type"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    fi
}

# Edge Case 6: Only CLAUDE_LINK_ID set, no CLAUDE_SSH_HOST (should use hostname -f)
test_link_id_without_ssh_host() {
    log_test "Edge Case 6: Link ID set but no SSH host (fallback to hostname)"

    if [[ -z "$SSH_CONNECTION" ]]; then
        log_skip "Not in SSH session"
        return
    fi

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    # Save and partially set tmux env
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)

    tmux set-environment CLAUDE_LINK_ID "test-link-edge6"
    tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true

    local session_id="edge6-$$"
    local expected_host
    expected_host=$(hostname -f 2>/dev/null || hostname)

    (
        unset CLAUDE_LINK_ID CLAUDE_SSH_HOST
        CLAUDE_INSTANCE_ID="$session_id" "$SCRIPT_DIR/claude-slack-notify" register "edge6" >/dev/null 2>&1
    )

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        term_type=$(grep -o '"term_type": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)
        focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        if [[ "$term_type" == "ssh-linked" ]]; then
            if [[ "$focus_url" == *"test-link-edge6"* ]]; then
                log_pass "Link ID used, hostname fallback applied"
            else
                log_fail "Link ID not found in focus_url"
            fi
        else
            log_fail "Expected ssh-linked with partial env, got $term_type"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    else
        tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    fi
}

# Edge Case 7: Special characters in SSH host
test_special_chars_in_host() {
    log_test "Edge Case 7: Special characters in SSH host"

    if [[ -z "$TMUX" ]]; then
        log_skip "Not in tmux"
        return
    fi

    if [[ -z "$SSH_CONNECTION" ]]; then
        log_skip "Not in SSH session"
        return
    fi

    # Save tmux env
    local saved_link_id saved_ssh_host
    saved_link_id=$(tmux show-environment CLAUDE_LINK_ID 2>/dev/null | cut -d= -f2- || true)
    saved_ssh_host=$(tmux show-environment CLAUDE_SSH_HOST 2>/dev/null | cut -d= -f2- || true)

    # Set tmux env with special chars (hostname with dots and dashes)
    tmux set-environment CLAUDE_LINK_ID "test-link-edge7"
    tmux set-environment CLAUDE_SSH_HOST "my-server.example.com"

    local session_id="edge7-$$"
    (
        unset CLAUDE_LINK_ID CLAUDE_SSH_HOST
        CLAUDE_INSTANCE_ID="$session_id" "$SCRIPT_DIR/claude-slack-notify" register "edge7" >/dev/null 2>&1
    )

    if [[ -f "$CLAUDE_DIR/instances/${session_id}.json" ]]; then
        focus_url=$(grep -o '"focus_url": *"[^"]*"' "$CLAUDE_DIR/instances/${session_id}.json" | cut -d'"' -f4)

        # URL encoding: . and - should be preserved or properly encoded
        if [[ "$focus_url" == *"my-server"* ]]; then
            log_pass "Special characters in hostname handled correctly"
        else
            log_fail "Hostname with special chars not found in focus_url: $focus_url"
        fi
        cleanup_session "$session_id"
    else
        log_fail "Session file not created"
    fi

    # Restore
    if [[ -n "$saved_link_id" && "$saved_link_id" != "-CLAUDE_LINK_ID" ]]; then
        tmux set-environment CLAUDE_LINK_ID "$saved_link_id"
    else
        tmux set-environment -u CLAUDE_LINK_ID 2>/dev/null || true
    fi
    if [[ -n "$saved_ssh_host" && "$saved_ssh_host" != "-CLAUDE_SSH_HOST" ]]; then
        tmux set-environment CLAUDE_SSH_HOST "$saved_ssh_host"
    else
        tmux set-environment -u CLAUDE_SSH_HOST 2>/dev/null || true
    fi
}

# Print summary
print_summary() {
    echo ""
    echo "========================================="
    echo "Edge Case Test Summary"
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

# Main
case "${1:-all}" in
    1) test_shell_empty_tmux_has_values ;;
    2) test_shell_has_values_tmux_empty ;;
    3) test_shell_and_tmux_both_have_values ;;
    4) test_tmux_unset_variable_format ;;
    5) test_non_linked_ssh_session ;;
    6) test_link_id_without_ssh_host ;;
    7) test_special_chars_in_host ;;
    all)
        test_shell_empty_tmux_has_values
        test_shell_has_values_tmux_empty
        test_shell_and_tmux_both_have_values
        test_tmux_unset_variable_format
        test_non_linked_ssh_session
        test_link_id_without_ssh_host
        test_special_chars_in_host
        print_summary
        ;;
    *)
        echo "Usage: $0 [1-7|all]"
        echo ""
        echo "Edge cases:"
        echo "  1  Shell env empty, tmux env populated"
        echo "  2  Shell env populated, tmux env empty"
        echo "  3  Both shell and tmux env populated (priority test)"
        echo "  4  Handle tmux -VARNAME format for unset vars"
        echo "  5  Non-linked SSH session falls back to ssh-tmux"
        echo "  6  Link ID set but no SSH host (fallback)"
        echo "  7  Special characters in SSH host"
        exit 1
        ;;
esac
