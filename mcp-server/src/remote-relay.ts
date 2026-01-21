/**
 * Remote Relay for Slack Button Commands
 *
 * A lightweight webhook receiver that runs on Linux servers (in tmux).
 * Auto-detects whether Mac MCP server is reachable:
 * - If Mac is up: proxies to Mac for full experience (Focus + input)
 * - If Mac is down: handles locally via tmux send-keys (input only)
 *
 * Usage: node remote-relay.js
 * Port: 8464 (different from MCP server's 8463)
 */

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';

const PORT = 8464;
const CLAUDE_DIR = join(homedir(), '.claude');
const PID_FILE = join(CLAUDE_DIR, '.remote-relay.pid');
const PORT_FILE = join(CLAUDE_DIR, '.remote-relay.port');
const MAC_TUNNEL_URL_FILE = join(CLAUDE_DIR, '.mac-tunnel-url');
const ACTIVITY_FILE = join(CLAUDE_DIR, '.relay-last-activity');
const SIGNING_SECRET_PATH = join(CLAUDE_DIR, 'slack-signing-secret');

const REPLAY_WINDOW_SECONDS = 300; // 5 minutes

// Valid focus actions
type FocusAction = 'focus' | '1' | '2' | 'continue' | 'push';

const VALID_ACTIONS = new Set<FocusAction>(['1', '2', 'continue', 'push', 'focus']);

// Map action to input text
function getActionInput(action: FocusAction): string {
  switch (action) {
    case '1':
      return '1';
    case '2':
      return '2';
    case 'continue':
      return 'Continue';
    case 'push':
      return '/push';
    default:
      return '';
  }
}

// Extract tmux target from focus URL
// Format: claude-focus://ssh-linked/LINK_ID/HOST/USER/PORT/TMUX_TARGET
// or: claude-focus://jupyter-tmux/LINK_ID/HOST/USER/PORT/TMUX_TARGET
function extractTmuxTarget(focusUrl: string): string | null {
  try {
    // Remove claude-focus:// prefix
    const path = focusUrl.replace('claude-focus://', '');
    const parts = path.split('/');

    // ssh-linked and jupyter-tmux have tmux target as 6th segment (index 5)
    if ((parts[0] === 'ssh-linked' || parts[0] === 'jupyter-tmux') && parts.length >= 6) {
      return decodeURIComponent(parts[5]);
    }

    // ssh-tmux has tmux target as 5th segment (index 4)
    if (parts[0] === 'ssh-tmux' && parts.length >= 5) {
      return decodeURIComponent(parts[4]);
    }

    return null;
  } catch {
    return null;
  }
}

// Send input to local tmux session
async function sendTmuxInput(tmuxTarget: string, input: string): Promise<{ success: boolean; message: string }> {
  if (!input || !tmuxTarget) {
    return { success: false, message: 'Missing input or tmux target' };
  }

  console.log(`Sending input to local tmux ${tmuxTarget}: ${input}`);

  return new Promise((resolve) => {
    // Step 1: Send text in literal mode
    const sendKeys = spawn('tmux', ['send-keys', '-t', tmuxTarget, '-l', input], { stdio: 'pipe' });

    sendKeys.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, message: `tmux send-keys failed with code ${code}` });
        return;
      }

      // Step 2: Wait for paste to complete
      setTimeout(() => {
        // Step 3: Send Escape to exit vim INSERT mode if enabled
        const escape = spawn('tmux', ['send-keys', '-t', tmuxTarget, 'Escape'], { stdio: 'pipe' });
        escape.on('close', () => {
          setTimeout(() => {
            // Step 4: Send Enter
            const enter = spawn('tmux', ['send-keys', '-t', tmuxTarget, 'Enter'], { stdio: 'pipe' });
            enter.on('close', (enterCode) => {
              if (enterCode === 0) {
                resolve({ success: true, message: `Sent "${input}" to tmux ${tmuxTarget}` });
              } else {
                resolve({ success: false, message: `tmux Enter failed with code ${enterCode}` });
              }
            });
            enter.on('error', (err) => {
              resolve({ success: false, message: `tmux Enter error: ${err.message}` });
            });
          }, 100);
        });
        escape.on('error', () => {
          // Escape failed, continue anyway
        });
      }, 200);
    });

    sendKeys.on('error', (err) => {
      resolve({ success: false, message: `tmux error: ${err.message}` });
    });
  });
}

// Check if Mac MCP server is reachable
async function checkMacReachable(): Promise<string | null> {
  if (!existsSync(MAC_TUNNEL_URL_FILE)) {
    return null;
  }

  try {
    const macUrl = readFileSync(MAC_TUNNEL_URL_FILE, 'utf-8').trim();
    if (!macUrl) {
      return null;
    }

    // Try to reach the health endpoint with a short timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    try {
      const response = await fetch(`${macUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return macUrl;
      }
    } catch {
      clearTimeout(timeout);
    }

    return null;
  } catch {
    return null;
  }
}

// Proxy request to Mac MCP server
async function proxyToMac(macUrl: string, rawBody: string, headers: Record<string, string>): Promise<boolean> {
  try {
    console.log(`Proxying to Mac: ${macUrl}/slack/actions`);

    const response = await fetch(`${macUrl}/slack/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': headers['x-slack-request-timestamp'] || '',
        'X-Slack-Signature': headers['x-slack-signature'] || '',
      },
      body: rawBody,
    });

    return response.ok;
  } catch (error) {
    console.error('Proxy to Mac failed:', error);
    return false;
  }
}

// Slack signature verification
function getSigningSecret(): string | null {
  if (!existsSync(SIGNING_SECRET_PATH)) {
    return null;
  }
  return readFileSync(SIGNING_SECRET_PATH, 'utf-8').trim();
}

function computeSignature(secret: string, timestamp: string, body: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  const hash = createHmac('sha256', secret).update(baseString).digest('hex');
  return `v0=${hash}`;
}

function verifySlackSignature(req: Request, res: Response, next: NextFunction): void {
  const signingSecret = getSigningSecret();

  // If no signing secret configured, skip verification (development mode)
  if (!signingSecret) {
    console.warn('Slack signing secret not configured, skipping verification');
    next();
    return;
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !signature) {
    res.status(401).send('Missing Slack headers');
    return;
  }

  // Check timestamp to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > REPLAY_WINDOW_SECONDS) {
    res.status(401).send('Request timestamp too old');
    return;
  }

  // Compute and compare signatures
  const rawBody = (req as Request & { rawBody?: string }).rawBody || '';
  const expectedSignature = computeSignature(signingSecret, timestamp, rawBody);

  if (expectedSignature !== signature) {
    console.error('Slack signature mismatch');
    res.status(401).send('Invalid signature');
    return;
  }

  next();
}

// Touch activity file to reset idle timeout
function touchActivityFile(): void {
  try {
    writeFileSync(ACTIVITY_FILE, '');
  } catch {
    // Ignore errors
  }
}

// Create Express app
const app = express();

// Capture raw body for Slack signature verification
// Actions endpoint uses URL-encoded, Events endpoint uses JSON
app.use('/slack', (req, _res, next) => {
  let data = '';
  req.on('data', (chunk: Buffer) => {
    data += chunk.toString();
  });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;

    // Parse based on content type
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      try {
        req.body = JSON.parse(data);
      } catch {
        req.body = {};
      }
    } else {
      // URL-encoded form data
      const params = new URLSearchParams(data);
      req.body = Object.fromEntries(params.entries());
    }
    next();
  });
});

// Threads directory for reply routing
const THREADS_DIR = join(CLAUDE_DIR, 'threads');

// Load thread info by thread_ts
function loadThreadInfo(threadTs: string): { focus_url: string; term_type: string } | null {
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

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mode: 'remote-relay', timestamp: new Date().toISOString() });
});

// Slack Events endpoint (for thread replies)
app.post('/slack/events', async (req: Request, res: Response) => {
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

      // Only handle message events in threads (replies)
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

        // Extract tmux target from focus URL
        const tmuxTarget = extractTmuxTarget(threadInfo.focus_url);
        if (!tmuxTarget) {
          console.log(`Could not extract tmux target from ${threadInfo.focus_url}`);
          res.status(200).send();
          return;
        }

        // Check if Mac is reachable and proxy if so
        const macUrl = await checkMacReachable();
        if (macUrl) {
          console.log('Mac is reachable, proxying event...');
          try {
            await fetch(`${macUrl}/slack/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          } catch {
            // Fall through to local handling
          }
        }

        // Send text to tmux
        const result = await sendTmuxInput(tmuxTarget, text);
        console.log('Thread reply sent to tmux:', result);
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

// Slack actions endpoint
app.post('/slack/actions', verifySlackSignature, async (req: Request, res: Response) => {
  touchActivityFile();

  // Always return 200 to acknowledge receipt
  const ack = () => res.status(200).send();

  try {
    const payloadStr = req.body.payload;
    if (!payloadStr) {
      res.status(400).send('Missing payload');
      return;
    }

    const payload = JSON.parse(payloadStr);

    if (payload.type !== 'block_actions' || !payload.actions?.length) {
      ack();
      return;
    }

    const action = payload.actions[0];
    const pipeIndex = action.value.lastIndexOf('|');
    if (pipeIndex === -1) {
      console.error('Invalid action value format (no pipe):', action.value);
      ack();
      return;
    }

    const firstPart = action.value.substring(0, pipeIndex);
    const actionType = action.value.substring(pipeIndex + 1);

    if (!VALID_ACTIONS.has(actionType as FocusAction)) {
      console.error('Invalid action type:', actionType);
      ack();
      return;
    }

    // Check if this is a direct URL format
    if (!firstPart.startsWith('url:')) {
      console.error('Non-URL format not supported on remote relay:', firstPart);
      ack();
      return;
    }

    const focusUrl = firstPart.substring(4); // Remove "url:" prefix
    console.log(`Received action: ${actionType} for URL: ${focusUrl}`);

    // Check if Mac is reachable
    const macUrl = await checkMacReachable();

    if (macUrl) {
      // Proxy to Mac for full experience (Focus + input)
      console.log('Mac is reachable, proxying request...');
      const rawBody = (req as Request & { rawBody?: string }).rawBody || '';
      const headers = {
        'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'] as string,
        'x-slack-signature': req.headers['x-slack-signature'] as string,
      };

      const proxySuccess = await proxyToMac(macUrl, rawBody, headers);
      if (proxySuccess) {
        console.log('Successfully proxied to Mac');
        ack();
        return;
      }
      console.log('Proxy failed, falling back to local handling');
    }

    // Handle locally - Focus is a no-op, but we can send input
    if (actionType === 'focus') {
      console.log('Focus action - no-op on remote (Mac not reachable)');
      ack();
      return;
    }

    // Extract tmux target and send input locally
    const tmuxTarget = extractTmuxTarget(focusUrl);
    if (!tmuxTarget) {
      console.error('Could not extract tmux target from URL:', focusUrl);
      ack();
      return;
    }

    const input = getActionInput(actionType as FocusAction);
    if (input) {
      const result = await sendTmuxInput(tmuxTarget, input);
      console.log('Local tmux result:', result);
    }

    ack();
  } catch (error) {
    console.error('Error handling Slack action:', error);
    ack();
  }
});

function writeRuntimeFiles(): void {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true });
    }
    writeFileSync(PID_FILE, process.pid.toString());
    writeFileSync(PORT_FILE, PORT.toString());
    console.log(`PID file written: ${PID_FILE}`);
    console.log(`Port file written: ${PORT_FILE}`);
  } catch (error) {
    console.error('Error writing runtime files:', error);
  }
}

export function startRelay(): void {
  app.listen(PORT, () => {
    console.log(`Remote relay listening on port ${PORT}`);
    writeRuntimeFiles();
    touchActivityFile();
  });
}

process.on('SIGINT', () => {
  console.log('Shutting down remote relay...');
  process.exit(0);
});

// Run if executed directly
const isMain = process.argv[1]?.endsWith('remote-relay.js');
if (isMain) {
  startRelay();
}

export { app, extractTmuxTarget, getActionInput, sendTmuxInput };
