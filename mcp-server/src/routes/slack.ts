import type { Request, Response } from 'express';
import { Router } from 'express';

import { executeFocus, executeFocusUrl, type FocusAction } from '../lib/focus-executor.js';
import { getSession } from '../lib/session-store.js';
import { verifySlackSignature } from '../lib/slack-verify.js';

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

export default router;
