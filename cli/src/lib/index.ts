/**
 * CLI Library Modules
 *
 * Shared utilities for claude-slack-notify CLI and MCP server.
 */

// Slack message formatting
export {
  formatToolCall,
  type ToolPrefix,
  type ToolUse,
} from './slack-formatter.js';

// Button value encoding/decoding
export {
  buildButtonValue,
  extractAction,
  extractSessionId,
  getActionInput,
  hasDirectUrl,
  isValidAction,
  parseButtonValue,
  type ButtonAction,
} from './button-value.js';

// Focus URL building and parsing
export {
  buildFocusUrl,
  extractTmuxTarget,
  isMacSessionUrl,
  isRemoteSessionUrl,
  parseFocusUrl,
  type FocusUrlParams,
  type FocusUrlType,
} from './focus-url.js';

// Platform detection
export {
  detectTerminalEnv,
  getClaudeDir,
  getEnvWithTmuxFallback,
  getInstancesDir,
  getLinksDir,
  getLogsDir,
  getMacTunnelUrlPath,
  getPlatform,
  getSlackConfigPath,
  getSlackSigningSecretPath,
  getThreadsDir,
  getTmuxEnv,
  getTmuxSocketPath,
  getTunnelUrlPath,
  getUid,
  isInITerm2,
  isInsideTmux,
  isLinux,
  isMac,
  isSSHSession,
  isTmuxRunning,
  isWindows,
  type Platform,
  type TerminalEnv,
} from './platform.js';
