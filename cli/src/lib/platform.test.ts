/**
 * Unit tests for platform.ts
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  getPlatform,
  isMac,
  isLinux,
  isWindows,
  getUid,
  getTmuxSocketPath,
  getClaudeDir,
  getInstancesDir,
  getLinksDir,
  getThreadsDir,
  getLogsDir,
  getTunnelUrlPath,
  getMacTunnelUrlPath,
  getSlackConfigPath,
  getSlackSigningSecretPath,
  detectTerminalEnv,
  isSSHSession,
  isInsideTmux,
  isInITerm2,
  isInGhostty,
  getTmuxEnv,
  getEnvWithTmuxFallback,
} from './platform';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('Platform detection', () => {
  test('getPlatform returns current platform', () => {
    const platform = getPlatform();
    expect(['darwin', 'linux', 'win32']).toContain(platform);
  });

  test('isMac returns boolean', () => {
    expect(typeof isMac()).toBe('boolean');
  });

  test('isLinux returns boolean', () => {
    expect(typeof isLinux()).toBe('boolean');
  });

  test('isWindows returns boolean', () => {
    expect(typeof isWindows()).toBe('boolean');
  });

  test('exactly one platform function returns true', () => {
    const results = [isMac(), isLinux(), isWindows()];
    const trueCount = results.filter(Boolean).length;
    expect(trueCount).toBe(1);
  });
});

describe('getUid', () => {
  test('returns a number', () => {
    const uid = getUid();
    expect(typeof uid).toBe('number');
    expect(uid).toBeGreaterThanOrEqual(0);
  });
});

describe('getTmuxSocketPath', () => {
  test('returns path with uid', () => {
    const path = getTmuxSocketPath();
    const uid = getUid();
    expect(path).toContain(`tmux-${uid}`);
    expect(path).toContain('default');
  });

  test('uses /private/tmp on Mac', () => {
    if (isMac()) {
      expect(getTmuxSocketPath()).toContain('/private/tmp');
    }
  });

  test('uses /tmp on Linux', () => {
    if (isLinux()) {
      expect(getTmuxSocketPath()).toContain('/tmp');
      expect(getTmuxSocketPath()).not.toContain('/private');
    }
  });
});

describe('Path helpers', () => {
  const home = homedir();
  const claudeDir = join(home, '.claude');

  test('getClaudeDir returns ~/.claude', () => {
    expect(getClaudeDir()).toBe(claudeDir);
  });

  test('getInstancesDir returns ~/.claude/instances', () => {
    expect(getInstancesDir()).toBe(join(claudeDir, 'instances'));
  });

  test('getLinksDir returns ~/.claude/links', () => {
    expect(getLinksDir()).toBe(join(claudeDir, 'links'));
  });

  test('getThreadsDir returns ~/.claude/threads', () => {
    expect(getThreadsDir()).toBe(join(claudeDir, 'threads'));
  });

  test('getLogsDir returns ~/.claude/logs', () => {
    expect(getLogsDir()).toBe(join(claudeDir, 'logs'));
  });

  test('getTunnelUrlPath returns ~/.claude/.tunnel-url', () => {
    expect(getTunnelUrlPath()).toBe(join(claudeDir, '.tunnel-url'));
  });

  test('getMacTunnelUrlPath returns ~/.claude/.mac-tunnel-url', () => {
    expect(getMacTunnelUrlPath()).toBe(join(claudeDir, '.mac-tunnel-url'));
  });

  test('getSlackConfigPath returns ~/.claude/.slack-config', () => {
    expect(getSlackConfigPath()).toBe(join(claudeDir, '.slack-config'));
  });

  test('getSlackSigningSecretPath returns correct path', () => {
    expect(getSlackSigningSecretPath()).toBe(join(claudeDir, 'slack-signing-secret'));
  });
});

describe('detectTerminalEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.ITERM_SESSION_ID;
    delete process.env.GHOSTTY_RESOURCES_DIR;
    delete process.env.TMUX;
    delete process.env.TMUX_PANE;
    delete process.env.WT_SESSION;
    delete process.env.KONSOLE_DBUS_SESSION;
    delete process.env.TERM_PROGRAM;
    delete process.env.SSH_CONNECTION;
    delete process.env.CLAUDE_LINK_ID;
    delete process.env.CLAUDE_TMUX_SESSION;
    delete process.env.CLAUDE_TMUX_TARGET;
    delete process.env.CLAUDE_ITERM_SESSION_ID;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  test('returns empty object with no env vars', () => {
    const env = detectTerminalEnv();
    expect(env.itermSessionId).toBeUndefined();
    expect(env.tmux).toBeUndefined();
    expect(env.wtSession).toBeUndefined();
  });

  test('detects iTerm2', () => {
    process.env.ITERM_SESSION_ID = 'w0t0p0:ABC-123';
    const env = detectTerminalEnv();
    expect(env.itermSessionId).toBe('w0t0p0:ABC-123');
  });

  test('detects Ghostty via GHOSTTY_RESOURCES_DIR', () => {
    process.env.GHOSTTY_RESOURCES_DIR = '/Applications/Ghostty.app/Contents/Resources/ghostty';
    const env = detectTerminalEnv();
    expect(env.ghosttyResourcesDir).toBe('/Applications/Ghostty.app/Contents/Resources/ghostty');
  });

  test('detects tmux', () => {
    process.env.TMUX = '/tmp/tmux-501/default,1234,0';
    process.env.TMUX_PANE = '%0';
    const env = detectTerminalEnv();
    expect(env.tmux).toBe('/tmp/tmux-501/default,1234,0');
    expect(env.tmuxPane).toBe('%0');
  });

  test('detects Windows Terminal', () => {
    process.env.WT_SESSION = 'wt-session-abc';
    const env = detectTerminalEnv();
    expect(env.wtSession).toBe('wt-session-abc');
  });

  test('detects Konsole', () => {
    process.env.KONSOLE_DBUS_SESSION = '/Sessions/1';
    const env = detectTerminalEnv();
    expect(env.konsoleDbusSession).toBe('/Sessions/1');
  });

  test('detects VS Code terminal', () => {
    process.env.TERM_PROGRAM = 'vscode';
    const env = detectTerminalEnv();
    expect(env.vscodeTerminal).toBe(true);
    expect(env.termProgram).toBe('vscode');
  });

  test('detects SSH connection', () => {
    process.env.SSH_CONNECTION = '192.168.1.100 54321 192.168.1.1 22';
    const env = detectTerminalEnv();
    expect(env.sshConnection).toBe('192.168.1.100 54321 192.168.1.1 22');
  });

  test('detects Claude-specific env vars', () => {
    process.env.CLAUDE_LINK_ID = 'link-123';
    process.env.CLAUDE_TMUX_SESSION = 'claude-session';
    process.env.CLAUDE_TMUX_TARGET = 'claude:0.0';
    process.env.CLAUDE_ITERM_SESSION_ID = 'w0t0p0:ABC';

    const env = detectTerminalEnv();
    expect(env.claudeLinkId).toBe('link-123');
    expect(env.claudeTmuxSession).toBe('claude-session');
    expect(env.claudeTmuxTarget).toBe('claude:0.0');
    expect(env.claudeItermSessionId).toBe('w0t0p0:ABC');
  });

  test('detects multiple env vars together', () => {
    process.env.ITERM_SESSION_ID = 'iterm-abc';
    process.env.TMUX = '/tmp/tmux-501/default,1234,0';
    process.env.SSH_CONNECTION = '1.2.3.4 5678 5.6.7.8 22';

    const env = detectTerminalEnv();
    expect(env.itermSessionId).toBe('iterm-abc');
    expect(env.tmux).toBeDefined();
    expect(env.sshConnection).toBeDefined();
  });
});

describe('Convenience detection functions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SSH_CONNECTION;
    delete process.env.TMUX;
    delete process.env.ITERM_SESSION_ID;
    delete process.env.GHOSTTY_RESOURCES_DIR;
    delete process.env.TERM_PROGRAM;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  describe('isSSHSession', () => {
    test('returns false without SSH_CONNECTION', () => {
      expect(isSSHSession()).toBe(false);
    });

    test('returns true with SSH_CONNECTION', () => {
      process.env.SSH_CONNECTION = '1.2.3.4 5678 5.6.7.8 22';
      expect(isSSHSession()).toBe(true);
    });
  });

  describe('isInsideTmux', () => {
    test('returns false without TMUX', () => {
      expect(isInsideTmux()).toBe(false);
    });

    test('returns true with TMUX', () => {
      process.env.TMUX = '/tmp/tmux-501/default,1234,0';
      expect(isInsideTmux()).toBe(true);
    });
  });

  describe('isInITerm2', () => {
    test('returns false without ITERM_SESSION_ID', () => {
      expect(isInITerm2()).toBe(false);
    });

    test('returns true with ITERM_SESSION_ID', () => {
      process.env.ITERM_SESSION_ID = 'w0t0p0:ABC';
      expect(isInITerm2()).toBe(true);
    });
  });

  describe('isInGhostty', () => {
    test('returns false without Ghostty env vars', () => {
      expect(isInGhostty()).toBe(false);
    });

    test('returns true with GHOSTTY_RESOURCES_DIR', () => {
      process.env.GHOSTTY_RESOURCES_DIR = '/path/to/ghostty/resources';
      expect(isInGhostty()).toBe(true);
    });

    test('returns true with TERM_PROGRAM=ghostty', () => {
      process.env.TERM_PROGRAM = 'ghostty';
      expect(isInGhostty()).toBe(true);
    });
  });
});

describe('Tmux environment fallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TMUX;
    delete process.env.CLAUDE_LINK_ID;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  describe('getTmuxEnv', () => {
    test('returns undefined when not in tmux', () => {
      expect(getTmuxEnv('CLAUDE_LINK_ID')).toBeUndefined();
    });

    // Note: Full tmux session env tests require actual tmux session
    // The edge case tests in bin/test-edge-cases.sh provide E2E coverage
  });

  describe('getEnvWithTmuxFallback', () => {
    test('returns shell env value when set', () => {
      process.env.CLAUDE_LINK_ID = 'shell-link';
      expect(getEnvWithTmuxFallback('CLAUDE_LINK_ID')).toBe('shell-link');
    });

    test('returns undefined when not set and not in tmux', () => {
      expect(getEnvWithTmuxFallback('CLAUDE_LINK_ID')).toBeUndefined();
    });
  });

  describe('detectTerminalEnv with new fields', () => {
    test('detects claudeSshHost', () => {
      process.env.CLAUDE_SSH_HOST = 'test-host';
      const env = detectTerminalEnv();
      expect(env.claudeSshHost).toBe('test-host');
    });

    test('detects claudeSshPort', () => {
      process.env.CLAUDE_SSH_PORT = '2222';
      const env = detectTerminalEnv();
      expect(env.claudeSshPort).toBe('2222');
    });

    test('detects claudeInstanceName', () => {
      process.env.CLAUDE_INSTANCE_NAME = 'my-session';
      const env = detectTerminalEnv();
      expect(env.claudeInstanceName).toBe('my-session');
    });
  });
});
