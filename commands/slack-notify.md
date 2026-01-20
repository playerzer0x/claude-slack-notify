Enable Slack notifications for this Claude session with a unique instance name.

**Note**: If the user ran `install.sh`, the webhook URL and Claude hooks are typically already configured. This command just registers the current session.

## Subcommands

- `/slack-notify` - Register the current session (default)
- `/slack-notify stop` - Stop the tunnel and MCP server

## Stop Command

If the user runs `/slack-notify stop`, stop the tunnel:
```bash
~/.claude/bin/claude-slack-notify stop
```
This stops the cloudflared tunnel and MCP server. Confirm that services were stopped.

## Register Command (default)

When the user runs `/slack-notify` (with no arguments or a custom name):

1. **Check webhook configuration**: If ~/.claude/slack-webhook-url doesn't exist, ask for their Slack webhook URL and save it. (Usually already set by installer)

2. **Register this instance**: Run the command to register this Claude session:
   ```bash
   SESSION_ID=$(~/.claude/bin/get-session-id) && CLAUDE_INSTANCE_ID="$SESSION_ID" ~/.claude/bin/claude-slack-notify register [optional-name]
   ```
   - If the user provides a name argument to /slack-notify (e.g., `/slack-notify MyProject`), use that name
   - Otherwise, a random 4-word name like "cosmic-phoenix-scarlet-breeze" will be generated
   - The script auto-detects terminal type (tmux window/pane, iTerm2 tab, Terminal.app tab)

3. **Show the registered info**: Display the instance name and terminal location that was registered.

4. **Test the notification**: Send a test notification using:
   ```bash
   SESSION_ID=$(~/.claude/bin/get-session-id) && CLAUDE_INSTANCE_ID="$SESSION_ID" ~/.claude/bin/claude-slack-notify "Instance registered and ready" "started"
   ```

5. **Confirm setup**: Tell the user their instance is registered and they'll receive notifications for tasks taking >30 seconds.

The notification will include:
- The unique instance name (e.g., "cosmic-phoenix-scarlet-breeze")
- The hostname and terminal location (e.g., "macbook (iterm-tmux /dev/ttys010)")
- Context about what was happening (e.g., "Finished: Running command (45s)")
- A clickable "Focus Terminal" button that switches to the correct terminal tab

If they need help getting a webhook URL:
- Go to https://api.slack.com/apps
- Create New App → From an app manifest (fastest) or From scratch
- If using manifest: paste the contents of `slack-app-manifest.json` from the repo
- Enable Incoming Webhooks → Add New Webhook to Workspace
- Choose a channel and copy the URL

Environment variables that affect notifications:
- CLAUDE_NOTIFY_MIN_SECONDS: Minimum task duration before notifying (default: 30)
