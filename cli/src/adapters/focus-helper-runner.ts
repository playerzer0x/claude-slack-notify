/**
 * Focus Helper Runner
 *
 * Spawns ~/.claude/bin/focus-helper with focus URLs.
 * Used by Mac terminal adapters (iTerm2, Terminal.app) to delegate
 * actual terminal operations to the bash script.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TerminalResult } from './terminal-adapter.js';

/**
 * Get the path to the focus-helper script.
 */
export function getFocusHelperPath(): string {
  return join(homedir(), '.claude', 'bin', 'focus-helper');
}

/**
 * Check if focus-helper is available.
 */
export function isFocusHelperAvailable(): boolean {
  return existsSync(getFocusHelperPath());
}

/**
 * Run focus-helper with the given URL.
 *
 * @param focusUrl - The claude-focus:// URL to process
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Result of the operation
 */
export async function runFocusHelper(
  focusUrl: string,
  timeout: number = 30000,
): Promise<TerminalResult> {
  const helperPath = getFocusHelperPath();

  if (!existsSync(helperPath)) {
    return {
      success: false,
      error: `focus-helper not found at ${helperPath}`,
    };
  }

  return new Promise((resolve) => {
    const proc = spawn(helperPath, [focusUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          success: false,
          error: `focus-helper timed out after ${timeout}ms`,
        });
        return;
      }

      if (code === 0) {
        resolve({
          success: true,
          details: stdout.trim() || 'focus-helper completed',
        });
      } else {
        resolve({
          success: false,
          error: stderr.trim() || `focus-helper exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Failed to spawn focus-helper: ${err.message}`,
      });
    });
  });
}

/**
 * Build a focus URL with optional action parameter.
 *
 * @param baseUrl - The base claude-focus:// URL
 * @param action - Optional action (1, 2, continue, push)
 * @param text - Optional custom text to send
 * @returns The URL with query params appended
 */
export function buildFocusUrlWithAction(
  baseUrl: string,
  action?: string,
  text?: string,
): string {
  const params: string[] = [];

  if (action) {
    params.push(`action=${encodeURIComponent(action)}`);
  }
  if (text) {
    params.push(`text=${encodeURIComponent(text)}`);
  }

  if (params.length === 0) {
    return baseUrl;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${params.join('&')}`;
}
