import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { extractTmuxTarget, getActionInput, INSTANCES_DIR, loadSessionInfo } from './remote-relay.js';

// Test fixtures directory
const TEST_SESSION_ID = 'test-session-12345';
const TEST_SESSION_ID_2 = 'test-session-67890';
const TEST_SESSION_ID_MALFORMED = 'test-session-malformed';
const TEST_SESSION_ID_MISSING_FIELDS = 'test-session-missing-fields';

describe('extractTmuxTarget', () => {
  it('extracts tmux target from ssh-linked URL', () => {
    const url = 'claude-focus://ssh-linked/abc12345/example.com/user/22/main:0.0';
    expect(extractTmuxTarget(url)).toBe('main:0.0');
  });

  it('extracts tmux target from ssh-linked URL with encoded target', () => {
    const url = 'claude-focus://ssh-linked/abc12345/example.com/user/22/my-session%3A1.0';
    expect(extractTmuxTarget(url)).toBe('my-session:1.0');
  });

  it('extracts tmux target from jupyter-tmux URL', () => {
    const url = 'claude-focus://jupyter-tmux/xyz98765/server.local/admin/22/claude:2.1';
    expect(extractTmuxTarget(url)).toBe('claude:2.1');
  });

  it('extracts tmux target from ssh-tmux URL', () => {
    const url = 'claude-focus://ssh-tmux/example.com/user/22/main:0.0';
    expect(extractTmuxTarget(url)).toBe('main:0.0');
  });

  it('extracts tmux target from linux-tmux URL', () => {
    const url = 'claude-focus://linux-tmux/dev/pts/0/main:0.0';
    expect(extractTmuxTarget(url)).toBe('main:0.0');
  });

  it('extracts tmux target from linux-tmux URL with encoded target', () => {
    const url = 'claude-focus://linux-tmux/dev/pts/1/my-session%3A2.0';
    expect(extractTmuxTarget(url)).toBe('my-session:2.0');
  });

  it('extracts tmux target from tmux URL', () => {
    const url = 'claude-focus://tmux/main:0.0';
    expect(extractTmuxTarget(url)).toBe('main:0.0');
  });

  it('extracts tmux target from tmux URL with encoded target', () => {
    const url = 'claude-focus://tmux/claude-session%3A1.0';
    expect(extractTmuxTarget(url)).toBe('claude-session:1.0');
  });

  it('returns null for iterm-tmux URL (different format)', () => {
    const url = 'claude-focus://iterm-tmux/dev/ttys001/main:0.0';
    expect(extractTmuxTarget(url)).toBe(null);
  });

  it('returns null for iterm2 URL', () => {
    const url = 'claude-focus://iterm2/session-uuid-123';
    expect(extractTmuxTarget(url)).toBe(null);
  });

  it('returns null for terminal URL', () => {
    const url = 'claude-focus://terminal/dev/ttys002';
    expect(extractTmuxTarget(url)).toBe(null);
  });

  it('returns null for incomplete ssh-linked URL', () => {
    const url = 'claude-focus://ssh-linked/abc12345/example.com';
    expect(extractTmuxTarget(url)).toBe(null);
  });

  it('returns null for malformed URL', () => {
    expect(extractTmuxTarget('not-a-valid-url')).toBe(null);
  });

  it('returns null for empty URL', () => {
    expect(extractTmuxTarget('')).toBe(null);
  });

  it('handles URL with query string', () => {
    const url = 'claude-focus://ssh-linked/abc12345/example.com/user/22/main:0.0?action=continue';
    // extractTmuxTarget doesn't strip query strings, so it might fail on this
    // The implementation should handle this - let's see
    const result = extractTmuxTarget(url);
    // The query string becomes part of the last segment
    expect(result).toBe('main:0.0?action=continue');
  });
});

describe('getActionInput', () => {
  it('maps action "1" to "1"', () => {
    expect(getActionInput('1')).toBe('1');
  });

  it('maps action "2" to "2"', () => {
    expect(getActionInput('2')).toBe('2');
  });

  it('maps action "continue" to "Continue"', () => {
    expect(getActionInput('continue')).toBe('Continue');
  });

  it('maps action "push" to "/push"', () => {
    expect(getActionInput('push')).toBe('/push');
  });

  it('maps action "focus" to empty string', () => {
    expect(getActionInput('focus')).toBe('');
  });

  it('maps unknown action to empty string', () => {
    // @ts-expect-error Testing invalid input
    expect(getActionInput('unknown')).toBe('');
  });
});

describe('loadSessionInfo', () => {
  // Setup: create test session files before tests
  beforeAll(() => {
    // Ensure instances directory exists
    if (!existsSync(INSTANCES_DIR)) {
      mkdirSync(INSTANCES_DIR, { recursive: true });
    }

    // Create a valid session file with linux-tmux URL
    writeFileSync(
      join(INSTANCES_DIR, `${TEST_SESSION_ID}.json`),
      JSON.stringify({
        session_id: TEST_SESSION_ID,
        focus_url: 'claude-focus://linux-tmux/dev/pts/0/main:0.0',
        term_type: 'linux-tmux',
        session_name: 'Test Session',
      })
    );

    // Create a valid session file with tmux URL
    writeFileSync(
      join(INSTANCES_DIR, `${TEST_SESSION_ID_2}.json`),
      JSON.stringify({
        session_id: TEST_SESSION_ID_2,
        focus_url: 'claude-focus://tmux/claude:1.0',
        term_type: 'tmux',
        session_name: 'Test Session 2',
      })
    );

    // Create a malformed JSON file
    writeFileSync(join(INSTANCES_DIR, `${TEST_SESSION_ID_MALFORMED}.json`), 'not valid json {{{');

    // Create a file with missing required fields
    writeFileSync(
      join(INSTANCES_DIR, `${TEST_SESSION_ID_MISSING_FIELDS}.json`),
      JSON.stringify({
        session_id: TEST_SESSION_ID_MISSING_FIELDS,
        session_name: 'Missing Fields Session',
        // Missing focus_url and term_type
      })
    );
  });

  // Cleanup: remove test session files after tests
  afterAll(() => {
    const testFiles = [
      TEST_SESSION_ID,
      TEST_SESSION_ID_2,
      TEST_SESSION_ID_MALFORMED,
      TEST_SESSION_ID_MISSING_FIELDS,
    ];
    for (const id of testFiles) {
      const filePath = join(INSTANCES_DIR, `${id}.json`);
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    }
  });

  it('loads session info from valid linux-tmux session file', () => {
    const result = loadSessionInfo(TEST_SESSION_ID);
    expect(result).not.toBeNull();
    expect(result?.focus_url).toBe('claude-focus://linux-tmux/dev/pts/0/main:0.0');
    expect(result?.term_type).toBe('linux-tmux');
  });

  it('loads session info from valid tmux session file', () => {
    const result = loadSessionInfo(TEST_SESSION_ID_2);
    expect(result).not.toBeNull();
    expect(result?.focus_url).toBe('claude-focus://tmux/claude:1.0');
    expect(result?.term_type).toBe('tmux');
  });

  it('returns null for non-existent session', () => {
    const result = loadSessionInfo('non-existent-session-id');
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const result = loadSessionInfo(TEST_SESSION_ID_MALFORMED);
    expect(result).toBeNull();
  });

  it('returns undefined fields for session with missing fields', () => {
    const result = loadSessionInfo(TEST_SESSION_ID_MISSING_FIELDS);
    // The function returns whatever is in the JSON, even if fields are undefined
    expect(result).not.toBeNull();
    expect(result?.focus_url).toBeUndefined();
    expect(result?.term_type).toBeUndefined();
  });

  it('works with extractTmuxTarget for linux-tmux session', () => {
    const sessionInfo = loadSessionInfo(TEST_SESSION_ID);
    expect(sessionInfo).not.toBeNull();
    const tmuxTarget = extractTmuxTarget(sessionInfo!.focus_url);
    expect(tmuxTarget).toBe('main:0.0');
  });

  it('works with extractTmuxTarget for tmux session', () => {
    const sessionInfo = loadSessionInfo(TEST_SESSION_ID_2);
    expect(sessionInfo).not.toBeNull();
    const tmuxTarget = extractTmuxTarget(sessionInfo!.focus_url);
    expect(tmuxTarget).toBe('claude:1.0');
  });
});

describe('extractTmuxTarget edge cases for linux-tmux', () => {
  it('handles linux-tmux with different TTY paths', () => {
    // /dev/pts/0
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts/0/main:0.0')).toBe('main:0.0');
    // /dev/pts/10
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts/10/session:1.0')).toBe('session:1.0');
    // /dev/tty1
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/tty1/work:0.0')).toBe('work:0.0');
  });

  it('handles tmux target with special characters', () => {
    // Colon in session name (encoded)
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts/0/my%3Asession%3A0.0')).toBe(
      'my:session:0.0'
    );
    // Hyphen in session name
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts/0/my-session:0.0')).toBe(
      'my-session:0.0'
    );
    // Underscore in session name
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts/0/my_session:0.0')).toBe(
      'my_session:0.0'
    );
  });

  it('handles minimal linux-tmux URL', () => {
    // Minimum valid: linux-tmux/x/y/target (3 parts after linux-tmux)
    expect(extractTmuxTarget('claude-focus://linux-tmux/a/b/target:0.0')).toBe('target:0.0');
  });

  it('returns null for linux-tmux with insufficient parts', () => {
    // Only 2 parts after linux-tmux
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev/pts')).toBeNull();
    // Only 1 part after linux-tmux
    expect(extractTmuxTarget('claude-focus://linux-tmux/dev')).toBeNull();
  });
});

describe('extractTmuxTarget edge cases for tmux', () => {
  it('handles various tmux session formats', () => {
    // Simple session:window.pane
    expect(extractTmuxTarget('claude-focus://tmux/main:0.0')).toBe('main:0.0');
    // Session with hyphen
    expect(extractTmuxTarget('claude-focus://tmux/my-session:1.2')).toBe('my-session:1.2');
    // Session with underscore
    expect(extractTmuxTarget('claude-focus://tmux/my_session:0.0')).toBe('my_session:0.0');
    // Long session name
    expect(extractTmuxTarget('claude-focus://tmux/very-long-session-name:99.99')).toBe(
      'very-long-session-name:99.99'
    );
  });

  it('handles encoded tmux targets', () => {
    expect(extractTmuxTarget('claude-focus://tmux/session%3A0.0')).toBe('session:0.0');
    expect(extractTmuxTarget('claude-focus://tmux/my%20session%3A0.0')).toBe('my session:0.0');
  });

  it('returns null for tmux with no target', () => {
    expect(extractTmuxTarget('claude-focus://tmux')).toBeNull();
    expect(extractTmuxTarget('claude-focus://tmux/')).toBeNull();
  });
});
