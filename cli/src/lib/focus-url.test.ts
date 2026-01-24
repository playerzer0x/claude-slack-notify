/**
 * Unit tests for focus-url.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  buildFocusUrl,
  parseFocusUrl,
  extractTmuxTarget,
  isRemoteSessionUrl,
  isMacSessionUrl,
  type FocusUrlParams,
} from './focus-url';

describe('buildFocusUrl', () => {
  describe('local-tmux', () => {
    test('builds with iTerm session ID and tmux target', () => {
      const params: FocusUrlParams = {
        type: 'local-tmux',
        itermSessionId: 'w0t0p0:abc-123',
        tmuxTarget: 'claude:0.0',
      };
      expect(buildFocusUrl(params)).toBe(
        'claude-focus://local-tmux/w0t0p0%3Aabc-123/claude%3A0.0'
      );
    });

    test('builds with tmux target only (old format)', () => {
      const params: FocusUrlParams = {
        type: 'local-tmux',
        tmuxTarget: 'session:0',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://local-tmux/session%3A0');
    });

    test('throws error without tmux target', () => {
      const params: FocusUrlParams = { type: 'local-tmux' };
      expect(() => buildFocusUrl(params)).toThrow('local-tmux requires tmuxTarget');
    });
  });

  describe('ssh-linked', () => {
    test('builds complete URL', () => {
      const params: FocusUrlParams = {
        type: 'ssh-linked',
        linkId: 'link-abc',
        host: 'server.example.com',
        user: 'deploy',
        port: 2222,
        tmuxTarget: 'remote:0.0',
      };
      expect(buildFocusUrl(params)).toBe(
        'claude-focus://ssh-linked/link-abc/server.example.com/deploy/2222/remote%3A0.0'
      );
    });

    test('uses default port 22', () => {
      const params: FocusUrlParams = {
        type: 'ssh-linked',
        linkId: 'link-abc',
        host: 'server.com',
        user: 'user',
        tmuxTarget: 'session:0',
      };
      expect(buildFocusUrl(params)).toContain('/22/');
    });

    test('throws error for missing fields', () => {
      expect(() =>
        buildFocusUrl({ type: 'ssh-linked', linkId: 'a', host: 'b', user: 'c' })
      ).toThrow('ssh-linked requires');
    });
  });

  describe('ssh-tmux', () => {
    test('builds URL without link ID', () => {
      const params: FocusUrlParams = {
        type: 'ssh-tmux',
        host: 'server.com',
        user: 'admin',
        port: 22,
        tmuxTarget: 'session:0.0',
      };
      expect(buildFocusUrl(params)).toBe(
        'claude-focus://ssh-tmux/server.com/admin/22/session%3A0.0'
      );
    });
  });

  describe('jupyter-tmux', () => {
    test('builds URL like ssh-linked', () => {
      const params: FocusUrlParams = {
        type: 'jupyter-tmux',
        linkId: 'jupyter-link',
        host: 'notebook.server.com',
        user: 'jupyter',
        port: 22,
        tmuxTarget: 'jupyter:0.0',
      };
      expect(buildFocusUrl(params)).toContain('jupyter-tmux/');
    });
  });

  describe('linux-tmux', () => {
    test('builds with tty and tmux target', () => {
      const params: FocusUrlParams = {
        type: 'linux-tmux',
        tty: '/dev/pts/0',
        tmuxTarget: 'session:0.0',
      };
      expect(buildFocusUrl(params)).toBe(
        'claude-focus://linux-tmux/%2Fdev%2Fpts%2F0/session%3A0.0'
      );
    });
  });

  describe('tmux', () => {
    test('builds simple tmux URL', () => {
      const params: FocusUrlParams = {
        type: 'tmux',
        tmuxTarget: 'main:0.0',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://tmux/main%3A0.0');
    });
  });

  describe('iterm2', () => {
    test('builds with session ID', () => {
      const params: FocusUrlParams = {
        type: 'iterm2',
        itermSessionId: 'w0t0p0:ABC-123-DEF',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://iterm2/w0t0p0:ABC-123-DEF');
    });
  });

  describe('iterm-tmux', () => {
    test('builds with tty and tmux target', () => {
      const params: FocusUrlParams = {
        type: 'iterm-tmux',
        tty: '/dev/ttys001',
        tmuxTarget: 'session:0',
      };
      expect(buildFocusUrl(params)).toContain('iterm-tmux/');
    });
  });

  describe('terminal', () => {
    test('builds with tty', () => {
      const params: FocusUrlParams = {
        type: 'terminal',
        tty: '/dev/ttys000',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://terminal/%2Fdev%2Fttys000');
    });

    test('builds with frontmost', () => {
      const params: FocusUrlParams = {
        type: 'terminal',
        tty: 'frontmost',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://terminal/frontmost');
    });
  });

  describe('Windows terminals', () => {
    test('builds wt-tmux', () => {
      const params: FocusUrlParams = {
        type: 'wt-tmux',
        wtSession: 'wt-session-id',
        tmuxTarget: 'session:0',
      };
      expect(buildFocusUrl(params)).toContain('wt-tmux/');
    });

    test('builds windows-terminal', () => {
      const params: FocusUrlParams = {
        type: 'windows-terminal',
        wtSession: 'wt-session-id',
      };
      expect(buildFocusUrl(params)).toContain('windows-terminal/');
    });

    test('builds wsl-tmux', () => {
      const params: FocusUrlParams = {
        type: 'wsl-tmux',
        windowId: 'window-123',
        tmuxTarget: 'session:0',
      };
      expect(buildFocusUrl(params)).toContain('wsl-tmux/');
    });

    test('builds wsl', () => {
      const params: FocusUrlParams = {
        type: 'wsl',
        windowId: 'window-123',
      };
      expect(buildFocusUrl(params)).toContain('wsl/');
    });
  });

  describe('Other terminals', () => {
    test('builds conemu', () => {
      const params: FocusUrlParams = { type: 'conemu', pid: '1234' };
      expect(buildFocusUrl(params)).toBe('claude-focus://conemu/1234');
    });

    test('builds mintty', () => {
      const params: FocusUrlParams = { type: 'mintty', pid: '5678' };
      expect(buildFocusUrl(params)).toBe('claude-focus://mintty/5678');
    });

    test('builds gnome-terminal', () => {
      const params: FocusUrlParams = { type: 'gnome-terminal', pid: '9999' };
      expect(buildFocusUrl(params)).toBe('claude-focus://gnome-terminal/9999');
    });

    test('builds konsole', () => {
      const params: FocusUrlParams = { type: 'konsole', dbusSession: 'session-abc' };
      expect(buildFocusUrl(params)).toBe('claude-focus://konsole/session-abc');
    });

    test('builds vscode', () => {
      const params: FocusUrlParams = { type: 'vscode', pid: '1111' };
      expect(buildFocusUrl(params)).toBe('claude-focus://vscode/1111');
    });
  });

  describe('Action query param', () => {
    test('adds action to URL', () => {
      const params: FocusUrlParams = {
        type: 'iterm2',
        itermSessionId: 'abc',
        action: 'focus',
      };
      expect(buildFocusUrl(params)).toBe('claude-focus://iterm2/abc?action=focus');
    });
  });
});

describe('parseFocusUrl', () => {
  describe('local-tmux', () => {
    test('parses new format with iTerm ID', () => {
      const url = 'claude-focus://local-tmux/w0t0p0%3Aabc/claude%3A0.0';
      const result = parseFocusUrl(url);
      expect(result).toEqual({
        type: 'local-tmux',
        itermSessionId: 'w0t0p0:abc',
        tmuxTarget: 'claude:0.0',
        action: undefined,
      });
    });

    test('parses old format with tmux target only', () => {
      const url = 'claude-focus://local-tmux/session%3A0';
      const result = parseFocusUrl(url);
      expect(result?.type).toBe('local-tmux');
      expect(result?.tmuxTarget).toBe('session:0');
    });
  });

  describe('ssh-linked', () => {
    test('parses full URL', () => {
      const url = 'claude-focus://ssh-linked/link123/host.com/user/22/target%3A0.0';
      const result = parseFocusUrl(url);
      expect(result).toEqual({
        type: 'ssh-linked',
        linkId: 'link123',
        host: 'host.com',
        user: 'user',
        port: 22,
        tmuxTarget: 'target:0.0',
        action: undefined,
      });
    });
  });

  describe('ssh-tmux', () => {
    test('parses URL', () => {
      const url = 'claude-focus://ssh-tmux/host.com/user/2222/target%3A0';
      const result = parseFocusUrl(url);
      expect(result?.type).toBe('ssh-tmux');
      expect(result?.port).toBe(2222);
    });
  });

  describe('linux-tmux', () => {
    test('parses URL with multi-part TTY path', () => {
      const url = 'claude-focus://linux-tmux/%2Fdev%2Fpts%2F0/session%3A0.0';
      const result = parseFocusUrl(url);
      expect(result?.type).toBe('linux-tmux');
      expect(result?.tty).toBe('/dev/pts/0');
      expect(result?.tmuxTarget).toBe('session:0.0');
    });
  });

  describe('iterm2', () => {
    test('parses session ID', () => {
      const url = 'claude-focus://iterm2/w0t0p0:ABC-123-DEF';
      const result = parseFocusUrl(url);
      expect(result?.type).toBe('iterm2');
      expect(result?.itermSessionId).toBe('w0t0p0:ABC-123-DEF');
    });
  });

  describe('terminal', () => {
    test('parses tty path', () => {
      const url = 'claude-focus://terminal/%2Fdev%2Fttys000';
      const result = parseFocusUrl(url);
      expect(result?.tty).toBe('/dev/ttys000');
    });

    test('parses frontmost', () => {
      const url = 'claude-focus://terminal/frontmost';
      const result = parseFocusUrl(url);
      expect(result?.tty).toBe('frontmost');
    });
  });

  describe('Query params', () => {
    test('parses action query param', () => {
      const url = 'claude-focus://iterm2/abc?action=focus';
      const result = parseFocusUrl(url);
      expect(result?.action).toBe('focus');
    });

    test('handles URL without query params', () => {
      const url = 'claude-focus://iterm2/abc';
      const result = parseFocusUrl(url);
      expect(result?.action).toBeUndefined();
    });
  });

  describe('Invalid URLs', () => {
    test('returns null for non-focus URLs', () => {
      expect(parseFocusUrl('https://example.com')).toBeNull();
      expect(parseFocusUrl('file:///path')).toBeNull();
      expect(parseFocusUrl('not-a-url')).toBeNull();
    });

    test('returns null for unknown types', () => {
      expect(parseFocusUrl('claude-focus://unknown-type/123')).toBeNull();
    });

    test('returns null for malformed URLs', () => {
      expect(parseFocusUrl('claude-focus://')).toBeNull();
      expect(parseFocusUrl('claude-focus://iterm2')).toBeNull();
    });
  });
});

describe('extractTmuxTarget', () => {
  test('extracts from ssh-linked', () => {
    const url = 'claude-focus://ssh-linked/link/host/user/22/session%3A0.0';
    expect(extractTmuxTarget(url)).toBe('session:0.0');
  });

  test('extracts from tmux', () => {
    const url = 'claude-focus://tmux/main%3A0.0';
    expect(extractTmuxTarget(url)).toBe('main:0.0');
  });

  test('extracts from local-tmux', () => {
    const url = 'claude-focus://local-tmux/iterm-id/target%3A0';
    expect(extractTmuxTarget(url)).toBe('target:0');
  });

  test('returns null for non-tmux URLs', () => {
    const url = 'claude-focus://iterm2/abc';
    expect(extractTmuxTarget(url)).toBeNull();
  });

  test('returns null for invalid URLs', () => {
    expect(extractTmuxTarget('not-a-url')).toBeNull();
  });
});

describe('isRemoteSessionUrl', () => {
  test('returns true for remote types', () => {
    expect(isRemoteSessionUrl('claude-focus://ssh-linked/a/b/c/22/d')).toBe(true);
    expect(isRemoteSessionUrl('claude-focus://ssh-tmux/a/b/22/c')).toBe(true);
    expect(isRemoteSessionUrl('claude-focus://jupyter-tmux/a/b/c/22/d')).toBe(true);
    expect(isRemoteSessionUrl('claude-focus://linux-tmux/%2Fdev%2Fpts%2F0/s%3A0')).toBe(true);
    expect(isRemoteSessionUrl('claude-focus://tmux/session%3A0')).toBe(true);
  });

  test('returns false for Mac types', () => {
    expect(isRemoteSessionUrl('claude-focus://iterm2/abc')).toBe(false);
    expect(isRemoteSessionUrl('claude-focus://terminal/%2Fdev%2Fttys000')).toBe(false);
    expect(isRemoteSessionUrl('claude-focus://local-tmux/target')).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(isRemoteSessionUrl('not-a-url')).toBe(false);
  });
});

describe('isMacSessionUrl', () => {
  test('returns true for Mac types', () => {
    expect(isMacSessionUrl('claude-focus://iterm2/abc')).toBe(true);
    expect(isMacSessionUrl('claude-focus://iterm-tmux/%2Fdev%2Fttys0/s')).toBe(true);
    expect(isMacSessionUrl('claude-focus://terminal/%2Fdev%2Fttys000')).toBe(true);
    expect(isMacSessionUrl('claude-focus://local-tmux/target')).toBe(true);
  });

  test('returns false for remote types', () => {
    expect(isMacSessionUrl('claude-focus://ssh-linked/a/b/c/22/d')).toBe(false);
    expect(isMacSessionUrl('claude-focus://tmux/session')).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(isMacSessionUrl('not-a-url')).toBe(false);
  });
});

describe('round-trip tests', () => {
  const testCases: FocusUrlParams[] = [
    { type: 'local-tmux', itermSessionId: 'w0t0p0:abc', tmuxTarget: 'session:0.0' },
    { type: 'local-tmux', tmuxTarget: 'session:0' },
    { type: 'ssh-linked', linkId: 'link', host: 'host.com', user: 'user', port: 22, tmuxTarget: 'target:0' },
    { type: 'ssh-tmux', host: 'host.com', user: 'user', port: 2222, tmuxTarget: 'target:0' },
    { type: 'tmux', tmuxTarget: 'main:0.0' },
    { type: 'iterm2', itermSessionId: 'w0t0p0:ABC-123' },
    { type: 'terminal', tty: '/dev/ttys000' },
    { type: 'terminal', tty: 'frontmost' },
    { type: 'gnome-terminal', pid: '1234' },
    { type: 'konsole', dbusSession: 'session-abc' },
  ];

  test('build and parse produces same params', () => {
    for (const params of testCases) {
      const url = buildFocusUrl(params);
      const parsed = parseFocusUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(params.type);

      // Check relevant fields based on type
      if (params.tmuxTarget) {
        expect(parsed!.tmuxTarget).toBe(params.tmuxTarget);
      }
      if (params.itermSessionId) {
        expect(parsed!.itermSessionId).toBe(params.itermSessionId);
      }
      if (params.tty) {
        expect(parsed!.tty).toBe(params.tty);
      }
      if (params.pid) {
        expect(parsed!.pid).toBe(params.pid);
      }
    }
  });
});
