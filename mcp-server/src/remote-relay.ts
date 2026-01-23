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
const SLACK_DOWNLOADS_DIR = join(CLAUDE_DIR, 'slack-downloads');
const SLACK_CONFIG_PATH = join(CLAUDE_DIR, '.slack-config');

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

// Check if focus URL is for a remote session (handled locally on this server)
// vs Mac session (should be proxied to Mac)
function isRemoteSessionUrl(focusUrl: string): boolean {
  const remoteTypes = ['ssh-linked', 'ssh-tmux', 'jupyter-tmux', 'linux-tmux', 'tmux'];
  const path = focusUrl.replace('claude-focus://', '');
  const urlType = path.split('/')[0];
  return remoteTypes.includes(urlType);
}

// Extract tmux target from focus URL
// Supported formats:
// - claude-focus://ssh-linked/LINK_ID/HOST/USER/PORT/TMUX_TARGET
// - claude-focus://jupyter-tmux/LINK_ID/HOST/USER/PORT/TMUX_TARGET
// - claude-focus://ssh-tmux/HOST/USER/PORT/TMUX_TARGET
// - claude-focus://linux-tmux/TTY/TMUX_TARGET
// - claude-focus://tmux/TMUX_TARGET
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

    // linux-tmux has tmux target as last segment: linux-tmux/dev/pts/X/tmux_target
    // (TTY path like /dev/pts/0 contains slashes, so tmux target is always last)
    // Minimum: linux-tmux + 2 parts for tty (like dev/tty1) + tmux_target = 4 parts
    if (parts[0] === 'linux-tmux' && parts.length >= 4) {
      const target = decodeURIComponent(parts[parts.length - 1]);
      return target || null; // Return null if empty string
    }

    // tmux has tmux target as 2nd segment (index 1): tmux/tmux_target
    if (parts[0] === 'tmux' && parts.length >= 2) {
      const target = decodeURIComponent(parts[1]);
      return target || null; // Return null if empty string
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
        // Step 3: Send Enter
        // NOTE: Removed Escape key - it was interrupting Claude Code.
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

// Sessions directory for session info lookup
const INSTANCES_DIR = join(CLAUDE_DIR, 'instances');

// Load session info by session ID
function loadSessionInfo(sessionId: string): { focus_url: string; term_type: string } | null {
  const sessionFile = join(INSTANCES_DIR, `${sessionId}.json`);
  if (!existsSync(sessionFile)) {
    return null;
  }
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const data = JSON.parse(content);
    return { focus_url: data.focus_url, term_type: data.term_type };
  } catch {
    return null;
  }
}

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
        let messageText = event.text || '';

        console.log(`Thread reply received: thread_ts=${threadTs}, text="${messageText}", files=${event.files?.length || 0}`);

        // Look up thread info
        const threadInfo = loadThreadInfo(threadTs);
        if (!threadInfo) {
          console.log(`No thread mapping found for ${threadTs}, trying Mac...`);

          // Try to forward to Mac - it might have the thread mapping
          const macUrl = await checkMacReachable();
          if (macUrl) {
            try {
              console.log(`Forwarding event to Mac: ${macUrl}/slack/events`);
              const proxyResponse = await fetch(`${macUrl}/slack/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (proxyResponse.ok) {
                console.log('Successfully forwarded event to Mac');
              } else {
                console.log(`Mac returned ${proxyResponse.status}`);
              }
            } catch (proxyError) {
              console.log('Failed to forward to Mac:', proxyError);
            }
          } else {
            console.log('Mac not reachable, cannot deliver thread reply');
          }

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

        // For remote session URLs (ssh-linked, ssh-tmux, etc.), handle locally
        // Thread files are on this server, and tmux is here too
        // Only proxy to Mac for Mac-native URLs (iterm2, terminal)
        if (isRemoteSessionUrl(threadInfo.focus_url)) {
          console.log('Remote session URL, handling locally');
          const result = await sendTmuxInput(tmuxTarget, messageText);
          console.log('Thread reply sent to tmux:', result);
          res.status(200).send();
          return;
        }

        // For Mac session URLs, proxy to Mac if reachable
        const macUrl = await checkMacReachable();
        if (macUrl) {
          console.log('Mac session URL, proxying event...');
          try {
            const proxyResponse = await fetch(`${macUrl}/slack/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (proxyResponse.ok) {
              console.log('Successfully proxied event to Mac');
              res.status(200).send();
              return;
            }
            console.log('Proxy response not ok, cannot deliver to Mac session');
          } catch (proxyError) {
            console.log('Proxy to Mac failed:', proxyError);
          }
        } else {
          console.log('Mac not reachable, cannot deliver to Mac session');
        }
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

    console.log(`Received action: ${actionType} for value: ${firstPart}`);

    // FIRST: Check if Mac is reachable - Mac can handle ALL button formats
    const macUrl = await checkMacReachable();

    if (macUrl) {
      // Proxy to Mac for full experience (Focus + input)
      // Mac's MCP server handles both session_id and url: formats
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

    // Try to get focus URL either from url: prefix or from session file lookup
    let focusUrl: string;

    if (firstPart.startsWith('url:')) {
      // Direct URL format - use it directly
      focusUrl = firstPart.substring(4); // Remove "url:" prefix
    } else {
      // Session ID format - try to load session file locally
      console.log(`Looking up session file for: ${firstPart}`);
      const sessionInfo = loadSessionInfo(firstPart);
      if (sessionInfo?.focus_url) {
        console.log(`Found session with focus_url: ${sessionInfo.focus_url}`);
        focusUrl = sessionInfo.focus_url;
      } else {
        // No session file found locally - cannot handle
        console.log('Session not found locally - cannot handle (Mac not reachable)');
        res.json({
          response_type: 'ephemeral',
          text: '⚠️ Session not found - Mac tunnel not running and session file missing',
        });
        return;
      }
    }

    // Handle locally - Focus requires Mac, other actions work via tmux
    if (actionType === 'focus') {
      console.log('Focus action - Mac not reachable, returning ephemeral error');
      res.json({
        response_type: 'ephemeral',
        text: '⚠️ Focus unavailable - Mac tunnel not running\nOther buttons (1, 2, Continue, Push) still work.',
      });
      return;
    }

    // Extract tmux target and send input locally
    const tmuxTarget = extractTmuxTarget(focusUrl);
    if (!tmuxTarget) {
      console.error('Could not extract tmux target from URL:', focusUrl);
      res.json({
        response_type: 'ephemeral',
        text: '⚠️ Could not determine terminal session',
      });
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

export { app, extractTmuxTarget, getActionInput, INSTANCES_DIR, loadSessionInfo, sendTmuxInput };
