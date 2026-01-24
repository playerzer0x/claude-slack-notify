/**
 * Platform Detection Utilities
 *
 * Provides cross-platform helpers for terminal detection and paths.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Platform = 'darwin' | 'linux' | 'win32';

/**
 * Get the current platform.
 */
export function getPlatform(): Platform {
  return process.platform as Platform;
}

/**
 * Check if running on macOS.
 */
export function isMac(): boolean {
  return getPlatform() === 'darwin';
}

/**
 * Check if running on Linux.
 */
export function isLinux(): boolean {
  return getPlatform() === 'linux';
}

/**
 * Check if running on Windows.
 */
export function isWindows(): boolean {
  return getPlatform() === 'win32';
}

/**
 * Get the user's UID (Unix only).
 * Returns 501 (default macOS UID) on Windows or if unavailable.
 */
export function getUid(): number {
  return process.getuid?.() || 501;
}

/**
 * Get the tmux socket path for the current user.
 * macOS uses /private/tmp, Linux uses /tmp.
 */
export function getTmuxSocketPath(): string {
  const uid = getUid();
  return isMac() ? `/private/tmp/tmux-${uid}/default` : `/tmp/tmux-${uid}/default`;
}

/**
 * Check if tmux is running for the current user.
 */
export function isTmuxRunning(): boolean {
  return existsSync(getTmuxSocketPath());
}

/**
 * Get the Claude home directory (~/.claude).
 */
export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

/**
 * Get the Claude instances directory (~/.claude/instances).
 */
export function getInstancesDir(): string {
  return join(getClaudeDir(), 'instances');
}

/**
 * Get the Claude links directory (~/.claude/links).
 */
export function getLinksDir(): string {
  return join(getClaudeDir(), 'links');
}

/**
 * Get the Claude threads directory (~/.claude/threads).
 */
export function getThreadsDir(): string {
  return join(getClaudeDir(), 'threads');
}

/**
 * Get the Claude logs directory (~/.claude/logs).
 */
export function getLogsDir(): string {
  return join(getClaudeDir(), 'logs');
}

/**
 * Get the tunnel URL file path (~/.claude/.tunnel-url).
 */
export function getTunnelUrlPath(): string {
  return join(getClaudeDir(), '.tunnel-url');
}

/**
 * Get the Mac tunnel URL file path (~/.claude/.mac-tunnel-url).
 * Used by remote servers to know how to reach the Mac.
 */
export function getMacTunnelUrlPath(): string {
  return join(getClaudeDir(), '.mac-tunnel-url');
}

/**
 * Get the Slack config file path (~/.claude/.slack-config).
 */
export function getSlackConfigPath(): string {
  return join(getClaudeDir(), '.slack-config');
}

/**
 * Get the Slack signing secret file path.
 */
export function getSlackSigningSecretPath(): string {
  return join(getClaudeDir(), 'slack-signing-secret');
}

/**
 * Terminal environment detection.
 */
export interface TerminalEnv {
  /** iTerm2 session ID if running in iTerm2 */
  itermSessionId?: string;
  /** TMUX environment if inside tmux */
  tmux?: string;
  /** TMUX pane ID */
  tmuxPane?: string;
  /** Windows Terminal session */
  wtSession?: string;
  /** Konsole D-Bus session */
  konsoleDbusSession?: string;
  /** VS Code terminal */
  vscodeTerminal?: boolean;
  /** Terminal type from TERM_PROGRAM */
  termProgram?: string;
  /** SSH connection info */
  sshConnection?: string;
  /** Claude link ID for SSH sessions */
  claudeLinkId?: string;
  /** Claude tmux session (set by claude-slack-notify launch) */
  claudeTmuxSession?: string;
  /** Claude tmux target (set by claude-slack-notify launch) */
  claudeTmuxTarget?: string;
  /** Claude iTerm session ID (set by claude-slack-notify launch) */
  claudeItermSessionId?: string;
}

/**
 * Detect terminal environment from environment variables.
 */
export function detectTerminalEnv(): TerminalEnv {
  const env: TerminalEnv = {};

  // iTerm2
  if (process.env.ITERM_SESSION_ID) {
    env.itermSessionId = process.env.ITERM_SESSION_ID;
  }

  // tmux
  if (process.env.TMUX) {
    env.tmux = process.env.TMUX;
    env.tmuxPane = process.env.TMUX_PANE;
  }

  // Windows Terminal
  if (process.env.WT_SESSION) {
    env.wtSession = process.env.WT_SESSION;
  }

  // Konsole
  if (process.env.KONSOLE_DBUS_SESSION) {
    env.konsoleDbusSession = process.env.KONSOLE_DBUS_SESSION;
  }

  // VS Code
  if (process.env.TERM_PROGRAM === 'vscode') {
    env.vscodeTerminal = true;
  }

  // Generic terminal program
  if (process.env.TERM_PROGRAM) {
    env.termProgram = process.env.TERM_PROGRAM;
  }

  // SSH connection
  if (process.env.SSH_CONNECTION) {
    env.sshConnection = process.env.SSH_CONNECTION;
  }

  // Claude-specific env vars (set by claude-slack-notify)
  if (process.env.CLAUDE_LINK_ID) {
    env.claudeLinkId = process.env.CLAUDE_LINK_ID;
  }

  if (process.env.CLAUDE_TMUX_SESSION) {
    env.claudeTmuxSession = process.env.CLAUDE_TMUX_SESSION;
  }

  if (process.env.CLAUDE_TMUX_TARGET) {
    env.claudeTmuxTarget = process.env.CLAUDE_TMUX_TARGET;
  }

  if (process.env.CLAUDE_ITERM_SESSION_ID) {
    env.claudeItermSessionId = process.env.CLAUDE_ITERM_SESSION_ID;
  }

  return env;
}

/**
 * Check if we're running inside an SSH session.
 */
export function isSSHSession(): boolean {
  return !!process.env.SSH_CONNECTION;
}

/**
 * Check if we're running inside tmux.
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Check if we're running in iTerm2.
 */
export function isInITerm2(): boolean {
  return !!process.env.ITERM_SESSION_ID;
}
