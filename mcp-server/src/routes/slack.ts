import { Router, Request, Response } from 'express';
import { getSession } from '../lib/session-store.js';
import { executeFocus } from '../lib/focus-executor.js';
import { verifySlackSignature } from '../lib/slack-verify.js';

const router = Router();

interface SlackBlockAction {
  action_id: string;
  value: string;
}

interface SlackPayload {
  type: string;
  actions: SlackBlockAction[];
}

// POST /slack/actions - Handle Slack interactive button clicks
router.post('/actions', verifySlackSignature, async (req: Request, res: Response) => {
  try {
    // Slack sends payload as URL-encoded form data
    const payloadStr = req.body.payload;
    if (!payloadStr) {
      res.status(400).send('Missing payload');
      return;
    }

    const payload: SlackPayload = JSON.parse(payloadStr);

    // Handle block_actions (button clicks)
    if (payload.type === 'block_actions' && payload.actions?.length > 0) {
      const action = payload.actions[0];

      // Parse action value: "session_id|action"
      const [sessionId, actionType] = action.value.split('|');

      if (!sessionId || !actionType) {
        console.error('Invalid action value format:', action.value);
        res.status(200).send(); // Return 200 to prevent Slack retry
        return;
      }

      // Get session and execute focus
      const session = await getSession({ id: sessionId });
      if (!session) {
        console.error('Session not found:', sessionId);
        res.status(200).send();
        return;
      }

      const validActions = ['1', '2', 'continue', 'push', 'focus'] as const;
      if (!validActions.includes(actionType as typeof validActions[number])) {
        console.error('Invalid action type:', actionType);
        res.status(200).send();
        return;
      }

      const result = await executeFocus(session, actionType as typeof validActions[number]);
      console.log(`Focus result for ${sessionId}/${actionType}:`, result);
    }

    // Always return 200 within 3 seconds to acknowledge receipt
    res.status(200).send();
  } catch (error) {
    console.error('Error handling Slack action:', error);
    res.status(200).send(); // Return 200 even on error to prevent retries
  }
});

export default router;
