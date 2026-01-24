/**
 * Terminal Adapter Interface
 *
 * Defines the contract for terminal adapters that handle focus and input operations.
 * Each adapter implements terminal-specific logic for switching focus and sending input.
 */

/**
 * Result of a terminal operation.
 */
export interface TerminalResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Optional error message if failed */
  error?: string;
  /** Optional details about what was done */
  details?: string;
}

/**
 * Terminal adapter interface.
 * All terminal adapters must implement these methods.
 */
export interface TerminalAdapter {
  /**
   * Focus the terminal at the given target.
   * What "target" means depends on the adapter (tmux target, TTY, session ID, etc.)
   *
   * @param target - The terminal target to focus
   * @returns Result of the focus operation
   */
  focus(target: string): Promise<TerminalResult>;

  /**
   * Send text input to the terminal at the given target.
   * The text is sent and submitted (Enter pressed).
   *
   * @param target - The terminal target to send input to
   * @param text - The text to send
   * @returns Result of the send operation
   */
  sendInput(target: string, text: string): Promise<TerminalResult>;
}

/**
 * Options for creating a terminal adapter.
 */
export interface TerminalAdapterOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom tmux socket path (for tmux-based adapters) */
  tmuxSocket?: string;
  /** Timeout in milliseconds for operations */
  timeout?: number;
}
