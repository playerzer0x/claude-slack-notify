/**
 * Launch Command
 *
 * Starts Claude in a local tmux session for reliable input.
 * macOS only - captures iTerm session ID before creating tmux.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getClaudeDir, isMac, isInsideTmux } from '../lib/index.js';

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
function generateSessionName(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(COLORS)}-${pick(ITEMS)}`;
}

/** Check if a tmux session exists */
function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t '${name}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get iTerm session ID via AppleScript */
function getItermSessionId(): string | null {
  try {
    const result = execSync(
      `osascript -e 'tell application "iTerm2" to tell current session of current tab of current window to return id'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return result.trim();
  } catch {
    return null;
  }
}

/** Check if tunnel is healthy */
async function isTunnelHealthy(): Promise<boolean> {
  const tunnelUrlFile = join(getClaudeDir(), '.tunnel-url');
  if (!existsSync(tunnelUrlFile)) {
    return false;
  }

  const tunnelUrl = readFileSync(tunnelUrlFile, 'utf-8').trim();
  if (!tunnelUrl) {
    return false;
  }

  try {
    const response = await fetch(`${tunnelUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Start or restart local tunnel */
async function ensureTunnel(): Promise<void> {
  const localTunnel = join(getClaudeDir(), 'bin', 'local-tunnel');

  if (!existsSync(localTunnel)) {
    return;
  }

  if (await isTunnelHealthy()) {
    return;
  }

  console.log('Local tunnel not healthy, restarting...');

  try {
    // Stop existing tunnel
    execSync(`"${localTunnel}" --stop`, { stdio: 'pipe' });
  } catch {
    // Ignore errors
  }

  // Wait a bit
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Start tunnel in background
  spawn(localTunnel, ['--background'], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  // Wait for tunnel to be ready
  const tunnelUrlFile = join(getClaudeDir(), '.tunnel-url');
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (existsSync(tunnelUrlFile)) {
      const tunnelUrl = readFileSync(tunnelUrlFile, 'utf-8').trim();
      if (tunnelUrl && (await isTunnelHealthy())) {
        console.log(`Local tunnel ready: ${tunnelUrl}`);
        return;
      }
    }
  }

  console.log('Warning: Tunnel may not be ready. Buttons might not work until tunnel is up.');
}

/** Options for launch command */
export interface LaunchOptions {
  name?: string;
}

/**
 * Launch Claude in a tmux session.
 */
export async function launch(options: LaunchOptions = {}): Promise<void> {
  // Platform check - macOS only for now
  if (!isMac()) {
    throw new Error(
      "'launch' command is currently for macOS only.\n" +
        "On Linux, Claude already runs in tmux via 'remote' command.",
    );
  }

  // Check if tmux is available
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    throw new Error('tmux is required. Install with: brew install tmux');
  }

  // Check if already inside tmux
  if (isInsideTmux()) {
    throw new Error(
      "Already inside a tmux session.\n" +
        "Either run 'claude' directly here and use /slack-notify,\n" +
        "or exit tmux and run 'claude-slack-notify launch' from outside.",
    );
  }

  // Generate session name if not provided
  const sessionName = options.name || generateSessionName();

  // Check if session already exists
  if (tmuxSessionExists(sessionName)) {
    console.log(`Attaching to existing session: ${sessionName}`);
    execSync(`tmux attach-session -t '${sessionName}'`, { stdio: 'inherit' });
    return;
  }

  // Ensure tunnel is running (macOS)
  await ensureTunnel();

  // Capture iTerm session ID before creating tmux
  const itermSessionId = process.env.ITERM_SESSION_ID || getItermSessionId();

  // Create new tmux session
  console.log(`Creating tmux session: ${sessionName}`);
  execSync(`tmux new-session -d -s '${sessionName}' -x 200 -y 50`, { stdio: 'pipe' });

  // Get actual window and pane indices (respects user's base-index settings)
  const firstWindow = execSync(
    `tmux list-windows -t '${sessionName}' -F '#{window_index}' | head -1`,
    { encoding: 'utf-8' },
  ).trim();
  const firstPane = execSync(
    `tmux list-panes -t '${sessionName}:${firstWindow}' -F '#{pane_index}' | head -1`,
    { encoding: 'utf-8' },
  ).trim();
  const tmuxTarget = `${sessionName}:${firstWindow}.${firstPane}`;

  // Set environment variables at tmux session level
  execSync(
    `tmux set-environment -t '${sessionName}' CLAUDE_TMUX_SESSION '${sessionName}'`,
    { stdio: 'pipe' },
  );
  execSync(
    `tmux set-environment -t '${sessionName}' CLAUDE_TMUX_TARGET '${tmuxTarget}'`,
    { stdio: 'pipe' },
  );
  execSync(
    `tmux set-environment -t '${sessionName}' CLAUDE_INSTANCE_NAME '${sessionName}'`,
    { stdio: 'pipe' },
  );

  if (itermSessionId) {
    execSync(
      `tmux set-environment -t '${sessionName}' CLAUDE_ITERM_SESSION_ID '${itermSessionId}'`,
      { stdio: 'pipe' },
    );
  }

  // Export env vars in shell and start claude
  const commands = [
    `export CLAUDE_TMUX_SESSION='${sessionName}'`,
    `export CLAUDE_TMUX_TARGET='${tmuxTarget}'`,
    `export CLAUDE_INSTANCE_NAME='${sessionName}'`,
    'claude',
  ];

  for (const cmd of commands) {
    execSync(`tmux send-keys -t '${sessionName}' "${cmd}" Enter`, { stdio: 'pipe' });
    // Small delay between commands
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Attach to the session
  console.log('Attaching to Claude session...');
  execSync(`tmux attach-session -t '${sessionName}'`, { stdio: 'inherit' });
}

/**
 * CLI handler for launch command.
 */
export async function launchCommand(options: LaunchOptions): Promise<void> {
  try {
    await launch(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
