/**
 * Unit tests for button-value.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  buildButtonValue,
  parseButtonValue,
  hasDirectUrl,
  extractSessionId,
  extractAction,
  isValidAction,
  getActionInput,
} from './button-value';

describe('buildButtonValue', () => {
  test('builds valid button value with focus URL', () => {
    const result = buildButtonValue('claude-focus://iterm2/abc-123', 'focus');
    expect(result).toBe('url:claude-focus://iterm2/abc-123|focus');
  });

  test('builds value with different actions', () => {
    const url = 'claude-focus://tmux/session:0.0';
    expect(buildButtonValue(url, '1')).toBe('url:claude-focus://tmux/session:0.0|1');
    expect(buildButtonValue(url, '2')).toBe('url:claude-focus://tmux/session:0.0|2');
    expect(buildButtonValue(url, 'continue')).toBe('url:claude-focus://tmux/session:0.0|continue');
    expect(buildButtonValue(url, 'push')).toBe('url:claude-focus://tmux/session:0.0|push');
  });

  test('throws error when value exceeds 2000 characters', () => {
    const longPath = 'a'.repeat(2000);
    const longUrl = `claude-focus://test/${longPath}`;
    expect(() => buildButtonValue(longUrl, 'focus')).toThrow('Button value exceeds Slack limit');
  });

  test('handles URLs with special characters', () => {
    const url = 'claude-focus://ssh-linked/link123/host.example.com/user/22/session%3A0.0';
    const result = buildButtonValue(url, 'focus');
    expect(result).toBe(`url:${url}|focus`);
  });
});

describe('parseButtonValue', () => {
  test('parses url: prefix format', () => {
    const value = 'url:claude-focus://iterm2/abc-123|focus';
    const result = parseButtonValue(value);
    expect(result).toEqual({
      focusUrl: 'claude-focus://iterm2/abc-123',
      action: 'focus',
    });
  });

  test('parses value with different actions', () => {
    expect(parseButtonValue('url:claude-focus://tmux/target|1')?.action).toBe('1');
    expect(parseButtonValue('url:claude-focus://tmux/target|2')?.action).toBe('2');
    expect(parseButtonValue('url:claude-focus://tmux/target|continue')?.action).toBe('continue');
    expect(parseButtonValue('url:claude-focus://tmux/target|push')?.action).toBe('push');
  });

  test('handles complex URLs with pipes in them', () => {
    // URL should not contain pipes, but use lastIndexOf to be safe
    const value = 'url:claude-focus://test/path|focus';
    const result = parseButtonValue(value);
    expect(result?.focusUrl).toBe('claude-focus://test/path');
  });

  test('returns null for legacy session_id format', () => {
    const value = 'session-abc-123|focus';
    expect(parseButtonValue(value)).toBeNull();
  });

  test('returns null for missing pipe', () => {
    expect(parseButtonValue('url:claude-focus://test/path')).toBeNull();
    expect(parseButtonValue('session-id-no-action')).toBeNull();
  });

  test('returns null for empty parts', () => {
    expect(parseButtonValue('url:|focus')).toBeNull();
    expect(parseButtonValue('url:claude-focus://test|')).toBeNull();
    expect(parseButtonValue('|action')).toBeNull();
    expect(parseButtonValue('sessionid|')).toBeNull();
  });
});

describe('hasDirectUrl', () => {
  test('returns true for url: prefix', () => {
    expect(hasDirectUrl('url:claude-focus://iterm2/123|focus')).toBe(true);
    expect(hasDirectUrl('url:anything|action')).toBe(true);
  });

  test('returns false for legacy format', () => {
    expect(hasDirectUrl('session-id|focus')).toBe(false);
    expect(hasDirectUrl('abc-123-def|1')).toBe(false);
  });
});

describe('extractSessionId', () => {
  test('returns null for url: format', () => {
    expect(extractSessionId('url:claude-focus://test|focus')).toBeNull();
  });

  test('extracts session ID from legacy format', () => {
    expect(extractSessionId('session-abc-123|focus')).toBe('session-abc-123');
    expect(extractSessionId('my-long-session-id|1')).toBe('my-long-session-id');
  });

  test('returns null for missing pipe', () => {
    expect(extractSessionId('no-pipe-here')).toBeNull();
  });

  test('returns null for empty session ID', () => {
    expect(extractSessionId('|action')).toBeNull();
  });
});

describe('extractAction', () => {
  test('extracts action from url: format', () => {
    expect(extractAction('url:claude-focus://test|focus')).toBe('focus');
    expect(extractAction('url:claude-focus://test|1')).toBe('1');
  });

  test('extracts action from legacy format', () => {
    expect(extractAction('session-id|focus')).toBe('focus');
    expect(extractAction('session-id|continue')).toBe('continue');
  });

  test('returns null for missing pipe', () => {
    expect(extractAction('no-pipe')).toBeNull();
  });

  test('returns null for empty action', () => {
    expect(extractAction('session-id|')).toBeNull();
    expect(extractAction('url:test|')).toBeNull();
  });

  test('handles multiple pipes by using last one', () => {
    // Edge case: if URL somehow has pipes
    expect(extractAction('part1|part2|action')).toBe('action');
  });
});

describe('isValidAction', () => {
  test('returns true for valid actions', () => {
    expect(isValidAction('focus')).toBe(true);
    expect(isValidAction('1')).toBe(true);
    expect(isValidAction('2')).toBe(true);
    expect(isValidAction('continue')).toBe(true);
    expect(isValidAction('push')).toBe(true);
  });

  test('returns false for invalid actions', () => {
    expect(isValidAction('invalid')).toBe(false);
    expect(isValidAction('3')).toBe(false);
    expect(isValidAction('')).toBe(false);
    expect(isValidAction('FOCUS')).toBe(false); // case sensitive
  });
});

describe('getActionInput', () => {
  test('returns correct input for each action', () => {
    expect(getActionInput('1')).toBe('1');
    expect(getActionInput('2')).toBe('2');
    expect(getActionInput('continue')).toBe('Continue');
    expect(getActionInput('push')).toBe('/push');
    expect(getActionInput('focus')).toBe('');
  });
});

describe('round-trip tests', () => {
  test('build and parse produces same URL and action', () => {
    const testCases = [
      { url: 'claude-focus://iterm2/abc-123', action: 'focus' },
      { url: 'claude-focus://tmux/session:0.0', action: '1' },
      { url: 'claude-focus://ssh-linked/link/host/user/22/target', action: 'continue' },
      { url: 'claude-focus://terminal/dev%2Fttys000', action: 'push' },
    ];

    for (const { url, action } of testCases) {
      const value = buildButtonValue(url, action);
      const parsed = parseButtonValue(value);
      expect(parsed).not.toBeNull();
      expect(parsed!.focusUrl).toBe(url);
      expect(parsed!.action).toBe(action);
    }
  });
});
