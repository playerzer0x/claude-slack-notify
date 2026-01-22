import type { Request, Response } from 'express';
import express, { Router } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { executeFocus, executeFocusUrl, type FocusAction } from '../lib/focus-executor.js';
import { getSession } from '../lib/session-store.js';
import { verifySlackSignature } from '../lib/slack-verify.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const THREADS_DIR = join(CLAUDE_DIR, 'threads');
const SLACK_DOWNLOADS_DIR = join(CLAUDE_DIR, 'slack-downloads');
const SLACK_CONFIG_PATH = join(CLAUDE_DIR, '.slack-config');

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

// Load bot token from slack config
function loadBotToken(): string | null {
  if (!existsSync(SLACK_CONFIG_PATH)) {
    return null;
  }
  try {
    const content = readFileSync(SLACK_CONFIG_PATH, 'utf-8');
    const match = content.match(/SLACK_BOT_TOKEN="([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Download file from Slack and save locally
interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
}

async function downloadSlackFile(file: SlackFile, botToken: string): Promise<string | null> {
  try {
    // Create downloads directory if needed
    if (!existsSync(SLACK_DOWNLOADS_DIR)) {
      mkdirSync(SLACK_DOWNLOADS_DIR, { recursive: true });
    }

    // Download file using bot token
    const response = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${botToken}` },
    });

    if (!response.ok) {
      console.error(`Failed to download file ${file.name}: ${response.status}`);
      return null;
    }

    const buffer = await response.arrayBuffer();

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = join(SLACK_DOWNLOADS_DIR, `${timestamp}-${safeFileName}`);

    writeFileSync(filePath, Buffer.from(buffer));
    console.log(`Downloaded file: ${filePath}`);

    return filePath;
  } catch (error) {
    console.error(`Error downloading file ${file.name}:`, error);
    return null;
  }
}

const router = Router();

const VALID_ACTIONS = new Set<FocusAction>(['1', '2', 'continue', 'push', 'focus']);

// Session types that require Mac's focus-helper for FOCUS action
// Input actions (1, 2, continue, push) can be handled locally via tmux
const MAC_FOCUS_TYPES = new Set([
  'terminal',
  'terminal-tmux',
  'iterm2',
  'iterm-tmux',
  'ssh-linked',
]);

// Actions that send input to tmux - can be handled locally without Mac
const INPUT_ACTIONS = new Set(['1', '2', 'continue', 'push']);

// Load Mac tunnel URL from config
// Returns null if on Mac (we ARE the Mac, don't forward to self)
function loadMacTunnelUrl(): string | null {
  // On Mac, we handle focus directly - no need to forward to ourselves
  if (process.platform === 'darwin') {
    return null;
  }

  const configPath = join(CLAUDE_DIR, '.mac-tunnel-url');
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    return readFileSync(configPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

// Forward focus request to Mac's tunnel
async function forwardToMac(
  macTunnelUrl: string,
  focusUrl: string,
  action: FocusAction
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${macTunnelUrl}/slack/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: focusUrl, action }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, message: `Mac returned ${response.status}: ${text}` };
    }

    const result = (await response.json()) as { success: boolean; message: string };
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('ECONNREFUSED')) {
      return { success: false, message: 'Mac tunnel not reachable (is local-tunnel running?)' };
    }
    return { success: false, message: `Failed to reach Mac: ${message}` };
  }
}

// Extract session type from focus URL
function getSessionTypeFromUrl(focusUrl: string): string | null {
  // Format: claude-focus://TYPE/...
  const match = focusUrl.match(/^claude-focus:\/\/([^/]+)/);
  return match ? match[1] : null;
}

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

// POST /focus - Internal endpoint for focus requests (from remote MCP server)
// No Slack signature verification - this is for internal routing
router.post('/focus', express.json(), async (req: Request, res: Response) => {
  touchActivityFile();

  try {
    const { url, action = 'focus' } = req.body as { url?: string; action?: string };

    if (!url) {
      res.status(400).json({ success: false, message: 'Missing url parameter' });
      return;
    }

    if (!isValidAction(action)) {
      res.status(400).json({ success: false, message: `Invalid action: ${action}` });
      return;
    }

    console.log(`Focus request: url=${url} action=${action}`);
    const result = await executeFocusUrl(url, action as FocusAction);
    console.log(`Focus result:`, result);

    res.json(result);
  } catch (error) {
    console.error('Error handling focus request:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

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

      // ACK immediately for snappy response - process in background
      ack();

      // Determine routing: input actions are always local, focus may need Mac
      const sessionType = getSessionTypeFromUrl(focusUrl);

      // Process action in background (fire and forget)
      (async () => {
        try {
          let result: { success: boolean; message: string };

          // Input actions (1, 2, continue, push) are handled locally for speed
          if (INPUT_ACTIONS.has(actionType)) {
            console.log(`Input action ${actionType} - handling locally`);
            result = await executeFocusUrl(focusUrl, actionType);
          } else if (sessionType && MAC_FOCUS_TYPES.has(sessionType)) {
            // Focus action on Mac-focused session - route to Mac's tunnel
            const macTunnelUrl = loadMacTunnelUrl();
            if (macTunnelUrl) {
              console.log(`Focus action routing to Mac: ${macTunnelUrl}`);
              result = await forwardToMac(macTunnelUrl, focusUrl, actionType);
            } else {
              console.log(`No Mac tunnel URL configured, trying local focus-helper`);
              result = await executeFocusUrl(focusUrl, actionType);
            }
          } else {
            // Remote session (ssh-tmux, jupyter-tmux) or unknown - handle locally
            result = await executeFocusUrl(focusUrl, actionType);
          }

          console.log(`Focus result for ${actionType}:`, result);
          if (!result.success) {
            console.error(`Action ${actionType} failed:`, result.message);
          }
        } catch (error) {
          console.error(`Background action ${actionType} error:`, error);
        }
      })();

      return;
    }

    // Traditional session ID lookup
    const sessionId = firstPart;
    const session = await getSession({ id: sessionId });
    if (!session) {
      console.error('Session not found:', sessionId);
      res.json({
        response_type: 'ephemeral',
        text: '⚠️ Session not found - it may have expired or been unregistered',
      });
      return;
    }

    // ACK immediately for snappy response - process in background
    ack();

    const termType = session.term_type;

    // Process action in background (fire and forget)
    (async () => {
      try {
        let result: { success: boolean; message: string };

        // Input actions (1, 2, continue, push) are handled locally for speed
        if (INPUT_ACTIONS.has(actionType)) {
          console.log(`Input action ${actionType} on ${termType} - handling locally`);
          result = await executeFocus(session, actionType);
        } else if (termType && MAC_FOCUS_TYPES.has(termType)) {
          // Focus action on Mac-focused session - route to Mac's tunnel
          const macTunnelUrl = loadMacTunnelUrl();
          if (macTunnelUrl && session.focus_url) {
            console.log(`Focus action routing ${termType} to Mac: ${macTunnelUrl}`);
            result = await forwardToMac(macTunnelUrl, session.focus_url, actionType);
          } else {
            // No Mac tunnel or no focus_url - try local (might work if we're on Mac)
            result = await executeFocus(session, actionType);
          }
        } else {
          // Remote session or unknown - handle locally
          result = await executeFocus(session, actionType);
        }

        console.log(`Focus result for ${sessionId}/${actionType}:`, result);
        if (!result.success) {
          console.error(`Action ${actionType} failed:`, result.message);
        }
      } catch (error) {
        console.error(`Background action ${actionType} error:`, error);
      }
    })();
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
        let messageText = event.text || '';

        console.log(`Thread reply received: thread_ts=${threadTs}, text="${messageText}", files=${event.files?.length || 0}`);

        // Look up thread info
        const threadInfo = loadThreadInfo(threadTs);
        if (!threadInfo) {
          console.log(`No thread mapping found for ${threadTs}`);
          res.status(200).send();
          return;
        }

        // Handle file attachments (images, etc.)
        if (event.files && event.files.length > 0) {
          const botToken = loadBotToken();
          if (botToken) {
            const filePaths: string[] = [];
            for (const file of event.files as SlackFile[]) {
              console.log(`Downloading file: ${file.name} (${file.mimetype})`);
              const filePath = await downloadSlackFile(file, botToken);
              if (filePath) {
                filePaths.push(filePath);
              }
            }
            // Append file paths to message
            if (filePaths.length > 0) {
              const fileList = filePaths.map((p) => `[File: ${p}]`).join('\n');
              messageText = messageText ? `${messageText}\n${fileList}` : fileList;
            }
          } else {
            console.log('No bot token available, cannot download files');
            messageText = messageText
              ? `${messageText}\n[Files attached but could not be downloaded - no bot token]`
              : '[Files attached but could not be downloaded - no bot token]';
          }
        }

        // Skip if no content to send
        if (!messageText) {
          console.log('No message content to send');
          res.status(200).send();
          return;
        }

        // Use focus executor to send the text
        const focusUrl = threadInfo.focus_url;
        console.log(`Sending thread reply to: ${focusUrl}`);

        // Execute with the text as a custom input
        const result = await executeFocusUrl(`${focusUrl}?text=${encodeURIComponent(messageText)}`, 'focus');
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
