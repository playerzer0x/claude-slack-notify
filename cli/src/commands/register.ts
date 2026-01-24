/**
 * Register Command
 *
 * Registers the current session for Slack notifications.
 * Creates an instance file in ~/.claude/instances/.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

import {
  buildFocusUrl,
  detectTerminalEnv,
  getClaudeDir,
  getInstancesDir,
  isMac,
  isSSHSession,
  type FocusUrlParams,
  type TerminalEnv,
} from '../lib/index.js';

/** Word lists for generating memorable names */
const ADJECTIVES = [
  'red', 'blue', 'green', 'purple', 'orange', 'silver', 'golden', 'cosmic',
  'swift', 'bright', 'dark', 'wild', 'calm', 'bold', 'quick',
];
const NOUNS = [
  'wolf', 'hawk', 'bear', 'lion', 'tiger', 'eagle', 'falcon', 'dragon',
  'phoenix', 'raven', 'fox', 'panther', 'cobra', 'shark', 'storm',
];
const COLORS = [
  'amber', 'coral', 'jade', 'ruby', 'onyx', 'ivory', 'copper', 'bronze',
  'teal', 'indigo', 'crimson', 'azure', 'scarlet', 'violet', 'emerald',
];
const ITEMS = [
  'coffee', 'thunder', 'shadow', 'crystal', 'ember', 'breeze', 'river',
  'mountain', 'forest', 'ocean', 'sunrise', 'comet', 'glacier', 'canyon', 'meadow',
];

/** Generate a random 4-word instance name */
function generateInstanceName(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(COLORS)}-${pick(ITEMS)}`;
}

/** Generate a unique session ID */
function generateSessionId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Instance data stored in ~/.claude/instances/*.json
 */
export interface InstanceData {
  id: string;
  name: string;
  hostname: string;
  term_type: string;
  term_target: string;
  focus_url: string;
  link_id?: string;
  ssh_host?: string;
  ssh_user?: string;
  ssh_port?: number;
  registered_at: string;
}

/**
 * Terminal detection result.
 */
export interface TerminalInfo {
  type: string;
  target: string;
  focusUrl: string;
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  linkId?: string;
}

/**
 * Detect the current terminal environment and build focus URL.
 */
export function detectTerminal(env: TerminalEnv): TerminalInfo {
  const result: TerminalInfo = {
    type: 'unknown',
    target: '',
    focusUrl: '',
  };

  // Check for local-tmux session (started via claude-slack-notify launch)
  const tmuxSession = env.claudeTmuxSession;
  const tmuxTarget = env.claudeTmuxTarget || `${tmuxSession}:0.0`;

  if (tmuxSession) {
    result.type = 'local-tmux';
    result.target = tmuxTarget;

    const params: FocusUrlParams = {
      type: 'local-tmux',
      tmuxTarget,
    };

    // Include iTerm session ID if available
    if (env.claudeItermSessionId) {
      params.itermSessionId = env.claudeItermSessionId;
    }

    result.focusUrl = buildFocusUrl(params);
    return result;
  }

  // Check for SSH-linked session (via claude-slack-notify remote)
  if (env.claudeLinkId) {
    const sshUser = process.env.USER || 'unknown';
    const sshHost = env.claudeSshHost || hostname();
    const sshPort = parseInt(env.claudeSshPort || '22', 10);

    result.linkId = env.claudeLinkId;
    result.sshHost = sshHost;
    result.sshUser = sshUser;
    result.sshPort = sshPort;

    // Get tmux target if available
    const remoteTmuxTarget = env.tmuxPane
      ? `${env.tmux?.split(',')[0] || 'session'}:${env.tmuxPane}`
      : 'session:0.0';

    if (isSSHSession()) {
      result.type = 'ssh-linked';
      result.target = `${env.claudeLinkId}|${sshHost}|${sshUser}|${sshPort}|${remoteTmuxTarget}`;
      result.focusUrl = buildFocusUrl({
        type: 'ssh-linked',
        linkId: env.claudeLinkId,
        host: sshHost,
        user: sshUser,
        port: sshPort,
        tmuxTarget: remoteTmuxTarget,
      });
    } else {
      // JupyterLab or similar (has link ID but no SSH connection)
      result.type = 'jupyter-tmux';
      result.target = `${env.claudeLinkId}|${sshHost}|${sshUser}|${sshPort}|${remoteTmuxTarget}`;
      result.focusUrl = buildFocusUrl({
        type: 'jupyter-tmux',
        linkId: env.claudeLinkId,
        host: sshHost,
        user: sshUser,
        port: sshPort,
        tmuxTarget: remoteTmuxTarget,
      });
    }
    return result;
  }

  // Check for SSH session without link
  if (isSSHSession()) {
    const sshUser = process.env.USER || 'unknown';
    const sshHost = env.claudeSshHost || hostname();
    const sshPort = parseInt(env.claudeSshPort || '22', 10);

    result.sshHost = sshHost;
    result.sshUser = sshUser;
    result.sshPort = sshPort;

    if (env.tmux) {
      const remoteTmuxTarget = env.tmuxPane
        ? `${env.tmux.split(',')[0] || 'session'}:${env.tmuxPane}`
        : 'session:0.0';

      result.type = 'ssh-tmux';
      result.target = `${sshHost}|${sshUser}|${sshPort}|${remoteTmuxTarget}`;
      result.focusUrl = buildFocusUrl({
        type: 'ssh-tmux',
        host: sshHost,
        user: sshUser,
        port: sshPort,
        tmuxTarget: remoteTmuxTarget,
      });
    } else {
      result.type = 'ssh';
      result.target = `${sshHost}|${sshUser}|${sshPort}`;
      // No focus URL for SSH without tmux
    }
    return result;
  }

  // macOS terminal detection
  if (isMac()) {
    if (env.tmux) {
      // Inside tmux on Mac
      const tmuxTargetStr = env.tmuxPane || '0.0';

      if (env.itermSessionId) {
        result.type = 'iterm-tmux';
        result.target = `${tmuxTargetStr}`;
        result.focusUrl = buildFocusUrl({
          type: 'iterm-tmux',
          tty: '/dev/ttys000', // placeholder, will be updated
          tmuxTarget: tmuxTargetStr,
        });
      } else {
        result.type = 'tmux';
        result.target = tmuxTargetStr;
        result.focusUrl = buildFocusUrl({
          type: 'tmux',
          tmuxTarget: tmuxTargetStr,
        });
      }
    } else if (env.itermSessionId) {
      result.type = 'iterm2';
      result.target = env.itermSessionId;
      result.focusUrl = buildFocusUrl({
        type: 'iterm2',
        itermSessionId: env.itermSessionId,
      });
    } else if (env.termProgram === 'Apple_Terminal') {
      result.type = 'terminal';
      result.target = 'frontmost';
      result.focusUrl = buildFocusUrl({
        type: 'terminal',
        tty: 'frontmost',
      });
    }
    return result;
  }

  // Linux terminal detection
  if (env.tmux) {
    const tmuxTargetStr = env.tmuxPane || '0.0';
    result.type = 'linux-tmux';
    result.target = tmuxTargetStr;
    result.focusUrl = buildFocusUrl({
      type: 'tmux',
      tmuxTarget: tmuxTargetStr,
    });
  }

  return result;
}

/**
 * Find existing instance name for a terminal target.
 */
function findExistingName(instancesDir: string, termTarget: string): string | null {
  if (!termTarget || !existsSync(instancesDir)) {
    return null;
  }

  const files = readdirSync(instancesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(instancesDir, file), 'utf-8');
      const data = JSON.parse(content) as InstanceData;
      if (data.term_target === termTarget) {
        return data.name;
      }
    } catch {
      // Skip invalid files
    }
  }

  return null;
}

/**
 * Clean up old session files for a terminal target.
 */
function cleanupOldSessions(instancesDir: string, termTarget: string): void {
  if (!termTarget || !existsSync(instancesDir)) {
    return;
  }

  const files = readdirSync(instancesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = join(instancesDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as InstanceData;
      if (data.term_target === termTarget) {
        rmSync(filePath);
      }
    } catch {
      // Skip invalid files
    }
  }
}

export interface RegisterOptions {
  name?: string;
}

export interface RegisterResult {
  instanceId: string;
  instanceName: string;
  instanceFile: string;
}

/**
 * Register the current session.
 */
export async function register(options: RegisterOptions = {}): Promise<RegisterResult> {
  const instancesDir = getInstancesDir();
  mkdirSync(instancesDir, { recursive: true });

  // Detect terminal environment
  const termEnv = detectTerminalEnv();
  const termInfo = detectTerminal(termEnv);

  // Phase 1: Find existing name for this terminal
  const preservedName = findExistingName(instancesDir, termInfo.target);

  // Phase 2: Clean up old sessions for this terminal
  cleanupOldSessions(instancesDir, termInfo.target);

  // Phase 3: Determine instance name
  let instanceName = options.name;
  if (!instanceName && process.env.CLAUDE_INSTANCE_NAME) {
    instanceName = process.env.CLAUDE_INSTANCE_NAME;
  }
  if (!instanceName && preservedName) {
    instanceName = preservedName;
  }
  if (!instanceName) {
    instanceName = generateInstanceName();
  }

  // Generate session ID
  const instanceId = process.env.CLAUDE_INSTANCE_ID || generateSessionId();

  // Build instance data
  const instanceData: InstanceData = {
    id: instanceId,
    name: instanceName,
    hostname: hostname(),
    term_type: termInfo.type,
    term_target: termInfo.target,
    focus_url: termInfo.focusUrl,
    registered_at: new Date().toISOString(),
  };

  // Add SSH-specific fields
  if (termInfo.linkId) {
    instanceData.link_id = termInfo.linkId;
  }
  if (termInfo.sshHost) {
    instanceData.ssh_host = termInfo.sshHost;
    instanceData.ssh_user = termInfo.sshUser;
    instanceData.ssh_port = termInfo.sshPort;
  }

  // Write instance file
  const instanceFile = join(instancesDir, `${instanceId}.json`);
  writeFileSync(instanceFile, JSON.stringify(instanceData, null, 2));

  return {
    instanceId,
    instanceName,
    instanceFile,
  };
}

/**
 * CLI handler for register command.
 */
export async function registerCommand(options: RegisterOptions): Promise<void> {
  try {
    const result = await register(options);
    console.log(result.instanceName);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
