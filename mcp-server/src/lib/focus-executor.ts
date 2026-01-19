/**
 * Focus executor library for triggering focus actions on Claude Code sessions.
 * Executes the focus-helper script with the appropriate claude-focus:// URL.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Session } from "./session-store.js";

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

  const focusHelperPath = getFocusHelperPath();

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
