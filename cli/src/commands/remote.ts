/**
 * Remote Command
 *
 * On Mac: SSH to a saved remote host with tmux session linking.
 * On Linux: Start remote-tunnel and register session.
 */

import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { buildFocusUrl, getClaudeDir, getLinksDir, isMac, isLinux, isInsideTmux } from '../lib/index.js';

// ANSI codes for menu styling
const MENU_BOLD = '\x1b[1m';
const MENU_DIM = '\x1b[2m';
const MENU_RESET = '\x1b[0m';
const MENU_HIGHLIGHT_BG = '\x1b[48;5;197m'; // Pink/magenta background
const MENU_HIGHLIGHT_FG = '\x1b[38;5;231m'; // White text

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

/** Session info for menu display */
interface SessionInfo {
  name: string;
  lastConnected: Date | null;
  description: string;
}

/** Get remote tmux sessions via SSH */
function getRemoteTmuxSessions(remoteHost: string): string[] {
  try {
    const result = execSync(
      `ssh -o ConnectTimeout=5 -o BatchMode=yes "${remoteHost}" 'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
    );
    return result
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/** Get host directory for session storage */
function getHostDir(remoteHost: string): string {
  const claudeDir = getClaudeDir();
  const sessionsDir = join(claudeDir, '.remote-sessions');
  const safeHost = sanitizeHostname(remoteHost);
  return join(sessionsDir, safeHost);
}

/** Load session info from local storage */
function loadSessionInfo(hostDir: string, sessionName: string): SessionInfo {
  const sessionFile = join(hostDir, `${sessionName}.json`);
  let lastConnected: Date | null = null;

  if (existsSync(sessionFile)) {
    try {
      const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
      if (data.last_connected) {
        lastConnected = new Date(data.last_connected);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Format description
  let description = '';
  if (lastConnected) {
    const now = new Date();
    const diffMs = now.getTime() - lastConnected.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      description = 'connected just now';
    } else if (diffMins < 60) {
      description = `connected ${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      description = `connected ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      description = `connected ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }
  }

  return { name: sessionName, lastConnected, description };
}

/** Save session info to local storage */
function saveSessionInfo(hostDir: string, sessionName: string): void {
  mkdirSync(hostDir, { recursive: true });
  const sessionFile = join(hostDir, `${sessionName}.json`);
  const data = {
    session_name: sessionName,
    last_connected: new Date().toISOString(),
  };
  writeFileSync(sessionFile, JSON.stringify(data, null, 2));
}

/** Clean up sessions that no longer exist on remote */
function cleanupDeadSessions(hostDir: string, liveSessions: string[]): void {
  if (!existsSync(hostDir)) return;

  const liveSet = new Set(liveSessions);
  const files = readdirSync(hostDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const sessionName = file.replace(/\.json$/, '');
    if (!liveSet.has(sessionName)) {
      try {
        const { unlinkSync } = require('node:fs');
        unlinkSync(join(hostDir, file));
      } catch {
        // Ignore
      }
    }
  }
}

/** Draw the menu to stderr */
function drawMenu(selected: number, items: SessionInfo[], hostname: string, isFirstDraw: boolean): void {
  // Move cursor up to redraw (except first time)
  if (!isFirstDraw) {
    // Move up: items + header + footer = items.length + 3 lines
    process.stderr.write(`\x1b[${items.length + 3}A`);
  }

  // Clear and draw header
  process.stderr.write('\x1b[K'); // Clear line
  process.stderr.write(`${MENU_BOLD}Sessions on ${hostname}:${MENU_RESET}\n`);
  process.stderr.write('\x1b[K\n'); // Empty line

  // Draw items
  for (let i = 0; i < items.length; i++) {
    process.stderr.write('\x1b[K'); // Clear line
    const item = items[i];
    const isSelected = i === selected;

    if (isSelected) {
      process.stderr.write(`${MENU_HIGHLIGHT_BG}${MENU_HIGHLIGHT_FG} > ${item.name} ${MENU_RESET}`);
      if (item.description) {
        process.stderr.write(` ${MENU_DIM}${item.description}${MENU_RESET}`);
      }
    } else {
      process.stderr.write(`   ${item.name}`);
      if (item.description) {
        process.stderr.write(`  ${MENU_DIM}${item.description}${MENU_RESET}`);
      }
    }
    process.stderr.write('\n');
  }

  // Footer
  process.stderr.write('\x1b[K');
  process.stderr.write(`${MENU_DIM}↑↓ navigate  enter select  n new${MENU_RESET}\n`);
}

/** Interactive menu with arrow key navigation */
async function interactiveMenu(items: SessionInfo[], hostname: string): Promise<{ type: 'select'; index: number } | { type: 'new' } | { type: 'quit' }> {
  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    // Fallback to simple numbered menu
    console.error('\nSessions:');
    items.forEach((item, i) => {
      console.error(`  ${i + 1}. ${item.name}${item.description ? ` (${item.description})` : ''}`);
    });
    console.error(`  n. New session`);
    const answer = await prompt('Select (1-' + items.length + ' or n): ');
    if (answer.toLowerCase() === 'n') {
      return { type: 'new' };
    }
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= items.length) {
      return { type: 'select', index: num - 1 };
    }
    return { type: 'new' };
  }

  let selected = 0;

  // Save terminal settings and reset to sane state
  // This fixes terminal corruption after SSH disconnect
  // CRITICAL: Use 'inherit' for stdin so stty affects the actual terminal
  let savedStty = '';
  let usingStty = false;
  try {
    // Save current settings - inherit stdin so stty can read terminal state
    savedStty = execSync('stty -g', { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
    // Reset to sane state first (critical for corrupted terminals after SSH disconnect)
    execSync('stty sane', { stdio: ['inherit', 'pipe', 'pipe'] });
    // Configure raw mode with stty (like bash does) - more reliable than Node's setRawMode
    execSync('stty -icanon -echo min 1', { stdio: ['inherit', 'pipe', 'pipe'] });
    usingStty = true;
  } catch {
    // Fallback to Node's setRawMode if stty fails (e.g., not a real terminal)
    try {
      process.stdin.setRawMode(true);
    } catch {
      // Ignore - will fail if not a TTY
    }
  }

  process.stdin.resume();

  // Hide cursor
  process.stderr.write('\x1b[?25l');

  // Restore on exit
  const cleanup = () => {
    process.stderr.write('\x1b[?25h'); // Show cursor
    if (savedStty && usingStty) {
      try {
        execSync(`stty '${savedStty}'`, { stdio: ['inherit', 'pipe', 'pipe'] });
      } catch {
        // Ignore restore errors
      }
    } else {
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }
  };

  // Initial draw
  drawMenu(selected, items, hostname, true);

  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const key = data.toString();

      // Arrow keys come as escape sequences
      if (key === '\x1b[A' || key === 'k' || key === 'K') {
        // Up
        if (selected > 0) selected--;
        drawMenu(selected, items, hostname, false);
      } else if (key === '\x1b[B' || key === 'j' || key === 'J') {
        // Down
        if (selected < items.length - 1) selected++;
        drawMenu(selected, items, hostname, false);
      } else if (key === '\r' || key === '\n') {
        // Enter
        cleanup();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve({ type: 'select', index: selected });
      } else if (key === 'n' || key === 'N') {
        // New
        cleanup();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve({ type: 'new' });
      } else if (key === 'q' || key === 'Q' || key === '\x03') {
        // Quit (q or Ctrl+C)
        cleanup();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve({ type: 'quit' });
      }
    };

    process.stdin.on('data', onData);
  });
}

/** Show session selection menu */
async function showSessionMenu(
  hostDir: string,
  remoteHost: string,
  liveSessions: string[],
): Promise<{ type: 'reconnect'; session: string } | { type: 'new' } | { type: 'quit' }> {
  // Load info for each session
  const sessions: SessionInfo[] = liveSessions.map((name) => loadSessionInfo(hostDir, name));

  // Sort by last connected (most recent first)
  sessions.sort((a, b) => {
    if (!a.lastConnected && !b.lastConnected) return 0;
    if (!a.lastConnected) return 1;
    if (!b.lastConnected) return -1;
    return b.lastConnected.getTime() - a.lastConnected.getTime();
  });

  // Limit to 10
  const displaySessions = sessions.slice(0, 10);

  // Add "New session" option
  displaySessions.push({ name: 'New session', lastConnected: null, description: 'start a fresh session' });

  const result = await interactiveMenu(displaySessions, remoteHost);

  if (result.type === 'quit') {
    return { type: 'quit' };
  } else if (result.type === 'new' || result.index === displaySessions.length - 1) {
    return { type: 'new' };
  } else {
    return { type: 'reconnect', session: displaySessions[result.index].name };
  }
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
  auto?: boolean;
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
    // Check for existing sessions on remote
    console.log('Checking remote sessions...');
    const liveSessions = getRemoteTmuxSessions(remoteHost);
    const hostDir = getHostDir(remoteHost);

    // Clean up dead sessions from local storage
    cleanupDeadSessions(hostDir, liveSessions);

    if (liveSessions.length === 0) {
      // No sessions - create new
      instanceName = generateInstanceName();
    } else {
      // Show session menu
      const menuResult = await showSessionMenu(hostDir, remoteHost, liveSessions);

      if (menuResult.type === 'quit') {
        process.exit(0);
      } else if (menuResult.type === 'reconnect') {
        instanceName = menuResult.session;
        reconnectMode = true;
      } else {
        instanceName = generateInstanceName();
      }
    }
  } else if (!instanceName) {
    instanceName = generateInstanceName();
  }

  // Save session info for next time
  const hostDir = getHostDir(remoteHost);
  saveSessionInfo(hostDir, instanceName);

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
  if (!reconnectMode) {
    console.log('');
    console.log('Claude will start automatically with /slack-notify');
  }
  console.log('');

  // SSH and attach tmux session
  // For new sessions: run claude /slack-notify automatically
  // For existing sessions: just attach
  const remoteScript = `
if tmux has-session -t '${instanceName}' 2>/dev/null; then
  tmux set-environment -t '${instanceName}' CLAUDE_LINK_ID '${linkId}'
  tmux set-environment -t '${instanceName}' CLAUDE_SSH_HOST '${remoteHost}'
  tmux set-environment -t '${instanceName}' CLAUDE_INSTANCE_NAME '${instanceName}'
  exec tmux attach-session -t '${instanceName}'
else
  exec tmux new-session -s '${instanceName}' \\
    -e CLAUDE_LINK_ID='${linkId}' \\
    -e CLAUDE_SSH_HOST='${remoteHost}' \\
    -e CLAUDE_INSTANCE_NAME='${instanceName}' \\
    'claude /slack-notify; exec $SHELL'
fi
`.trim();

  const sshCommand = `ssh -t "${remoteHost}" "${remoteScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

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
