#!/usr/bin/env bash
#
# Test Assertions - Helper functions for E2E tests
#

# Assert two values are equal
# Usage: assert_equals "actual" "expected" ["message"]
assert_equals() {
    local actual="$1"
    local expected="$2"
    local message="${3:-values should be equal}"

    if [[ "$actual" == "$expected" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Expected: '$expected'"
        echo "  Actual:   '$actual'"
        return 1
    fi
}

# Assert first value contains second value
# Usage: assert_contains "haystack" "needle" ["message"]
assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-value should contain substring}"

    if [[ "$haystack" == *"$needle"* ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Value:    '$haystack'"
        echo "  Expected to contain: '$needle'"
        return 1
    fi
}

# Assert first value does not contain second value
# Usage: assert_not_contains "haystack" "needle" ["message"]
assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-value should not contain substring}"

    if [[ "$haystack" != *"$needle"* ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Value:    '$haystack'"
        echo "  Should not contain: '$needle'"
        return 1
    fi
}

# Assert first value is less than second value (numeric comparison)
# Usage: assert_less_than "actual" "threshold" ["message"]
assert_less_than() {
    local actual="$1"
    local threshold="$2"
    local message="${3:-value should be less than threshold}"

    # Handle floating point comparison
    if command -v bc &>/dev/null; then
        if [[ $(echo "$actual < $threshold" | bc -l) -eq 1 ]]; then
            return 0
        fi
    else
        # Fallback to integer comparison
        if [[ "$actual" -lt "$threshold" ]]; then
            return 0
        fi
    fi

    echo "FAIL: $message"
    echo "  Actual:    $actual"
    echo "  Threshold: $threshold (should be less than)"
    return 1
}

# Assert first value is greater than second value (numeric comparison)
# Usage: assert_greater_than "actual" "threshold" ["message"]
assert_greater_than() {
    local actual="$1"
    local threshold="$2"
    local message="${3:-value should be greater than threshold}"

    # Handle floating point comparison
    if command -v bc &>/dev/null; then
        if [[ $(echo "$actual > $threshold" | bc -l) -eq 1 ]]; then
            return 0
        fi
    else
        # Fallback to integer comparison
        if [[ "$actual" -gt "$threshold" ]]; then
            return 0
        fi
    fi

    echo "FAIL: $message"
    echo "  Actual:    $actual"
    echo "  Threshold: $threshold (should be greater than)"
    return 1
}

# Assert file exists
# Usage: assert_file_exists "/path/to/file" ["message"]
assert_file_exists() {
    local file_path="$1"
    local message="${2:-file should exist}"

    if [[ -f "$file_path" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  File does not exist: '$file_path'"
        return 1
    fi
}

# Assert file does not exist
# Usage: assert_file_not_exists "/path/to/file" ["message"]
assert_file_not_exists() {
    local file_path="$1"
    local message="${2:-file should not exist}"

    if [[ ! -f "$file_path" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  File exists but should not: '$file_path'"
        return 1
    fi
}

# Assert directory exists
# Usage: assert_dir_exists "/path/to/dir" ["message"]
assert_dir_exists() {
    local dir_path="$1"
    local message="${2:-directory should exist}"

    if [[ -d "$dir_path" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Directory does not exist: '$dir_path'"
        return 1
    fi
}

# Assert command exits with specific code
# Usage: assert_exit_code "command" "expected_code" ["message"]
assert_exit_code() {
    local command="$1"
    local expected_code="$2"
    local message="${3:-command should exit with code $expected_code}"

    local actual_code
    set +e
    eval "$command" >/dev/null 2>&1
    actual_code=$?
    set -e

    if [[ "$actual_code" -eq "$expected_code" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Command: '$command'"
        echo "  Expected exit code: $expected_code"
        echo "  Actual exit code:   $actual_code"
        return 1
    fi
}

# Assert command succeeds (exit code 0)
# Usage: assert_success "command" ["message"]
assert_success() {
    local command="$1"
    local message="${2:-command should succeed}"

    assert_exit_code "$command" 0 "$message"
}

# Assert command fails (exit code non-zero)
# Usage: assert_failure "command" ["message"]
assert_failure() {
    local command="$1"
    local message="${2:-command should fail}"

    local actual_code
    set +e
    eval "$command" >/dev/null 2>&1
    actual_code=$?
    set -e

    if [[ "$actual_code" -ne 0 ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Command: '$command'"
        echo "  Expected non-zero exit code"
        echo "  Actual exit code: $actual_code"
        return 1
    fi
}

# Assert output matches expected value
# Usage: assert_output "command" "expected_output" ["message"]
assert_output() {
    local command="$1"
    local expected="$2"
    local message="${3:-command output should match}"

    local actual
    actual=$(eval "$command" 2>&1)

    assert_equals "$actual" "$expected" "$message"
}

# Assert output contains substring
# Usage: assert_output_contains "command" "substring" ["message"]
assert_output_contains() {
    local command="$1"
    local substring="$2"
    local message="${3:-command output should contain substring}"

    local actual
    actual=$(eval "$command" 2>&1)

    assert_contains "$actual" "$substring" "$message"
}

# Assert JSON field equals value (requires jq)
# Usage: assert_json_equals "json_string" ".field.path" "expected_value" ["message"]
assert_json_equals() {
    local json="$1"
    local jq_path="$2"
    local expected="$3"
    local message="${4:-JSON field should equal expected value}"

    if ! command -v jq &>/dev/null; then
        echo "SKIP: jq not available for JSON assertion"
        return 0
    fi

    local actual
    actual=$(echo "$json" | jq -r "$jq_path" 2>/dev/null)

    assert_equals "$actual" "$expected" "$message"
}

# Assert HTTP response code
# Usage: assert_http_code "url" "expected_code" ["message"]
assert_http_code() {
    local url="$1"
    local expected_code="$2"
    local message="${3:-HTTP response should have expected status code}"

    if ! command -v curl &>/dev/null; then
        echo "SKIP: curl not available for HTTP assertion"
        return 0
    fi

    local actual_code
    actual_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)

    assert_equals "$actual_code" "$expected_code" "$message"
}

# Assert variable is not empty
# Usage: assert_not_empty "$var" ["message"]
assert_not_empty() {
    local value="$1"
    local message="${2:-value should not be empty}"

    if [[ -n "$value" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Value is empty"
        return 1
    fi
}

# Assert variable is empty
# Usage: assert_empty "$var" ["message"]
assert_empty() {
    local value="$1"
    local message="${2:-value should be empty}"

    if [[ -z "$value" ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Value: '$value'"
        echo "  Expected empty value"
        return 1
    fi
}

# Assert value matches regex
# Usage: assert_matches "value" "regex" ["message"]
assert_matches() {
    local value="$1"
    local regex="$2"
    local message="${3:-value should match regex}"

    if [[ "$value" =~ $regex ]]; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Value: '$value'"
        echo "  Pattern: '$regex'"
        return 1
    fi
}

# Assert process is running
# Usage: assert_process_running "process_name" ["message"]
assert_process_running() {
    local process_name="$1"
    local message="${2:-process should be running}"

    if pgrep -f "$process_name" >/dev/null 2>&1; then
        return 0
    else
        echo "FAIL: $message"
        echo "  Process not found: '$process_name'"
        return 1
    fi
}

# Assert port is listening
# Usage: assert_port_listening "port" ["message"]
assert_port_listening() {
    local port="$1"
    local message="${2:-port should be listening}"

    if command -v ss &>/dev/null; then
        if ss -tuln | grep -q ":${port} "; then
            return 0
        fi
    elif command -v netstat &>/dev/null; then
        if netstat -tuln | grep -q ":${port} "; then
            return 0
        fi
    elif command -v lsof &>/dev/null; then
        if lsof -i ":${port}" >/dev/null 2>&1; then
            return 0
        fi
    fi

    echo "FAIL: $message"
    echo "  Port $port is not listening"
    return 1
}
