/**
 * Clean Command
 *
 * Cleans up stale sessions and expired links.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getInstancesDir, getLinksDir, isTmuxRunning } from '../lib/index.js';

interface InstanceData {
  id: string;
  name: string;
  term_type: string;
  term_target: string;
  registered_at?: string;
}

interface LinkData {
  link_id: string;
  term_type: string;
  created_at?: string;
}

/** Check if a tmux session exists */
function tmuxSessionExists(sessionName: string): boolean {
  if (!isTmuxRunning()) {
    return false;
  }

  try {
    const { execSync } = require('node:child_process');
    execSync(`tmux has-session -t '${sessionName}'`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Parse tmux session name from term_target */
function extractTmuxSession(termTarget: string): string | null {
  // term_target formats:
  // - "session:window.pane"
  // - "linkId|host|user|port|session:window.pane"
  // - "/dev/tty|session:window.pane"

  const parts = termTarget.split('|');
  const tmuxPart = parts[parts.length - 1];

  const match = tmuxPart.match(/^([^:]+):/);
  return match ? match[1] : null;
}

/** Clean up stale sessions */
function cleanSessions(): { removed: number; kept: number } {
  const instancesDir = getInstancesDir();
  if (!existsSync(instancesDir)) {
    return { removed: 0, kept: 0 };
  }

  let removed = 0;
  let kept = 0;

  const files = readdirSync(instancesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(instancesDir, file);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as InstanceData;

      // Check if this is a tmux-based session
      const termType = data.term_type || '';
      if (termType.includes('tmux')) {
        const sessionName = extractTmuxSession(data.term_target);

        if (sessionName && !tmuxSessionExists(sessionName)) {
          // Tmux session no longer exists - remove
          rmSync(filePath);
          console.log(`Removed stale session: ${data.name} (${sessionName})`);
          removed++;
          continue;
        }
      }

      // Check if session file is very old (> 7 days)
      const stats = statSync(filePath);
      const ageMs = Date.now() - stats.mtime.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > 7) {
        rmSync(filePath);
        console.log(`Removed old session: ${data.name} (${Math.floor(ageDays)} days old)`);
        removed++;
        continue;
      }

      kept++;
    } catch (error) {
      // Invalid file - remove it
      try {
        rmSync(filePath);
        console.log(`Removed invalid session file: ${file}`);
        removed++;
      } catch {
        // Ignore removal errors
      }
    }
  }

  return { removed, kept };
}

/** Clean up expired links */
function cleanLinks(): { removed: number; kept: number } {
  const linksDir = getLinksDir();
  if (!existsSync(linksDir)) {
    return { removed: 0, kept: 0 };
  }

  let removed = 0;
  let kept = 0;

  const files = readdirSync(linksDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(linksDir, file);

    try {
      const stats = statSync(filePath);
      const ageMs = Date.now() - stats.mtime.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      // Links older than 24 hours are stale
      if (ageHours > 24) {
        rmSync(filePath);
        console.log(`Removed expired link: ${file.replace('.json', '')}`);
        removed++;
        continue;
      }

      kept++;
    } catch {
      // Invalid file - remove it
      try {
        rmSync(filePath);
        removed++;
      } catch {
        // Ignore removal errors
      }
    }
  }

  return { removed, kept };
}

/** Options for clean command */
export interface CleanOptions {
  sessions?: boolean;
  links?: boolean;
  all?: boolean;
}

/**
 * Clean up stale sessions and links.
 */
export function clean(options: CleanOptions = {}): void {
  const cleanAll = !options.sessions && !options.links;
  const doSessions = options.sessions || cleanAll || options.all;
  const doLinks = options.links || cleanAll || options.all;

  console.log('Cleaning up stale resources...');
  console.log('');

  let totalRemoved = 0;
  let totalKept = 0;

  if (doSessions) {
    console.log('Sessions:');
    const sessionResult = cleanSessions();
    totalRemoved += sessionResult.removed;
    totalKept += sessionResult.kept;

    if (sessionResult.removed === 0) {
      console.log('  No stale sessions found');
    }
    console.log(`  Kept: ${sessionResult.kept}, Removed: ${sessionResult.removed}`);
    console.log('');
  }

  if (doLinks) {
    console.log('Links:');
    const linkResult = cleanLinks();
    totalRemoved += linkResult.removed;
    totalKept += linkResult.kept;

    if (linkResult.removed === 0) {
      console.log('  No expired links found');
    }
    console.log(`  Kept: ${linkResult.kept}, Removed: ${linkResult.removed}`);
    console.log('');
  }

  console.log(`Total: Kept ${totalKept}, Removed ${totalRemoved}`);
}

/**
 * CLI handler for clean command.
 */
export function cleanCommand(options: CleanOptions = {}): void {
  try {
    clean(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
