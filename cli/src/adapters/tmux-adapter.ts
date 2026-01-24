/**
 * Tmux Terminal Adapter
 *
 * Handles terminal operations for tmux sessions.
 * Uses direct tmux commands with the gastown pattern for reliable input delivery.
 *
 * CRITICAL: The timing in sendInput() is the "gastown pattern" - DO NOT CHANGE:
 * - 500ms wait after send-keys -l
 * - 100ms wait after Escape
 * These timings are tested and required for reliable Claude Code input handling.
 */

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { getTmuxSocketPath, isMac } from '../lib/platform.js';
import type {
  TerminalAdapter,
  TerminalAdapterOptions,
  TerminalResult,
} from './terminal-adapter.js';

const exec = promisify(execCallback);

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escape a string for use in shell commands.
 * Wraps in single quotes and escapes any internal single quotes.
 */
function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Tmux adapter for direct tmux operations.
 *
 * Target format: session:window.pane (e.g., "claude:0.0")
 *
 * CRITICAL - Platform-specific socket paths:
 * - Mac: /private/tmp/tmux-{uid}/default
 * - Linux: /tmp/tmux-{uid}/default
 */
export class TmuxAdapter implements TerminalAdapter {
  private readonly debug: boolean;
  private readonly tmuxSocket: string;
  private readonly timeout: number;

  constructor(options: TerminalAdapterOptions = {}) {
    this.debug = options.debug ?? false;
    // Use provided socket path or auto-detect based on platform
    this.tmuxSocket = options.tmuxSocket ?? getTmuxSocketPath();
    this.timeout = options.timeout ?? 30000;
  }

  /**
   * Get the tmux binary path.
   * On Mac, check homebrew location first.
   */
  private getTmuxBin(): string {
    if (isMac() && existsSync('/opt/homebrew/bin/tmux')) {
      return '/opt/homebrew/bin/tmux';
    }
    return 'tmux';
  }

  /**
   * Build the base tmux command with socket option.
   */
  private buildTmuxCmd(): string {
    return `${this.getTmuxBin()} -S ${shellEscape(this.tmuxSocket)}`;
  }

  /**
   * Check if tmux socket exists.
   */
  private isTmuxAvailable(): boolean {
    return existsSync(this.tmuxSocket);
  }

  /**
   * Focus a tmux pane by switching the client to the target window.
   *
   * @param target - Tmux target (session:window.pane format)
   */
  async focus(target: string): Promise<TerminalResult> {
    if (!this.isTmuxAvailable()) {
      return {
        success: false,
        error: `Tmux socket not found at ${this.tmuxSocket}`,
      };
    }

    try {
      // Extract session and window from target
      const session = target.split(':')[0];
      const windowPart = target.split(':')[1];
      const window = windowPart?.split('.')[0] ?? '0';

      const tmuxCmd = this.buildTmuxCmd();

      // Get the client TTY attached to this session
      const { stdout: clientTty } = await exec(
        `${tmuxCmd} list-clients -t ${shellEscape(session)} -F '#{client_tty}' 2>/dev/null | head -1`,
        { timeout: this.timeout },
      );

      const tty = clientTty.trim();

      if (this.debug) {
        console.log(`[TmuxAdapter] Focusing target: ${target}`);
        console.log(`[TmuxAdapter] Session: ${session}, Window: ${window}`);
        console.log(`[TmuxAdapter] Client TTY: ${tty || '(none)'}`);
      }

      if (tty) {
        // Switch the client to the target window
        await exec(
          `${tmuxCmd} switch-client -c ${shellEscape(tty)} -t ${shellEscape(`${session}:${window}`)}`,
          { timeout: this.timeout },
        );
      } else {
        // No attached client, just select the window
        await exec(
          `${tmuxCmd} select-window -t ${shellEscape(`${session}:${window}`)}`,
          { timeout: this.timeout },
        );
      }

      // Select the pane
      await exec(
        `${tmuxCmd} select-pane -t ${shellEscape(target)}`,
        { timeout: this.timeout },
      );

      return {
        success: true,
        details: `Focused tmux target ${target}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to focus tmux: ${message}`,
      };
    }
  }

  /**
   * Send text input to a tmux pane using the gastown pattern.
   *
   * CRITICAL - GASTOWN PATTERN - DO NOT CHANGE TIMING:
   * 1. Send text with -l (literal) flag
   * 2. Wait 500ms for paste to complete
   * 3. Send Escape (exits vim mode if active, required for Claude Code)
   * 4. Wait 100ms
   * 5. Send Enter as separate command
   *
   * @param target - Tmux target (session:window.pane format)
   * @param text - Text to send
   */
  async sendInput(target: string, text: string): Promise<TerminalResult> {
    if (!this.isTmuxAvailable()) {
      return {
        success: false,
        error: `Tmux socket not found at ${this.tmuxSocket}`,
      };
    }

    try {
      const tmuxCmd = this.buildTmuxCmd();

      if (this.debug) {
        console.log(`[TmuxAdapter] Sending input to target: ${target}`);
        console.log(`[TmuxAdapter] Text: ${text}`);
      }

      // GASTOWN PATTERN - DO NOT CHANGE TIMING
      // Step 1: Send text in literal mode (handles special characters)
      await exec(
        `${tmuxCmd} send-keys -t ${shellEscape(target)} -l ${shellEscape(text)}`,
        { timeout: this.timeout },
      );

      // Step 2: Wait 500ms for paste to complete - MUST be 500ms
      await sleep(500);

      // Step 3: Send Escape (required for Claude Code input handling)
      await exec(
        `${tmuxCmd} send-keys -t ${shellEscape(target)} Escape`,
        { timeout: this.timeout },
      );

      // Step 4: Wait 100ms - MUST be 100ms
      await sleep(100);

      // Step 5: Send Enter as separate command (more reliable than appending)
      await exec(
        `${tmuxCmd} send-keys -t ${shellEscape(target)} Enter`,
        { timeout: this.timeout },
      );

      return {
        success: true,
        details: `Sent input to tmux target ${target}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to send tmux input: ${message}`,
      };
    }
  }

  /**
   * Get the TTY of the client attached to a session.
   * Useful for then focusing the terminal emulator.
   */
  async getClientTty(session: string): Promise<string | null> {
    if (!this.isTmuxAvailable()) {
      return null;
    }

    try {
      const tmuxCmd = this.buildTmuxCmd();
      const { stdout } = await exec(
        `${tmuxCmd} list-clients -t ${shellEscape(session)} -F '#{client_tty}' 2>/dev/null | head -1`,
        { timeout: this.timeout },
      );
      const tty = stdout.trim();
      return tty || null;
    } catch {
      return null;
    }
  }

  /**
   * Switch remote tmux via SSH.
   * Used for ssh-linked and ssh-tmux URL types.
   */
  async switchRemoteTmux(
    host: string,
    user: string,
    port: number,
    tmuxTarget: string,
  ): Promise<TerminalResult> {
    try {
      const session = tmuxTarget.split(':')[0];
      const windowPart = tmuxTarget.split(':')[1];
      const window = windowPart?.split('.')[0] ?? '0';

      const sshCmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 -p ${port} ${user}@${host}`;

      if (this.debug) {
        console.log(`[TmuxAdapter] Switching remote tmux: ${tmuxTarget}`);
        console.log(`[TmuxAdapter] SSH command: ${sshCmd}`);
      }

      // Switch to window and select pane
      await exec(
        `${sshCmd} "tmux select-window -t '${session}:${window}' 2>/dev/null; tmux select-pane -t '${tmuxTarget}' 2>/dev/null"`,
        { timeout: this.timeout },
      );

      return {
        success: true,
        details: `Switched remote tmux to ${tmuxTarget}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to switch remote tmux: ${message}`,
      };
    }
  }

  /**
   * Send input to remote tmux via SSH.
   * Uses the gastown pattern with SSH commands.
   */
  async sendRemoteTmuxInput(
    host: string,
    user: string,
    port: number,
    tmuxTarget: string,
    text: string,
  ): Promise<TerminalResult> {
    try {
      const sshCmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 -p ${port} ${user}@${host}`;

      // Escape text for shell (single quotes with escaped internal quotes)
      const escapedText = text.replace(/'/g, "'\\''");

      if (this.debug) {
        console.log(`[TmuxAdapter] Sending input to remote tmux: ${tmuxTarget}`);
        console.log(`[TmuxAdapter] Text: ${text}`);
      }

      // GASTOWN PATTERN - same timing as local
      // Step 1: Send text in literal mode
      await exec(
        `${sshCmd} "tmux send-keys -t '${tmuxTarget}' -l '${escapedText}'"`,
        { timeout: this.timeout },
      );

      // Step 2: Wait 500ms - MUST be 500ms
      await sleep(500);

      // Step 3: Send Escape
      await exec(
        `${sshCmd} "tmux send-keys -t '${tmuxTarget}' Escape"`,
        { timeout: this.timeout },
      );

      // Step 4: Wait 100ms - MUST be 100ms
      await sleep(100);

      // Step 5: Send Enter
      await exec(
        `${sshCmd} "tmux send-keys -t '${tmuxTarget}' Enter"`,
        { timeout: this.timeout },
      );

      return {
        success: true,
        details: `Sent input to remote tmux ${tmuxTarget}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to send remote tmux input: ${message}`,
      };
    }
  }
}

/**
 * Create a tmux adapter.
 */
export function createTmuxAdapter(options?: TerminalAdapterOptions): TmuxAdapter {
  return new TmuxAdapter(options);
}
