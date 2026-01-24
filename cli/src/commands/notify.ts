/**
 * Notify Command
 *
 * Sends a Slack notification for the current session.
 * Reads instance data and formats message with buttons.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

import {
  buildButtonValue,
  detectTerminalEnv,
  getClaudeDir,
  getInstancesDir,
  getSlackConfigPath,
  getThreadsDir,
  getTunnelUrlPath,
} from '../lib/index.js';

import { detectTerminal, type InstanceData } from './register.js';

/** Slack config from ~/.claude/.slack-config */
interface SlackConfig {
  SLACK_BOT_TOKEN?: string;
  SLACK_CHANNEL_ID?: string;
}

/** Options for notify command */
export interface NotifyOptions {
  message?: string;
  context?: string;
  status?: 'started' | 'waiting' | 'error' | 'completed';
}

/** Load Slack config from file */
function loadSlackConfig(): SlackConfig | null {
  const configPath = getSlackConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config: SlackConfig = {};

    // Parse shell-style config (VAR=value)
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+)=["']?(.+?)["']?$/);
      if (match) {
        const [, key, value] = match;
        if (key === 'SLACK_BOT_TOKEN') {
          config.SLACK_BOT_TOKEN = value;
        } else if (key === 'SLACK_CHANNEL_ID') {
          config.SLACK_CHANNEL_ID = value;
        }
      }
    }

    return config;
  } catch {
    return null;
  }
}

/** Load webhook URL */
function loadWebhookUrl(): string | null {
  const webhookFile = join(getClaudeDir(), 'slack-webhook-url');
  if (existsSync(webhookFile)) {
    return readFileSync(webhookFile, 'utf-8').trim();
  }
  return process.env.SLACK_WEBHOOK_URL || null;
}

/** Find instance by ID or terminal target */
function findInstance(instanceId?: string): InstanceData | null {
  const instancesDir = getInstancesDir();
  if (!existsSync(instancesDir)) {
    return null;
  }

  // Try by ID first
  if (instanceId) {
    const instanceFile = join(instancesDir, `${instanceId}.json`);
    if (existsSync(instanceFile)) {
      try {
        return JSON.parse(readFileSync(instanceFile, 'utf-8')) as InstanceData;
      } catch {
        // Fall through to terminal search
      }
    }
  }

  // Try by terminal target
  const termEnv = detectTerminalEnv();
  const termInfo = detectTerminal(termEnv);

  if (!termInfo.target) {
    return null;
  }

  const files = readdirSync(instancesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(instancesDir, file), 'utf-8');
      const data = JSON.parse(content) as InstanceData;

      // Match by tmux session name (handles window/pane changes)
      const ourSession = termInfo.target.split(':')[0].split('|').pop() || '';
      const candSession = data.term_target.split(':')[0].split('|').pop() || '';

      if (ourSession && candSession && ourSession === candSession) {
        return data;
      }
    } catch {
      // Skip invalid files
    }
  }

  return null;
}

/** Get color for status */
function getStatusColor(status: string): string {
  switch (status) {
    case 'started':
      return '#8B9A6B'; // warm olive-gold
    case 'waiting':
      return '#C9A66B'; // warm amber sand
    case 'error':
      return '#C47070'; // warm coral
    default:
      return '#B8A99A'; // sand/taupe
  }
}

/** Escape string for JSON embedding */
function jsonEscape(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Convert markdown to Slack mrkdwn */
function markdownToMrkdwn(str: string): string {
  // Convert **bold** to *bold*
  return str.replace(/\*\*([^*]+)\*\*/g, '*$1*');
}

/** Check if MCP server is running */
async function isMcpServerRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8463/health', {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Build button block for Slack message */
function buildButtonBlock(
  focusUrl: string,
  buttonValuePrefix: string,
  mcpServerRunning: boolean,
): string {
  // Default buttons
  const buttons = [
    { label: '1', action: '1' },
    { label: '2', action: '2' },
    { label: 'Continue', action: 'continue' },
    { label: 'Push', action: 'push' },
  ];

  // Build Focus button
  const focusButton = mcpServerRunning
    ? `{
          "type": "button",
          "text": { "type": "plain_text", "text": "Focus" },
          "style": "primary",
          "action_id": "session_focus",
          "value": "${jsonEscape(buttonValuePrefix)}|focus"
        }`
    : `{
          "type": "button",
          "text": { "type": "plain_text", "text": "Focus" },
          "url": "${jsonEscape(focusUrl)}",
          "style": "primary"
        }`;

  // Build action buttons
  const actionButtons = buttons
    .map((btn, i) => {
      if (mcpServerRunning) {
        return `{
          "type": "button",
          "text": { "type": "plain_text", "text": "${jsonEscape(btn.label)}" },
          "action_id": "session_action_${i}",
          "value": "${jsonEscape(buttonValuePrefix)}|${btn.action}"
        }`;
      } else {
        const actionUrl = `${focusUrl}?action=${encodeURIComponent(btn.action)}`;
        return `{
          "type": "button",
          "text": { "type": "plain_text", "text": "${jsonEscape(btn.label)}" },
          "url": "${jsonEscape(actionUrl)}"
        }`;
      }
    })
    .join(',\n        ');

  return `,{
      "type": "actions",
      "elements": [
        ${focusButton},
        ${actionButtons}
      ]
    }`;
}

/** Build notification payload */
function buildPayload(
  instanceName: string,
  location: string,
  message: string,
  color: string,
  buttonBlock: string,
): string {
  const safeInstanceName = jsonEscape(instanceName);
  const safeLocation = jsonEscape(location);
  const safeMessage = jsonEscape(markdownToMrkdwn(message));

  return `{
    "attachments": [
      {
        "fallback": "${safeInstanceName}: ${safeMessage}",
        "color": "${color}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*${safeInstanceName}* on \`${safeLocation}\`\\n${safeMessage}"
            }
          }${buttonBlock}
        ]
      }
    ]
  }`;
}

/** Send notification via Slack API */
async function sendViaApi(
  payload: string,
  config: SlackConfig,
  instanceId: string,
  focusUrl: string,
  instanceName: string,
): Promise<boolean> {
  const apiPayload = JSON.parse(payload);
  apiPayload.channel = config.SLACK_CHANNEL_ID;

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(apiPayload),
  });

  const result = (await response.json()) as { ok: boolean; ts?: string };

  if (result.ok && result.ts) {
    // Save thread mapping
    const threadsDir = getThreadsDir();
    mkdirSync(threadsDir, { recursive: true });

    const threadData = {
      thread_ts: result.ts,
      session_id: instanceId,
      focus_url: focusUrl,
      instance_name: instanceName,
      created: new Date().toISOString(),
    };

    writeFileSync(
      join(threadsDir, `${result.ts}.json`),
      JSON.stringify(threadData, null, 2),
    );

    return true;
  }

  return false;
}

/** Send notification via webhook */
async function sendViaWebhook(payload: string, webhookUrl: string): Promise<boolean> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload,
  });

  return response.ok;
}

/**
 * Send a Slack notification.
 */
export async function notify(options: NotifyOptions = {}): Promise<boolean> {
  const { message = 'Ready for input', context, status = 'waiting' } = options;

  // Find instance
  const instanceId = process.env.CLAUDE_INSTANCE_ID;
  const instance = findInstance(instanceId);

  // Get instance info (use detected values as fallback)
  const termEnv = detectTerminalEnv();
  const termInfo = detectTerminal(termEnv);

  const instanceName = instance?.name || 'Claude';
  const hostName = instance?.hostname || hostname();
  const termType = instance?.term_type || termInfo.type;
  const termTarget = instance?.term_target || termInfo.target;
  const focusUrl = instance?.focus_url || termInfo.focusUrl;

  // Build location string
  let location = hostName;
  if (termType && termType !== 'unknown') {
    const displayTarget = termTarget.includes('|')
      ? termTarget.split('|').pop() || termTarget
      : termTarget;

    switch (termType) {
      case 'iterm-tmux':
      case 'terminal-tmux':
      case 'wt-tmux':
      case 'wsl-tmux':
      case 'linux-tmux':
        location = `${hostName} (tmux ${displayTarget})`;
        break;
      default:
        location = `${hostName} (${termType})`;
    }
  }

  // Build message
  let fullMessage = message;
  if (context) {
    fullMessage = `${message}\n\n${context}`;
  }

  // Get color
  const color = getStatusColor(status);

  // Build button block if we have a focus URL
  let buttonBlock = '';
  if (focusUrl) {
    const mcpServerRunning =
      termType === 'ssh-linked' ||
      termType === 'jupyter-tmux' ||
      (await isMcpServerRunning());

    const buttonValuePrefix = focusUrl ? `url:${focusUrl}` : instanceId || '';
    buttonBlock = buildButtonBlock(focusUrl, buttonValuePrefix, mcpServerRunning);
  }

  // Build payload
  const payload = buildPayload(instanceName, location, fullMessage, color, buttonBlock);

  // Try API first, fall back to webhook
  const slackConfig = loadSlackConfig();
  const webhookUrl = loadWebhookUrl();

  if (slackConfig?.SLACK_BOT_TOKEN && slackConfig?.SLACK_CHANNEL_ID) {
    return sendViaApi(payload, slackConfig, instanceId || '', focusUrl, instanceName);
  } else if (webhookUrl) {
    return sendViaWebhook(payload, webhookUrl);
  }

  return false;
}

/**
 * CLI handler for notify command.
 */
export async function notifyCommand(options: NotifyOptions): Promise<void> {
  try {
    const success = await notify(options);
    if (!success) {
      console.error('Failed to send notification');
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
