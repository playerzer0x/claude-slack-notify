/**
 * Terminal.app Adapter
 *
 * Handles terminal operations for macOS Terminal.app.
 * Delegates to focus-helper for actual AppleScript interactions.
 */

import {
  buildFocusUrlWithAction,
  isFocusHelperAvailable,
  runFocusHelper,
} from './focus-helper-runner.js';
import type {
  TerminalAdapter,
  TerminalAdapterOptions,
  TerminalResult,
} from './terminal-adapter.js';

/**
 * Terminal.app adapter that uses focus-helper for terminal operations.
 *
 * Target format: TTY path (e.g., /dev/ttys001) or "frontmost"
 */
export class TerminalAppAdapter implements TerminalAdapter {
  private readonly debug: boolean;
  private readonly timeout: number;

  constructor(options: TerminalAdapterOptions = {}) {
    this.debug = options.debug ?? false;
    this.timeout = options.timeout ?? 30000;
  }

  /**
   * Focus a Terminal.app tab by TTY path.
   *
   * @param target - TTY path (e.g., /dev/ttys001) or "frontmost"
   */
  async focus(target: string): Promise<TerminalResult> {
    if (!isFocusHelperAvailable()) {
      return {
        success: false,
        error: 'focus-helper not available - Terminal.app focus requires macOS with focus-helper installed',
      };
    }

    // Build focus URL: claude-focus://terminal/TTY_PATH
    // For frontmost: claude-focus://terminal/frontmost
    const focusUrl = `claude-focus://terminal/${encodeURIComponent(target)}`;

    if (this.debug) {
      console.log(`[TerminalAppAdapter] Focusing TTY: ${target}`);
      console.log(`[TerminalAppAdapter] Focus URL: ${focusUrl}`);
    }

    return runFocusHelper(focusUrl, this.timeout);
  }

  /**
   * Send text input to a Terminal.app tab.
   *
   * @param target - TTY path (e.g., /dev/ttys001) or "frontmost"
   * @param text - Text to send
   */
  async sendInput(target: string, text: string): Promise<TerminalResult> {
    if (!isFocusHelperAvailable()) {
      return {
        success: false,
        error: 'focus-helper not available - Terminal.app input requires macOS with focus-helper installed',
      };
    }

    // Build focus URL with text parameter: claude-focus://terminal/TTY?text=...
    const baseUrl = `claude-focus://terminal/${encodeURIComponent(target)}`;
    const focusUrl = buildFocusUrlWithAction(baseUrl, undefined, text);

    if (this.debug) {
      console.log(`[TerminalAppAdapter] Sending input to TTY: ${target}`);
      console.log(`[TerminalAppAdapter] Text: ${text}`);
      console.log(`[TerminalAppAdapter] Focus URL: ${focusUrl}`);
    }

    return runFocusHelper(focusUrl, this.timeout);
  }
}

/**
 * Create a Terminal.app adapter.
 */
export function createTerminalAppAdapter(options?: TerminalAdapterOptions): TerminalAppAdapter {
  return new TerminalAppAdapter(options);
}
