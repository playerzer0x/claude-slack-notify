# Focus Button Test Checklist

Run each scenario and verify the focus button works correctly.

## Prerequisites
- [ ] Mac has `local-tunnel` running
- [ ] Remote server (if testing linked sessions) is accessible via SSH

## Local Sessions (Mac Only)

### Test 1: Terminal.app (no tmux)
- [ ] Open Terminal.app
- [ ] Run: `claude-slack-notify register test-term`
- [ ] Send test notification: `claude-slack-notify "test" "testing"`
- [ ] Click Focus button in Slack
- [ ] **Expected**: Terminal.app window focuses

### Test 2: Terminal.app + tmux
- [ ] Open Terminal.app
- [ ] Run: `tmux new -s test-term-tmux`
- [ ] Run: `claude-slack-notify register test-term-tmux`
- [ ] Create second tmux window: Ctrl+B, C
- [ ] Send notification from first window
- [ ] Click Focus button
- [ ] **Expected**: Terminal focuses AND tmux switches to first window

### Test 3: iTerm2 (no tmux)
- [ ] Open iTerm2
- [ ] Run: `claude-slack-notify register test-iterm`
- [ ] Send notification
- [ ] Switch to different app
- [ ] Click Focus button
- [ ] **Expected**: iTerm2 window focuses

### Test 4: iTerm2 + tmux
- [ ] Open iTerm2
- [ ] Run: `tmux new -s test-iterm-tmux`
- [ ] Run: `claude-slack-notify register test-iterm-tmux`
- [ ] Switch to different tmux window
- [ ] Send notification
- [ ] Click Focus button
- [ ] **Expected**: iTerm2 focuses AND tmux switches to correct window

## Remote Sessions (Mac -> Remote)

### Test 5: Terminal.app remote to Linux tmux
- [ ] On Mac Terminal.app, run: `claude-slack-notify remote`
- [ ] Enter hostname when prompted (first run only)
- [ ] On remote (in tmux), run: `/slack-notify`
- [ ] Verify: `tmux show-environment | grep CLAUDE` shows variables
- [ ] Run tests for notification delivery
- [ ] **Note**: Focus button not supported in simplified remote mode

### Test 6: Remote with different hosts
- [ ] Run: `claude-slack-notify remote other-host` to override saved host
- [ ] Verify: SSHs to `other-host` instead of saved host
- [ ] Run: `rm ~/.claude/.remote-host` to reset
- [ ] Run: `claude-slack-notify remote` - should prompt again

### Test 7: JupyterLab setup
- [ ] Open JupyterLab in Chrome
- [ ] On remote JupyterLab terminal:
  - [ ] `claude-slack-notify jupyter` (first run prompts for URL)
  - [ ] Automatically starts tmux session with environment set
  - [ ] `claude` then `/slack-notify`
- [ ] Test notification delivery
- [ ] **Note**: Focus button requires opening the setup URL on Mac

## Automated Tests

Run the automated integration test script:

```bash
# On Mac (local tests)
./bin/test-focus-scenarios.sh local

# On remote (linked session tests)
./bin/test-focus-scenarios.sh remote

# All tests (skips inappropriate ones)
./bin/test-focus-scenarios.sh all
```

## Debug Commands

If a test fails, check:

```bash
# Mac: Check focus-helper log
tail -50 ~/.claude/logs/focus-debug.log

# Mac: Check MCP server log
tail -50 ~/.claude/mcp-server.log

# Remote: Check session registration
cat ~/.claude/instances/*.json | jq .

# Remote: Check tmux environment
tmux show-environment | grep CLAUDE

# Enable debug mode for more output
SLACK_NOTIFY_DEBUG=1 claude-slack-notify register test
```

## Troubleshooting

### Focus button does nothing
1. Check `local-tunnel` is running on Mac
2. Check ngrok URL matches Slack app Request URL
3. Check MCP server logs for errors

### Wrong hostname in focus URL
1. Verify `tmux show-environment CLAUDE_SSH_HOST` returns correct alias
2. If empty, recreate the session using `claude-slack-notify remote`

### Session registered without CLAUDE_INSTANCE_NAME
1. Check tmux session environment: `tmux show-environment | grep CLAUDE`
2. Recreate session using `claude-slack-notify remote` from Mac
