/**
 * Status Command
 *
 * Shows system status including tunnels and registered sessions.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

import {
  getClaudeDir,
  getInstancesDir,
  getLinksDir,
  getTunnelUrlPath,
  isInsideTmux,
  isLinux,
  isMac,
  isSSHSession,
} from '../lib/index.js';

/** ANSI colors for terminal output */
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

/** Box drawing characters */
const BOX_TOP = '\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E';
const BOX_MID = '\u2502                                                             \u2502';
const BOX_BOT = '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F';

/** Inner box characters */
const INNER_TOP = '  \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510';
const INNER_BOT = '  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518';

interface InstanceData {
  id: string;
  name: string;
  hostname: string;
  term_type: string;
  term_target?: string;
  registered_at?: string;
}

interface LinkData {
  link_id: string;
  term_type: string;
  created_at: string;
}

/** Check if MCP server is running */
async function checkMcpServer(): Promise<{ running: boolean; port: number }> {
  const claudeDir = getClaudeDir();
  const portFile = join(claudeDir, '.mcp-server.port');
  const port = existsSync(portFile)
    ? parseInt(readFileSync(portFile, 'utf-8').trim(), 10) || 8463
    : 8463;

  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return { running: response.ok, port };
  } catch {
    return { running: false, port };
  }
}

/** Check tunnel status */
async function checkTunnel(): Promise<{ url: string | null; type: string | null; healthy: boolean }> {
  const claudeDir = getClaudeDir();
  let url: string | null = null;
  let type: string | null = null;

  // Check local tunnel
  const tunnelUrlPath = getTunnelUrlPath();
  if (existsSync(tunnelUrlPath)) {
    url = readFileSync(tunnelUrlPath, 'utf-8').trim();
    const typeFile = join(claudeDir, '.tunnel-type');
    type = existsSync(typeFile) ? readFileSync(typeFile, 'utf-8').trim() : 'unknown';
  }

  // Check remote tunnel
  if (!url) {
    const remoteTunnelUrl = join(claudeDir, '.remote-tunnel-url');
    if (existsSync(remoteTunnelUrl)) {
      url = readFileSync(remoteTunnelUrl, 'utf-8').trim();
      const typeFile = join(claudeDir, '.remote-tunnel-type');
      type = existsSync(typeFile) ? readFileSync(typeFile, 'utf-8').trim() : 'remote';
    }
  }

  if (!url) {
    return { url: null, type: null, healthy: false };
  }

  // Verify tunnel is responding
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { url, type, healthy: response.ok };
  } catch {
    return { url, type, healthy: false };
  }
}

/** Get tmux session info */
function getTmuxInfo(): { session: string; window: string; pane: string } | null {
  if (!isInsideTmux()) {
    return null;
  }

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

    return { session, window, pane };
  } catch {
    return null;
  }
}

/** Get link ID from tmux environment */
function getLinkIdFromTmux(): string | null {
  if (!isInsideTmux()) {
    return null;
  }

  try {
    const result = execSync('tmux show-environment CLAUDE_LINK_ID', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = result.match(/^CLAUDE_LINK_ID=(.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Get environment info */
function getEnvironmentInfo(): { type: string; terminal: string | null } {
  const os = process.platform;
  let type = 'Unknown';
  let terminal: string | null = null;

  if (os === 'darwin') {
    type = 'macOS';
    if (process.env.ITERM_SESSION_ID) {
      terminal = 'iTerm2';
    } else if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
      terminal = 'Terminal.app';
    } else if (process.env.TERM_PROGRAM) {
      terminal = process.env.TERM_PROGRAM;
    }
  } else if (os === 'linux') {
    if (process.env.WSL_DISTRO_NAME) {
      type = `WSL (${process.env.WSL_DISTRO_NAME})`;
      if (process.env.WT_SESSION) {
        terminal = 'Windows Terminal';
      }
    } else if (process.env.JUPYTER_SERVER_ROOT || process.env.JPY_PARENT_PID) {
      type = 'JupyterLab';
      terminal = 'Browser';
    } else {
      type = 'Linux';
    }
  } else if (os === 'win32') {
    type = 'Windows (Git Bash)';
    if (process.env.WT_SESSION) {
      terminal = 'Windows Terminal';
    } else if (process.env.ConEmuPID) {
      terminal = 'ConEmu';
    }
  }

  return { type, terminal };
}

/** Load registered sessions */
function loadSessions(): InstanceData[] {
  const instancesDir = getInstancesDir();
  if (!existsSync(instancesDir)) {
    return [];
  }

  const sessions: InstanceData[] = [];
  const files = readdirSync(instancesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(instancesDir, file), 'utf-8');
      sessions.push(JSON.parse(content) as InstanceData);
    } catch {
      // Skip invalid files
    }
  }

  return sessions;
}

/** Load active links */
function loadLinks(): LinkData[] {
  const linksDir = getLinksDir();
  if (!existsSync(linksDir)) {
    return [];
  }

  const links: LinkData[] = [];
  const files = readdirSync(linksDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(linksDir, file), 'utf-8');
      const data = JSON.parse(content);
      links.push({
        link_id: basename(file, '.json'),
        term_type: data.term_type || 'unknown',
        created_at: data.created_at || '',
      });
    } catch {
      // Skip invalid files
    }
  }

  return links;
}

/** Get saved remote host */
function getRemoteHost(): string | null {
  const remoteHostFile = join(getClaudeDir(), '.remote-host');
  if (existsSync(remoteHostFile)) {
    return readFileSync(remoteHostFile, 'utf-8').trim();
  }
  return null;
}

/** Load sessions from remote host via SSH */
function loadRemoteSessions(host: string): InstanceData[] {
  try {
    const result = execSync(
      `ssh -o ConnectTimeout=3 -o BatchMode=yes ${host} 'cat ~/.claude/instances/*.json 2>/dev/null || echo "[]"'`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      }
    );

    // Parse JSON objects (they're concatenated, not an array)
    const sessions: InstanceData[] = [];
    const jsonMatches = result.match(/\{[^{}]+\}/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        try {
          sessions.push(JSON.parse(match) as InstanceData);
        } catch {
          // Skip invalid JSON
        }
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

/** Get active tmux sessions from remote host */
function getRemoteTmuxSessions(host: string): string[] {
  try {
    const result = execSync(
      `ssh -o ConnectTimeout=3 -o BatchMode=yes ${host} 'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Show system status.
 */
export async function status(): Promise<void> {
  const currentInstanceId = process.env.CLAUDE_INSTANCE_ID;

  // Header
  console.log(BOX_TOP);
  console.log('\u2502  Claude Slack Notify Status                                 \u2502');
  console.log(BOX_BOT);
  console.log('');

  // Machine info
  const machineHostname = hostname();
  const envInfo = getEnvironmentInfo();

  console.log(`  Machine: ${machineHostname}`);
  console.log(`  OS: ${envInfo.type}`);
  if (envInfo.terminal) {
    console.log(`  Terminal: ${envInfo.terminal}`);
  }

  // SSH info
  if (isSSHSession()) {
    const sshFrom = process.env.SSH_CONNECTION?.split(' ')[0] || 'unknown';
    console.log(`  SSH from: ${sshFrom}`);
  }

  // Tmux info
  const tmuxInfo = getTmuxInfo();
  if (tmuxInfo) {
    console.log(`  Tmux: ${tmuxInfo.session}:${tmuxInfo.window}.${tmuxInfo.pane}`);

    const linkId = getLinkIdFromTmux();
    if (linkId) {
      const linkHost = process.env.CLAUDE_SSH_HOST || 'unknown';
      console.log(`  Linked to: ${linkHost} (link: ${linkId})`);
    }
  }
  console.log('');

  // Services section
  console.log(INNER_TOP);
  console.log('  \u2502 Services                                                \u2502');
  console.log(INNER_BOT);

  // MCP Server
  const mcpStatus = await checkMcpServer();
  if (mcpStatus.running) {
    console.log(`    MCP Server: ${GREEN}\u2713${RESET} running on port ${mcpStatus.port}`);
  } else {
    console.log(`    MCP Server: ${RED}\u2717${RESET} not running`);
  }

  // Tunnel
  const tunnelStatus = await checkTunnel();
  if (tunnelStatus.url) {
    if (tunnelStatus.healthy) {
      console.log(`    Tunnel: ${GREEN}\u2713${RESET} ${tunnelStatus.url} (${tunnelStatus.type})`);
    } else {
      console.log(`    Tunnel: ${YELLOW}\u26A0${RESET} URL found but not responding`);
      console.log(`            ${tunnelStatus.url} (${tunnelStatus.type})`);
    }
  } else {
    console.log(`    Tunnel: ${RED}\u2717${RESET} not running`);
  }
  console.log('');

  // Local Sessions section
  console.log(INNER_TOP);
  console.log('  \u2502 Local Sessions                                          \u2502');
  console.log(INNER_BOT);

  const sessions = loadSessions();
  if (sessions.length === 0) {
    console.log('    (no local sessions registered)');
  } else {
    for (const session of sessions) {
      const isCurrentSession = session.id === currentInstanceId;
      const marker = isCurrentSession ? '\u2192' : '\u2022';
      const suffix = isCurrentSession ? ` ${DIM}(current)${RESET}` : '';
      console.log(`    ${marker} ${session.name} (${session.term_type})${suffix}`);
    }
  }
  console.log('');

  // Remote Sessions section (Mac only - when connected to remote via SSH)
  const remoteHost = getRemoteHost();
  if (remoteHost && isMac()) {
    console.log(INNER_TOP);
    const remoteTitle = `Remote Sessions (${remoteHost})`;
    const padding = 55 - remoteTitle.length;
    console.log(`  \u2502 ${remoteTitle}${' '.repeat(Math.max(0, padding))}\u2502`);
    console.log(INNER_BOT);

    const remoteSessions = loadRemoteSessions(remoteHost);
    const remoteTmux = getRemoteTmuxSessions(remoteHost);

    if (remoteSessions.length === 0 && remoteTmux.length === 0) {
      console.log(`    ${DIM}(unable to connect or no sessions)${RESET}`);
    } else {
      // Show registered sessions
      for (const session of remoteSessions) {
        // Check if the tmux session is still active
        const tmuxMatch = session.term_target?.match(/([^:|]+):/);
        const tmuxSession = tmuxMatch ? tmuxMatch[1] : null;
        const isActive = tmuxSession && remoteTmux.includes(tmuxSession);
        const statusIcon = isActive ? `${GREEN}\u2713${RESET}` : `${DIM}\u2717${RESET}`;
        console.log(`    ${statusIcon} ${session.name} (${session.term_type})`);
      }

      // Show tmux sessions not registered
      const registeredTmux = new Set(
        remoteSessions
          .map((s) => s.term_target?.match(/([^:|]+):/)?.[1])
          .filter(Boolean)
      );
      const unregistered = remoteTmux.filter((t) => !registeredTmux.has(t));
      if (unregistered.length > 0) {
        console.log(`    ${DIM}Unregistered tmux sessions:${RESET}`);
        for (const tmux of unregistered) {
          console.log(`      ${DIM}\u2022 ${tmux}${RESET}`);
        }
      }
    }
    console.log('');
  }

  // Links section (Mac only)
  const links = loadLinks();
  if (links.length > 0) {
    console.log(INNER_TOP);
    console.log('  \u2502 Active Links (for SSH sessions)                        \u2502');
    console.log(INNER_BOT);

    for (const link of links) {
      const created = link.created_at
        ? link.created_at.split('T').slice(0, 2).join(' ')
        : 'unknown';
      console.log(`    \u2022 ${link.link_id} (${link.term_type}) created ${created}`);
    }
    console.log('');
  }

  // Quick commands
  console.log(INNER_TOP);
  console.log('  \u2502 Quick Commands                                          \u2502');
  console.log(INNER_BOT);
  console.log('    claude-slack-notify update    Pull latest & reinstall');
  console.log('    claude-slack-notify list      List all sessions');
  console.log('    claude-slack-notify stop      Stop this session');
  if (isLinux()) {
    console.log('    claude-slack-notify sync      Fix dead relay/tunnel');
  }
  console.log('    /slack-notify                 Register in Claude');
  console.log('');
}

/**
 * CLI handler for status command.
 */
export async function statusCommand(): Promise<void> {
  try {
    await status();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
