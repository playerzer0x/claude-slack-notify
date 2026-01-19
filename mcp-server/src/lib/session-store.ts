/**
 * Session store library for reading and managing Claude Code session instances.
 * Reads session files from ~/.claude/instances/*.json
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Represents a Claude Code session instance.
 */
export interface Session {
  /** Unique session identifier (PID or UUID) */
  id: string;
  /** Human-readable session name (e.g., "swift-panther-violet-canyon") */
  name: string;
  /** Hostname where the session is running */
  hostname: string;
  /** Terminal type: "iterm2", "iterm-tmux", "terminal", etc. */
  term_type: string;
  /** Terminal target identifier (varies by term_type) */
  term_target: string;
  /** Focus URL for bringing the session to foreground */
  focus_url: string;
  /** ISO 8601 timestamp when the session was registered */
  registered_at: string;
}

/**
 * Options for listing sessions.
 */
export interface ListSessionsOptions {
  /** If true, only return sessions that are currently active (not implemented yet) */
  activeOnly?: boolean;
  /** Filter sessions by hostname */
  hostname?: string;
}

/**
 * Options for getting a single session.
 */
export interface GetSessionOptions {
  /** Session ID to look up */
  id?: string;
  /** Session name to look up */
  name?: string;
}

/**
 * Get the instances directory path.
 */
function getInstancesDir(): string {
  return join(homedir(), ".claude", "instances");
}

/**
 * Parse a session file and return a Session object.
 * Returns null if the file cannot be parsed.
 */
async function parseSessionFile(filePath: string): Promise<Session | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Validate required fields
    if (
      typeof data.id !== "string" ||
      typeof data.name !== "string" ||
      typeof data.hostname !== "string" ||
      typeof data.term_type !== "string" ||
      typeof data.registered_at !== "string"
    ) {
      return null;
    }

    return {
      id: data.id,
      name: data.name,
      hostname: data.hostname,
      term_type: data.term_type,
      term_target: data.term_target ?? "",
      focus_url: data.focus_url ?? "",
      registered_at: data.registered_at,
    };
  } catch {
    return null;
  }
}

/**
 * List all sessions from the instances directory.
 *
 * @param options - Optional filters for the session list
 * @returns Array of sessions, sorted by registered_at (newest first)
 */
export async function listSessions(
  options: ListSessionsOptions = {}
): Promise<Session[]> {
  const instancesDir = getInstancesDir();

  let files: string[];
  try {
    files = await readdir(instancesDir);
  } catch {
    // Directory doesn't exist or is not accessible
    return [];
  }

  // Filter to only JSON files
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  // Parse all session files in parallel
  const sessions = await Promise.all(
    jsonFiles.map((file) => parseSessionFile(join(instancesDir, file)))
  );

  // Filter out null values and apply filters
  let result = sessions.filter((session): session is Session => session !== null);

  // Apply hostname filter if provided
  if (options.hostname) {
    result = result.filter((session) => session.hostname === options.hostname);
  }

  // Sort by registered_at (newest first)
  result.sort((a, b) => {
    const dateA = new Date(a.registered_at).getTime();
    const dateB = new Date(b.registered_at).getTime();
    return dateB - dateA;
  });

  return result;
}

/**
 * Get a single session by ID or name.
 *
 * @param options - Either id or name must be provided
 * @returns The matching session, or null if not found
 */
export async function getSession(
  options: GetSessionOptions
): Promise<Session | null> {
  const { id, name } = options;

  if (!id && !name) {
    return null;
  }

  const sessions = await listSessions();

  // Prefer id lookup over name lookup
  const matchFn = id
    ? (session: Session) => session.id === id
    : (session: Session) => session.name === name;

  return sessions.find(matchFn) ?? null;
}
