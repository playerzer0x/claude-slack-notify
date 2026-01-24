/**
 * Remote Command
 *
 * On Mac: SSH to a saved remote host with tmux session linking.
 * On Linux: Start remote-tunnel and register session.
 */

import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { buildFocusUrl, getClaudeDir, getLinksDir, isMac, isLinux, isInsideTmux } from '../lib/index.js';

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

/** Generate a random instance name */
function generateInstanceName(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(COLORS)}-${pick(ITEMS)}`;
}

/** Generate a random link ID */
function generateLinkId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Sanitize hostname for use as filename */
function sanitizeHostname(host: string): string {
  let safe = host.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (safe.length > 50) {
    const crypto = require('node:crypto');
    const hash = crypto.createHash('md5').update(host).digest('hex').slice(0, 8);
    safe = `${safe.slice(0, 50)}_${hash}`;
  }
  return safe;
}

/** Prompt for input */
async function prompt(message: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Wait for user to press Enter */
async function waitForEnter(message: string = 'Press Enter to continue...'): Promise<void> {
  await prompt(message);
}

/** Detect local terminal for Focus button */
function detectLocalTerminal(): { type: string; target: string; focusUrl: string } {
  const result = { type: 'unknown', target: '', focusUrl: '' };

  if (isInsideTmux()) {
    // Inside tmux on Mac
    try {
      const session = execSync("tmux display-message -p '#{session_name}'", {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const window = execSync("tmux display-message -p '#{window_index}'", {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const pane = execSync("tmux display-message -p '#{pane_index}'", {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const clientTty = execSync("tmux display-message -p '#{client_tty}'", {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const clientTermtype = execSync("tmux display-message -p '#{client_termtype}'", {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const tmuxTarget = `${session}:${window}.${pane}`;
      const termApp = clientTermtype.includes('iTerm') || process.env.ITERM_SESSION_ID ? 'iterm' : 'terminal';

      if (clientTty) {
        result.type = `${termApp}-tmux`;
        result.target = `${clientTty}|${tmuxTarget}`;
        result.focusUrl = buildFocusUrl({
          type: termApp === 'iterm' ? 'iterm-tmux' : 'terminal',
          tty: clientTty,
          tmuxTarget,
        });
      } else {
        result.type = 'tmux';
        result.target = tmuxTarget;
        result.focusUrl = buildFocusUrl({ type: 'tmux', tmuxTarget });
      }
    } catch {
      // Fall through to other detection
    }
  } else if (process.env.ITERM_SESSION_ID) {
    const sessionId = process.env.ITERM_SESSION_ID.split(':')[1] || process.env.ITERM_SESSION_ID;
    result.type = 'iterm2';
    result.target = sessionId;
    result.focusUrl = buildFocusUrl({ type: 'iterm2', itermSessionId: sessionId });
  } else if (process.env.__CFBundleIdentifier === 'com.apple.Terminal' || process.env.TERM_PROGRAM === 'Apple_Terminal') {
    try {
      const tty = execSync('tty', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (tty && tty !== 'not a tty') {
        result.type = 'terminal';
        result.target = tty;
        result.focusUrl = buildFocusUrl({ type: 'terminal', tty });
      }
    } catch {
      result.type = 'terminal';
      result.target = 'frontmost';
      result.focusUrl = buildFocusUrl({ type: 'terminal', tty: 'frontmost' });
    }
  }

  return result;
}

/** Check if tunnel is healthy */
async function isTunnelHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Ensure local tunnel is running and healthy */
async function ensureTunnel(): Promise<string | null> {
  const claudeDir = getClaudeDir();
  const localTunnel = join(claudeDir, 'bin', 'local-tunnel');
  const tunnelUrlFile = join(claudeDir, '.tunnel-url');

  if (!existsSync(localTunnel)) {
    return null;
  }

  // Check if existing tunnel is healthy
  if (existsSync(tunnelUrlFile)) {
    const url = readFileSync(tunnelUrlFile, 'utf-8').trim();
    if (url && (await isTunnelHealthy(url))) {
      return url;
    }
  }

  console.log('Local tunnel not healthy, restarting...');

  // Stop existing tunnel
  try {
    execSync(`"${localTunnel}" --stop`, { stdio: 'pipe' });
  } catch {
    // Ignore
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start tunnel
  spawn(localTunnel, ['--background'], { detached: true, stdio: 'ignore' }).unref();

  // Wait for tunnel to be ready
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (existsSync(tunnelUrlFile)) {
      const url = readFileSync(tunnelUrlFile, 'utf-8').trim();
      if (url && (await isTunnelHealthy(url))) {
        console.log(`Local tunnel ready: ${url}`);
        return url;
      }
    }
  }

  console.log('Warning: Tunnel may not be ready. Focus buttons might not work.');
  return null;
}

/** Sync Slack config to remote */
function syncSlackConfig(remoteHost: string): void {
  const claudeDir = getClaudeDir();
  const configFile = join(claudeDir, '.slack-config');

  if (!existsSync(configFile)) {
    return;
  }

  console.log('');
  console.log(`Syncing Slack config to ${remoteHost}...`);

  try {
    execSync(`scp -q "${configFile}" "${remoteHost}:~/.claude/"`, { stdio: 'pipe' });
    console.log('  OK .slack-config');

    const webhookFile = join(claudeDir, 'slack-webhook-url');
    if (existsSync(webhookFile)) {
      execSync(`scp -q "${webhookFile}" "${remoteHost}:~/.claude/"`, { stdio: 'pipe' });
      console.log('  OK slack-webhook-url');
    }

    const secretFile = join(claudeDir, 'slack-signing-secret');
    if (existsSync(secretFile)) {
      execSync(`scp -q "${secretFile}" "${remoteHost}:~/.claude/"`, { stdio: 'pipe' });
      console.log('  OK slack-signing-secret');
    }
  } catch (error) {
    console.log('  Warning: Failed to sync some config files');
  }
}

/** Options for remote command */
export interface RemoteOptions {
  host?: string;
  session?: string;
  new?: boolean;
}

/**
 * Handle Mac remote command - SSH to remote with session linking.
 */
async function remoteMac(options: RemoteOptions): Promise<void> {
  const claudeDir = getClaudeDir();
  const remoteHostFile = join(claudeDir, '.remote-host');
  const sessionsDir = join(claudeDir, '.remote-sessions');
  const linksDir = getLinksDir();

  // Get remote hostname
  let remoteHost = options.host;

  if (!remoteHost && existsSync(remoteHostFile)) {
    remoteHost = readFileSync(remoteHostFile, 'utf-8').trim();
  }

  if (!remoteHost) {
    console.log('Remote host not configured.');
    remoteHost = await prompt('Enter hostname (e.g., user@server or SSH alias): ');
    if (!remoteHost) {
      throw new Error('hostname is required');
    }
  }

  // Save hostname
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(remoteHostFile, remoteHost);

  // Determine session name
  let instanceName = options.session;
  let reconnectMode = false;

  if (!instanceName && !options.new) {
    // Could add session menu here for multiple sessions
    instanceName = generateInstanceName();
  } else if (!instanceName) {
    instanceName = generateInstanceName();
  }

  // Generate link ID
  const linkId = generateLinkId();

  // Detect local terminal for Focus button
  const localTerminal = detectLocalTerminal();

  // Ensure tunnel is running
  const macTunnelUrl = await ensureTunnel();

  // Create link file
  mkdirSync(linksDir, { recursive: true });
  const linkData = {
    link_id: linkId,
    instance_name: instanceName,
    term_type: localTerminal.type,
    term_target: localTerminal.target,
    focus_url: localTerminal.focusUrl,
    mac_tunnel_url: macTunnelUrl || '',
    created_at: new Date().toISOString(),
  };
  writeFileSync(join(linksDir, `${linkId}.json`), JSON.stringify(linkData, null, 2));

  // Sync Slack config
  syncSlackConfig(remoteHost);

  // Sync Mac tunnel URL to remote
  if (macTunnelUrl) {
    try {
      execSync(
        `ssh "${remoteHost}" "mkdir -p ~/.claude && echo '${macTunnelUrl}' > ~/.claude/.mac-tunnel-url"`,
        { stdio: 'pipe' },
      );
    } catch {
      // Ignore
    }
  }

  // Display info
  console.log('');
  console.log(`Remote: ${remoteHost}`);
  console.log(`Session: ${instanceName} (${reconnectMode ? 'reconnecting' : 'new'})`);
  if (localTerminal.type !== 'unknown') {
    console.log(`Focus: ${localTerminal.type}`);
  }
  console.log('');
  console.log('Run /slack-notify in Claude to enable buttons');
  console.log('');

  await waitForEnter('Press Enter to connect...');
  console.log('');

  // SSH and attach tmux session
  const sshCommand = `ssh -t "${remoteHost}" "tmux new-session -A -s '${instanceName}' \\; set-environment CLAUDE_LINK_ID '${linkId}' \\; set-environment CLAUDE_SSH_HOST '${remoteHost}' \\; set-environment CLAUDE_INSTANCE_NAME '${instanceName}'"`;

  const result = spawnSync('sh', ['-c', sshCommand], {
    stdio: 'inherit',
  });

  process.exit(result.status || 0);
}

/**
 * Handle Linux remote command - start relay tunnel.
 */
async function remoteLinux(): Promise<void> {
  const claudeDir = getClaudeDir();
  const remoteTunnel = join(claudeDir, 'bin', 'remote-tunnel');

  if (!existsSync(remoteTunnel)) {
    throw new Error(
      'remote-tunnel not found. Run install.sh first.\n' +
        'On Linux, the remote command starts the relay for button support.',
    );
  }

  console.log('Starting remote relay for button support...');

  const result = spawnSync(remoteTunnel, ['--background'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log('Remote relay started. Run /slack-notify in Claude to register.');
  } else {
    throw new Error('Failed to start remote relay');
  }
}

/**
 * Remote command - SSH workflow for Mac, tunnel starter for Linux.
 */
export async function remote(options: RemoteOptions = {}): Promise<void> {
  if (isMac()) {
    await remoteMac(options);
  } else if (isLinux()) {
    await remoteLinux();
  } else {
    throw new Error('remote command is only supported on macOS and Linux');
  }
}

/**
 * CLI handler for remote command.
 */
export async function remoteCommand(options: RemoteOptions): Promise<void> {
  try {
    await remote(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
