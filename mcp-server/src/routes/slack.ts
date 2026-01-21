import type { Request, Response } from 'express';
import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { executeFocus, executeFocusUrl, type FocusAction } from '../lib/focus-executor.js';
import { getSession } from '../lib/session-store.js';
import { verifySlackSignature } from '../lib/slack-verify.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const THREADS_DIR = join(CLAUDE_DIR, 'threads');

// Load thread info by thread_ts
interface ThreadInfo {
  thread_ts: string;
  instance_id: string;
  focus_url: string;
  term_type: string;
}

function loadThreadInfo(threadTs: string): ThreadInfo | null {
  const threadFile = join(THREADS_DIR, `${threadTs}.json`);
  if (!existsSync(threadFile)) {
    return null;
  }
  try {
    const content = readFileSync(threadFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Touch activity file to reset idle timeout
function touchActivityFile(): void {
  try {
    const activityFile = `${homedir()}/.claude/.tunnel-last-activity`;
    writeFileSync(activityFile, '');
  } catch {
    // Ignore errors - file may not exist if tunnel not running
  }
}

const router = Router();

const VALID_ACTIONS = new Set<FocusAction>(['1', '2', 'continue', 'push', 'focus']);

interface SlackBlockAction {
  action_id: string;
  value: string;
}

interface SlackPayload {
  type: string;
  actions: SlackBlockAction[];
}

function isValidAction(action: string): action is FocusAction {
  return VALID_ACTIONS.has(action as FocusAction);
}

// POST /slack/actions - Handle Slack interactive button clicks
router.post('/actions', verifySlackSignature, async (req: Request, res: Response) => {
  // Touch activity file to reset idle timeout
  touchActivityFile();

  // Always return 200 to acknowledge receipt and prevent Slack retries
  const ack = () => res.status(200).send();

  try {
    // Slack sends payload as URL-encoded form data
    const payloadStr = req.body.payload;
    if (!payloadStr) {
      res.status(400).send('Missing payload');
      return;
    }

    const payload: SlackPayload = JSON.parse(payloadStr);

    // Handle block_actions (button clicks)
    if (payload.type !== 'block_actions' || !payload.actions?.length) {
      ack();
      return;
    }

    const action = payload.actions[0];

    // Parse action value - two formats supported:
    // 1. "session_id|action" - traditional format, looks up session by ID
    // 2. "url:focus_url|action" - direct URL format for remote sessions (ssh-linked, jupyter-tmux)
    const pipeIndex = action.value.lastIndexOf('|');
    if (pipeIndex === -1) {
      console.error('Invalid action value format (no pipe):', action.value);
      ack();
      return;
    }

    const firstPart = action.value.substring(0, pipeIndex);
    const actionType = action.value.substring(pipeIndex + 1);

    if (!isValidAction(actionType)) {
      console.error('Invalid action type:', actionType);
      ack();
      return;
    }

    // Check if this is a direct URL format (for remote sessions)
    if (firstPart.startsWith('url:')) {
      const focusUrl = firstPart.substring(4); // Remove "url:" prefix
      console.log(`Direct URL action: ${focusUrl} / ${actionType}`);
      const result = await executeFocusUrl(focusUrl, actionType);
      console.log(`Focus URL result for ${actionType}:`, result);
      ack();
      return;
    }

    // Traditional session ID lookup
    const sessionId = firstPart;
    const session = await getSession({ id: sessionId });
    if (!session) {
      console.error('Session not found:', sessionId);
      ack();
      return;
    }

    const result = await executeFocus(session, actionType);
    console.log(`Focus result for ${sessionId}/${actionType}:`, result);

    ack();
  } catch (error) {
    console.error('Error handling Slack action:', error);
    ack();
  }
});

// POST /slack/events - Handle Slack Events (thread replies)
router.post('/events', async (req: Request, res: Response) => {
  touchActivityFile();

  try {
    const body = req.body;

    // URL verification challenge (sent once when subscribing to events)
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge });
      return;
    }

    // Handle event callbacks
    if (body.type === 'event_callback') {
      const event = body.event;

      // Only handle message events in threads (replies), ignore bot messages
      if (event.type === 'message' && event.thread_ts && !event.bot_id) {
        const threadTs = event.thread_ts;
        const text = event.text;

        console.log(`Thread reply received: thread_ts=${threadTs}, text="${text}"`);

        // Look up thread info
        const threadInfo = loadThreadInfo(threadTs);
        if (!threadInfo) {
          console.log(`No thread mapping found for ${threadTs}`);
          res.status(200).send();
          return;
        }

        // Use focus executor to send the text
        // Build URL with text as the action (we'll handle this specially)
        const focusUrl = threadInfo.focus_url;
        console.log(`Sending thread reply to: ${focusUrl}`);

        // Execute with the text as a custom input
        // We pass 'focus' as action but the text will be handled via focus-helper
        const result = await executeFocusUrl(`${focusUrl}?text=${encodeURIComponent(text)}`, 'focus');
        console.log('Thread reply result:', result);
      }

      // Always acknowledge quickly
      res.status(200).send();
      return;
    }

    res.status(200).send();
  } catch (error) {
    console.error('Error handling Slack event:', error);
    res.status(200).send();
  }
});

export default router;
