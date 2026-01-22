# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Project Overview

**claude-slack-notify** provides Slack notifications with interactive buttons for Claude Code sessions. Key architecture:

- **Remote is canonical**: All Slack button clicks go to Remote server first
- **Smart routing**: Input actions (1, 2, continue, push) handled locally; Focus forwarded to Mac
- **Session files**: Stored on the machine running Claude (`~/.claude/instances/`)
- **Link files**: Stored on Mac only (`~/.claude/links/`)

## Common Pitfalls (Read Before Coding)

### TTY Detection in Subprocesses
When Claude runs `/slack-notify`, it executes as a subprocess without a TTY. The `tty` command returns "not a tty".
- **iTerm2**: Works because `$ITERM_SESSION_ID` persists across subprocesses
- **Terminal.app**: Falls back to `frontmost` which focuses Terminal.app without a specific tab
- **Solution**: `detect_terminal()` uses a fallback chain: `tty` → `ps -o tty=` → `frontmost`

### Button Values for Remote Sessions
For ssh-linked sessions, embed the focus URL directly in button values:
- Local: `session_id|action`
- Remote: `url:claude-focus://ssh-linked/...|action`

### Config Sync
Slack credentials (`~/.claude/.slack-config`) must exist on any machine sending notifications with buttons. Use `remote` from Mac to sync config to Remote (automatically on first run).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

