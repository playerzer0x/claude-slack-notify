# Focus Switcher Reliability Fixes

## Summary

Fixed intermittent iTerm2 window focusing failures, especially when:
- User has multiple iTerm2 windows open
- One window is fullscreen on a second monitor
- User is actively typing in a different window (blue border visible)

## Problem Statement

The `bin/focus-helper` script's `switch_iterm_session` function intermittently failed to switch iTerm2 windows when clicking Slack notification buttons.

**Critical bug found in logs**: Script requested to focus session `9FF5ACA5-...` but actually focused `C0DC7D9C-...` - wrong window entirely.

### Symptoms

1. Clicking "Focus" button in Slack did nothing
2. Wrong iTerm2 window received focus
3. Fullscreen windows on second monitor never received focus
4. No error messages - failures were silent

## Root Cause Analysis

### Issue 1: Window Name Matching (Unreliable)

**Before**: Code captured `name of w` then later searched System Events by that name:
```applescript
set winName to name of w
-- ... later ...
perform action "AXRaise" of (first window whose name is winName)
```

**Problem**: Window names are dynamic and can match wrong windows when multiple windows have similar/identical names.

### Issue 2: No Timing Delays

**Before**: AppleScript operations (`select`, `activate`, `AXRaise`) executed without delays.

**Problem**: These operations are async. Without delays, race conditions caused operations to execute before previous ones completed.

### Issue 3: Silent Failures

**Before**: `AXRaise` wrapped in try block with no error handling:
```applescript
try
    perform action "AXRaise" of (first window whose name is winName)
end try
```

**Problem**: Failures went unnoticed, no debugging information available.

### Issue 4: No Verification

**Before**: Never checked if the correct window was actually focused.

**Problem**: No way to detect when wrong window received focus.

### Issue 5: Fullscreen Windows in Separate Spaces

**Before**: No special handling for fullscreen windows.

**Problem**: Fullscreen windows exist in their own macOS Space. Switching to them requires:
- Longer delays for Space switching animation
- More aggressive activation attempts
- Proper window ordering before activation

## Solution

### Key Insight

After `select w` makes the target window iTerm2's key window, it becomes `first window` in System Events. No name matching needed.

### Implementation Changes

#### Phase 1: Find Target and Store Window ID

```applescript
set targetWindowId to id of w      -- Stable integer, not name
set targetTabIndex to tabIndex
set targetWindow to w
set targetWindowIndex to winIndex  -- For fullscreen detection
```

#### Phase 2: Detect Fullscreen State

```applescript
tell application "System Events"
    tell process "iTerm2"
        set isFullscreen to value of attribute "AXFullScreen" of window targetWindowIndex
    end tell
end tell
```

#### Phase 3: Focus Sequence with Retries

```applescript
-- Step 1: Select tab
tell targetWindow to select tab targetTabIndex

-- Step 2: Set window ordering (crucial for multi-window)
set index of targetWindow to 1

-- Step 3: Select window for keyboard focus
select targetWindow

-- Step 4: Delay for iTerm2 processing
delay baseDelay  -- 0.15 normal, 0.3 fullscreen

-- Step 5: Activate (triggers Space switch)
activate

-- Step 6: Longer delay for Space switching
delay 0.4  -- for fullscreen/retry attempts

-- Step 7: System Events to raise window
tell application "System Events"
    tell process "iTerm2"
        set frontmost to true
        perform action "AXRaise" of first window
    end tell
end tell
```

#### Phase 4: Verification and Retry

```applescript
set frontWindowId to id of first window
if frontWindowId is equal to targetWindowId then
    set focusSuccess to true
else
    -- Retry with longer delays
    delay (0.3 * attemptNum)
    activate
end if
```

### Timing Configuration

| Scenario | Base Delay | Space Switch Delay | Max Attempts |
|----------|------------|-------------------|--------------|
| Normal window | 150ms | 150ms | 3 |
| Fullscreen window | 300ms | 400ms | 4 |
| Final fallback | 500ms | 500ms | +1 |

## Files Changed

- `bin/focus-helper` - `switch_iterm_session` function (lines 266-442)

## Commits

1. `08ac02c` - Fix iTerm2 window focusing reliability
   - Replace window name matching with window ID verification
   - Add timing delays between operations
   - Add retry loop with verification

2. `a7f2c18` - Handle fullscreen windows across Spaces
   - Detect fullscreen state via AXFullScreen attribute
   - Use `set index of targetWindow to 1` for window ordering
   - Increase delays for Space switching
   - Add 4 retry attempts for fullscreen
   - Final aggressive fallback

## Testing Checklist

### Basic Test
1. Open 2+ iTerm2 windows
2. Click in one window to give it cursor focus
3. Click Slack button targeting the OTHER window
4. Confirm correct window is raised and focused

### Fullscreen Test
1. Open iTerm2 fullscreen on second monitor
2. Click into it (blue border appears)
3. Click Slack button targeting a window on primary monitor
4. Confirm primary monitor window is raised

### Edge Cases
- Windows on different Spaces
- Windows with identical names
- Rapid successive button clicks
- User actively typing during focus

### Log Verification

Check `~/.claude/logs/focus-debug.log` for:
```
SUCCESS: Focused window id X tab Y for id ABC123
SUCCESS: Focused fullscreen window id X tab Y for id ABC123
```

Not:
```
FOCUS_FAILED: Requested window id X but front window has different id
```

## References

- [Detect fullscreen - MacScripter](https://www.macscripter.net/t/detect-fullscreen/73380)
- [Work in multiple spaces on Mac - Apple Support](https://support.apple.com/en-euro/guide/mac-help/mh14112/mac)
- [iTerm2 Scripting Documentation](https://iterm2.com/documentation-scripting.html)
- [iTerm2 Multi-Monitor Issue #6397](https://gitlab.com/gnachman/iterm2/-/issues/6397)

## Related Change

Also in this session: `a06dd66` - Show detailed tool request in Slack notifications

Changed notification message from generic "Claude needs your permission to use Bash" to actual request like "Claude wants to Check git status" by extracting the description from the transcript's tool_use block.
