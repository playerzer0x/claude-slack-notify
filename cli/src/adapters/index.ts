/**
 * Terminal Adapters
 *
 * Provides adapters for different terminal emulators and environments.
 * Each adapter implements the TerminalAdapter interface for focus and input operations.
 */

// Interface and types
export type {
  TerminalAdapter,
  TerminalAdapterOptions,
  TerminalResult,
} from './terminal-adapter.js';

// Focus helper runner (used by Mac adapters)
export {
  buildFocusUrlWithAction,
  getFocusHelperPath,
  isFocusHelperAvailable,
  runFocusHelper,
} from './focus-helper-runner.js';

// iTerm2 adapter (macOS)
export { createITerm2Adapter, ITerm2Adapter } from './iterm2-adapter.js';

// Terminal.app adapter (macOS)
export { createTerminalAppAdapter, TerminalAppAdapter } from './terminal-app-adapter.js';

// Tmux adapter (cross-platform)
export { createTmuxAdapter, TmuxAdapter } from './tmux-adapter.js';
