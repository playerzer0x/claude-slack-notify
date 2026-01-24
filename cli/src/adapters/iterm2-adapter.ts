/**
 * iTerm2 Terminal Adapter
 *
 * Handles terminal operations for iTerm2 on macOS.
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
 * iTerm2 adapter that uses focus-helper for terminal operations.
 *
 * Target format: session ID (UUID like "w0t0p0:..." or full UUID)
 */
export class ITerm2Adapter implements TerminalAdapter {
  private readonly debug: boolean;
  private readonly timeout: number;

  constructor(options: TerminalAdapterOptions = {}) {
    this.debug = options.debug ?? false;
    this.timeout = options.timeout ?? 30000;
  }

  /**
   * Focus an iTerm2 session by session ID.
   *
   * @param target - iTerm2 session ID
   */
  async focus(target: string): Promise<TerminalResult> {
    if (!isFocusHelperAvailable()) {
      return {
        success: false,
        error: 'focus-helper not available - iTerm2 focus requires macOS with focus-helper installed',
      };
    }

    // Build focus URL: claude-focus://iterm2/SESSION_ID
    const focusUrl = `claude-focus://iterm2/${encodeURIComponent(target)}`;

    if (this.debug) {
      console.log(`[ITerm2Adapter] Focusing session: ${target}`);
      console.log(`[ITerm2Adapter] Focus URL: ${focusUrl}`);
    }

    return runFocusHelper(focusUrl, this.timeout);
  }

  /**
   * Send text input to an iTerm2 session.
   *
   * @param target - iTerm2 session ID
   * @param text - Text to send
   */
  async sendInput(target: string, text: string): Promise<TerminalResult> {
    if (!isFocusHelperAvailable()) {
      return {
        success: false,
        error: 'focus-helper not available - iTerm2 input requires macOS with focus-helper installed',
      };
    }

    // Build focus URL with text parameter: claude-focus://iterm2/SESSION_ID?text=...
    const baseUrl = `claude-focus://iterm2/${encodeURIComponent(target)}`;
    const focusUrl = buildFocusUrlWithAction(baseUrl, undefined, text);

    if (this.debug) {
      console.log(`[ITerm2Adapter] Sending input to session: ${target}`);
      console.log(`[ITerm2Adapter] Text: ${text}`);
      console.log(`[ITerm2Adapter] Focus URL: ${focusUrl}`);
    }

    return runFocusHelper(focusUrl, this.timeout);
  }
}

/**
 * Create an iTerm2 adapter.
 */
export function createITerm2Adapter(options?: TerminalAdapterOptions): ITerm2Adapter {
  return new ITerm2Adapter(options);
}
