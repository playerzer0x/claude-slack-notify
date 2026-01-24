#!/usr/bin/env bash
#
# E2E Test Runner for claude-slack-notify
# Usage: ./run-tests.sh [linux|mac|cross-machine|all]
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source libraries
source "$SCRIPT_DIR/lib/setup.sh"
source "$SCRIPT_DIR/lib/teardown.sh"
source "$SCRIPT_DIR/lib/assertions.sh"

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Detect current platform
detect_platform() {
    case "$(uname -s)" in
        Darwin) echo "mac" ;;
        Linux) echo "linux" ;;
        *) echo "unknown" ;;
    esac
}

CURRENT_PLATFORM=$(detect_platform)

# Print colored output
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if a test suite should be skipped based on platform
should_skip_suite() {
    local suite="$1"

    case "$suite" in
        linux)
            [[ "$CURRENT_PLATFORM" != "linux" ]]
            ;;
        mac)
            [[ "$CURRENT_PLATFORM" != "mac" ]]
            ;;
        cross-machine)
            # Cross-machine tests can run on any platform but may need special setup
            false
            ;;
        *)
            false
            ;;
    esac
}

# Run a single test file
run_test_file() {
    local test_file="$1"
    local test_name
    test_name=$(basename "$test_file" .sh)

    print_info "Running: $test_name"

    # Export test environment
    export TEST_DIR="$SCRIPT_DIR"
    export TEST_FILE="$test_file"

    # Run the test in a subshell to isolate failures
    local start_time end_time duration
    start_time=$(date +%s.%N)

    if bash "$test_file"; then
        end_time=$(date +%s.%N)
        duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "?")
        print_pass "$test_name (${duration}s)"
        ((TESTS_PASSED++))
        return 0
    else
        end_time=$(date +%s.%N)
        duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "?")
        print_fail "$test_name (${duration}s)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Run all tests in a suite directory
run_suite() {
    local suite_dir="$1"
    local suite_name
    suite_name=$(basename "$suite_dir")

    # Check if suite should be skipped on this platform
    if should_skip_suite "$suite_name"; then
        print_skip "Suite '$suite_name' (not applicable on $CURRENT_PLATFORM)"
        return 0
    fi

    print_header "Test Suite: $suite_name"

    # Find and run test files
    local test_files=()
    while IFS= read -r -d '' file; do
        test_files+=("$file")
    done < <(find "$suite_dir" -maxdepth 1 -name 'test-*.sh' -type f -print0 2>/dev/null | sort -z)

    if [[ ${#test_files[@]} -eq 0 ]]; then
        print_info "No tests found in $suite_name"
        return 0
    fi

    for test_file in "${test_files[@]}"; do
        run_test_file "$test_file" || true  # Continue even if test fails
    done
}

# Print summary
print_summary() {
    local total=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))

    echo ""
    print_header "Test Summary"
    echo -e "  ${GREEN}Passed:${NC}  $TESTS_PASSED"
    echo -e "  ${RED}Failed:${NC}  $TESTS_FAILED"
    echo -e "  ${YELLOW}Skipped:${NC} $TESTS_SKIPPED"
    echo -e "  ${BLUE}Total:${NC}   $total"
    echo ""

    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "${RED}Some tests failed!${NC}"
        return 1
    elif [[ $total -eq 0 ]]; then
        echo -e "${YELLOW}No tests were run.${NC}"
        return 0
    else
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    fi
}

# Main function
main() {
    local target="${1:-all}"

    print_header "E2E Tests for claude-slack-notify"
    print_info "Platform: $CURRENT_PLATFORM"
    print_info "Target: $target"

    # Setup test environment
    setup_test_environment

    # Trap to ensure cleanup on exit
    trap teardown_test_environment EXIT

    case "$target" in
        linux)
            run_suite "$SCRIPT_DIR/linux"
            ;;
        mac)
            run_suite "$SCRIPT_DIR/mac"
            ;;
        cross-machine)
            run_suite "$SCRIPT_DIR/cross-machine"
            ;;
        all)
            run_suite "$SCRIPT_DIR/linux"
            run_suite "$SCRIPT_DIR/mac"
            run_suite "$SCRIPT_DIR/cross-machine"
            ;;
        *)
            echo -e "${RED}Error: Unknown target '$target'${NC}"
            echo "Usage: $0 [linux|mac|cross-machine|all]"
            exit 1
            ;;
    esac

    # Print summary and exit with appropriate code
    print_summary
}

# Run main function
main "$@"
