/**
 * Unit tests for register.ts - detectTerminal function
 */

import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { detectTerminal, type TerminalInfo } from './register';
import type { TerminalEnv } from '../lib/platform';
import * as platform from '../lib/platform';

describe('detectTerminal', () => {
  describe('SSH detection skip on macOS with local terminal', () => {
    /**
     * This tests the fix for the case where SSH_CONNECTION is set in shell profile
     * but the user is actually using a local GUI terminal on macOS.
     */

    test('skips SSH detection when on Mac with iTerm2', () => {
      // Mock isMac to return true
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        itermSessionId: 'w0t0p0:ABC-123',
        sshConnection: '100.1.2.3 54321 100.5.6.7 22', // SSH_CONNECTION set (e.g., in shell profile)
      };

      const result = detectTerminal(env);

      // Should detect as iterm2, NOT ssh
      expect(result.type).toBe('iterm2');
      expect(result.focusUrl).toContain('iterm2');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('skips SSH detection when on Mac with Terminal.app', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        termProgram: 'Apple_Terminal',
        sshConnection: '100.1.2.3 54321 100.5.6.7 22', // SSH_CONNECTION set
      };

      const result = detectTerminal(env);

      // Should detect as terminal, NOT ssh
      expect(result.type).toBe('terminal');
      expect(result.target).toBe('frontmost');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('does not skip SSH detection on Linux even with similar env', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(false);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        sshConnection: '100.1.2.3 54321 100.5.6.7 22',
        // No recognized Mac terminal
      };

      const result = detectTerminal(env);

      // Should detect as ssh on Linux
      expect(result.type).toBe('ssh');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('does not skip SSH detection on Mac without recognized terminal', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        sshConnection: '100.1.2.3 54321 100.5.6.7 22',
        termProgram: 'Alacritty', // Not a recognized Mac terminal emulator
      };

      const result = detectTerminal(env);

      // Should still detect as ssh because Alacritty is not in the skip list
      expect(result.type).toBe('ssh');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('skips SSH detection when on Mac with Ghostty', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        ghosttyResourcesDir: '/Applications/Ghostty.app/Contents/Resources/ghostty',
        sshConnection: '100.1.2.3 54321 100.5.6.7 22', // SSH_CONNECTION set
      };

      const result = detectTerminal(env);

      // Should detect as ghostty, NOT ssh
      expect(result.type).toBe('ghostty');
      expect(result.target).toBe('frontmost');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('skips SSH detection when on Mac with Ghostty via TERM_PROGRAM', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        termProgram: 'ghostty',
        sshConnection: '100.1.2.3 54321 100.5.6.7 22',
      };

      const result = detectTerminal(env);

      // Should detect as ghostty, NOT ssh
      expect(result.type).toBe('ghostty');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });
  });

  describe('normal detection scenarios', () => {
    test('detects local-tmux session', () => {
      const env: TerminalEnv = {
        claudeTmuxSession: 'claude-session',
        claudeTmuxTarget: 'claude:0.0',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('local-tmux');
      expect(result.target).toBe('claude:0.0');
    });

    test('detects ssh-linked session', () => {
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(true);

      const env: TerminalEnv = {
        claudeLinkId: 'link-123',
        claudeSshHost: 'myserver',
        sshConnection: '1.2.3.4 5678 5.6.7.8 22',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('ssh-linked');
      expect(result.linkId).toBe('link-123');

      isSSHSpy.mockRestore();
    });

    test('detects iterm2 on Mac', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(false);

      const env: TerminalEnv = {
        itermSessionId: 'w0t0p0:ABC-123',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('iterm2');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('detects terminal on Mac', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(false);

      const env: TerminalEnv = {
        termProgram: 'Apple_Terminal',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('terminal');
      expect(result.target).toBe('frontmost');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('detects ghostty on Mac', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(false);

      const env: TerminalEnv = {
        ghosttyResourcesDir: '/Applications/Ghostty.app/Contents/Resources/ghostty',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('ghostty');
      expect(result.target).toBe('frontmost');
      expect(result.focusUrl).toBe('claude-focus://ghostty');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('detects ghostty on Mac via TERM_PROGRAM', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(false);

      const env: TerminalEnv = {
        termProgram: 'ghostty',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('ghostty');
      expect(result.target).toBe('frontmost');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });

    test('detects ghostty-tmux on Mac', () => {
      const isMacSpy = spyOn(platform, 'isMac').mockReturnValue(true);
      const isSSHSpy = spyOn(platform, 'isSSHSession').mockReturnValue(false);

      const env: TerminalEnv = {
        ghosttyResourcesDir: '/Applications/Ghostty.app/Contents/Resources/ghostty',
        tmux: '/tmp/tmux-501/default,1234,0',
        tmuxPane: '%0',
      };

      const result = detectTerminal(env);
      expect(result.type).toBe('ghostty-tmux');
      expect(result.target).toBe('%0');
      expect(result.focusUrl).toContain('ghostty-tmux');

      isMacSpy.mockRestore();
      isSSHSpy.mockRestore();
    });
  });
});
