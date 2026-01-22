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

## Linked Sessions (Mac -> Remote)

### Test 5: Terminal.app link to Linux tmux
- [ ] On Mac Terminal.app, run: `claude-slack-notify link --host <remote>`
- [ ] On remote (in tmux), run: `/slack-notify`
- [ ] Verify: `tmux show-environment | grep CLAUDE` shows variables
- [ ] Switch Mac to different app
- [ ] Click Focus button
- [ ] **Expected**: Mac Terminal.app focuses

### Test 6: Terminal.app + tmux link to Linux tmux
- [ ] On Mac Terminal.app, run: `tmux new -s local-test`
- [ ] In tmux, run: `claude-slack-notify link --host <remote>`
- [ ] On remote, run: `/slack-notify`
- [ ] Create new local tmux window, switch to it
- [ ] Click Focus button
- [ ] **Expected**: Mac Terminal focuses AND local tmux switches

### Test 7: iTerm2 link to Linux tmux
- [ ] On Mac iTerm2, run: `claude-slack-notify link --host <remote>`
- [ ] On remote, run: `/slack-notify`
- [ ] Switch Mac to different app
- [ ] Click Focus button
- [ ] **Expected**: Mac iTerm2 focuses

### Test 8: JupyterLab Chrome link
- [ ] Open JupyterLab in Chrome
- [ ] On Mac, run: `claude-slack-notify link --jupyter --host <remote>`
- [ ] On remote JupyterLab terminal:
  - [ ] `source ~/.claude/jupyter-env`
  - [ ] `tmux new -s jupyter \; set-environment CLAUDE_LINK_ID "$CLAUDE_LINK_ID" \; set-environment CLAUDE_SSH_HOST "$CLAUDE_SSH_HOST" \; set-environment CLAUDE_INSTANCE_NAME "$CLAUDE_INSTANCE_NAME"`
  - [ ] `/slack-notify`
- [ ] Switch to different Chrome tab
- [ ] Click Focus button
- [ ] **Expected**: Chrome switches to JupyterLab tab

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
2. If empty, the session was created with old link command - recreate it

### Session registered as ssh-tmux instead of ssh-linked
1. CLAUDE_LINK_ID is not set
2. Check if link file exists on Mac: `ls ~/.claude/links/`
3. Check tmux session environment: `tmux show-environment | grep CLAUDE`
