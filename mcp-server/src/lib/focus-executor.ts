/**
 * Focus executor library for triggering focus actions on Claude Code sessions.
 * Executes the focus-helper script with the appropriate claude-focus:// URL.
 *
 * Supports reverse links: when running on Linux with a reverse-link.json config,
 * will SSH to the Mac to execute focus-helper there.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Session } from "./session-store.js";

/** Reverse link configuration for Linux -> Mac focus */
interface ReverseLink {
  mac_user: string;
  mac_host: string;
  mac_port: string;
}

/**
 * Load reverse link configuration if it exists.
 * @returns The reverse link config or null if not configured
 */
function loadReverseLink(): ReverseLink | null {
  const reverseLinkPath = join(homedir(), ".claude", "reverse-link.json");
  if (!existsSync(reverseLinkPath)) {
    return null;
  }
  try {
    const content = readFileSync(reverseLinkPath, "utf-8");
    return JSON.parse(content) as ReverseLink;
  } catch {
    return null;
  }
}

/** Valid focus actions that can be performed */
export type FocusAction = "focus" | "1" | "2" | "continue" | "push";

/** Result of a focus operation */
export interface FocusResult {
  success: boolean;
  message: string;
}

/**
 * Build a focus URL with the specified action.
 * Takes the session's focus_url and appends or modifies the action query parameter.
 *
 * @param session - The session to build the URL for
 * @param action - The action to perform (default: "focus")
 * @returns The complete claude-focus:// URL
 */
export function buildFocusUrl(session: Session, action?: FocusAction): string {
  const focusUrl = session.focus_url;

  if (!focusUrl) {
    throw new Error(`Session ${session.name || session.id} has no focus_url`);
  }

  // If action is "focus" or undefined, strip any existing action and return base URL
  if (!action || action === "focus") {
    return focusUrl.split("?")[0];
  }

  // Otherwise, replace or append the action query parameter
  const baseUrl = focusUrl.split("?")[0];
  return `${baseUrl}?action=${action}`;
}

/**
 * Get the path to the focus-helper script.
 * The script is located in the bin/ directory at the project root.
 */
function getFocusHelperPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from src/lib/ to project root (mcp-server), then up to main project, then to bin/
  return join(currentDir, "..", "..", "..", "bin", "focus-helper");
}

/**
 * Execute focus on a session with the specified action.
 *
 * If a reverse link is configured (reverse-link.json), will SSH to the Mac
 * to execute focus-helper there instead of locally.
 *
 * @param session - The session to focus
 * @param action - The action to perform (default: "focus")
 * @returns A promise resolving to the result of the focus operation
 */
export async function executeFocus(
  session: Session,
  action: FocusAction = "focus"
): Promise<FocusResult> {
  let focusUrl: string;
  try {
    focusUrl = buildFocusUrl(session, action);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // Check for reverse link (Linux -> Mac)
  const reverseLink = loadReverseLink();

  if (reverseLink) {
    // SSH to Mac to execute focus-helper
    return executeRemoteFocus(reverseLink, focusUrl, session, action);
  }

  // Local execution
  const focusHelperPath = getFocusHelperPath();
  return executeLocalFocus(focusHelperPath, focusUrl, session, action);
}

/**
 * Execute focus locally using the focus-helper script.
 */
function executeLocalFocus(
  focusHelperPath: string,
  focusUrl: string,
  session: Session,
  action: FocusAction
): Promise<FocusResult> {
  return new Promise((resolve) => {
    const proc = spawn(focusHelperPath, [focusUrl], { stdio: "pipe" });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const actionSuffix = action !== "focus" ? ` with action '${action}'` : "";
        resolve({
          success: true,
          message: `Focused session ${session.name || session.id}${actionSuffix}`,
        });
      } else {
        resolve({
          success: false,
          message: stderr.trim() || stdout.trim() || `Exit code: ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        message: `Failed to execute focus-helper: ${err.message}`,
      });
    });
  });
}

/**
 * Execute focus on remote Mac via SSH.
 */
function executeRemoteFocus(
  reverseLink: ReverseLink,
  focusUrl: string,
  session: Session,
  action: FocusAction
): Promise<FocusResult> {
  const { mac_user, mac_host, mac_port } = reverseLink;
  const sshTarget = `${mac_user}@${mac_host}`;

  // Build SSH command to execute focus-helper on Mac
  // The focus-helper is at ~/.claude/bin/focus-helper on the Mac
  const remoteCommand = `~/.claude/bin/focus-helper '${focusUrl.replace(/'/g, "'\\''")}'`;

  return new Promise((resolve) => {
    const proc = spawn("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      "-p", mac_port,
      sshTarget,
      remoteCommand,
    ], { stdio: "pipe" });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const actionSuffix = action !== "focus" ? ` with action '${action}'` : "";
        resolve({
          success: true,
          message: `Focused session ${session.name || session.id}${actionSuffix} (via ${mac_host})`,
        });
      } else {
        resolve({
          success: false,
          message: `SSH to Mac failed: ${stderr.trim() || stdout.trim() || `Exit code: ${code}`}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        message: `Failed to SSH to Mac: ${err.message}`,
      });
    });
  });
}
