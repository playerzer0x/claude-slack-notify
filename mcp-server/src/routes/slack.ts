import type { Request, Response } from 'express';
import { Router } from 'express';

import { executeFocus, type FocusAction } from '../lib/focus-executor.js';
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

    // Parse action value: "session_id|action"
    const [sessionId, actionType] = action.value.split('|');

    if (!sessionId || !actionType) {
      console.error('Invalid action value format:', action.value);
      ack();
      return;
    }

    const session = await getSession({ id: sessionId });
    if (!session) {
      console.error('Session not found:', sessionId);
      ack();
      return;
    }

    if (!isValidAction(actionType)) {
      console.error('Invalid action type:', actionType);
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
