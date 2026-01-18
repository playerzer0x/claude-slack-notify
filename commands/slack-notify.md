Enable Slack notifications for this Claude session with a unique instance name.

When the user runs this command:

1. **Check webhook configuration**: If ~/.claude/slack-webhook-url doesn't exist, ask for their Slack webhook URL and save it.

2. **Register this instance**: Run the command to register this Claude session:
   ```bash
   CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify register [optional-name]
   ```
   - If the user provides a name argument to /slack-notify (e.g., `/slack-notify MyProject`), use that name
   - Otherwise, a random 4-word name like "cosmic-phoenix-scarlet-breeze" will be generated
   - The script auto-detects terminal type (tmux window/pane, iTerm2 tab, Terminal.app tab)

3. **Show the registered info**: Display the instance name and terminal location that was registered.

4. **Test the notification**: Send a test notification using:
   ```bash
   CLAUDE_INSTANCE_ID=$PPID ~/.claude/bin/claude-slack-notify "Instance registered and ready" "started"
   ```

5. **Confirm setup**: Tell the user their instance is registered and they'll receive notifications for tasks taking >30 seconds.

The notification will include:
- The unique instance name (e.g., "cosmic-phoenix-scarlet-breeze")
- The hostname and terminal location (e.g., "macbook (iterm-tmux /dev/ttys010)")
- A clickable "Focus Terminal" button that switches to the correct terminal tab

If they need help getting a webhook URL:
- Go to https://api.slack.com/apps
- Create New App → From scratch → Name it "Claude Notifier"
- Enable Incoming Webhooks in the sidebar
- Add New Webhook to Workspace
- Choose a channel and copy the URL

Environment variables that affect notifications:
- CLAUDE_NOTIFY_MIN_SECONDS: Minimum task duration before notifying (default: 30)
