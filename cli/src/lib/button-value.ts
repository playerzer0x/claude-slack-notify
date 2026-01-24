/**
 * Slack Button Value Utilities
 *
 * Handles encoding/decoding of focus URLs into Slack button values.
 * Format: url:claude-focus://TYPE/...|ACTION
 *
 * Slack has a 2000 character limit for button values.
 */

const MAX_BUTTON_VALUE_LENGTH = 2000;

/**
 * Build a Slack button value from a focus URL and action.
 *
 * @param focusUrl - The claude-focus:// URL
 * @param action - The action type (focus, 1, 2, continue, push)
 * @returns Encoded button value
 * @throws Error if the value exceeds Slack's 2000 character limit
 */
export function buildButtonValue(focusUrl: string, action: string): string {
  const value = `url:${focusUrl}|${action}`;

  if (value.length > MAX_BUTTON_VALUE_LENGTH) {
    throw new Error(
      `Button value exceeds Slack limit: ${value.length} > ${MAX_BUTTON_VALUE_LENGTH}`
    );
  }

  return value;
}

/**
 * Parse a Slack button value back into focus URL and action.
 *
 * @param value - The button value string
 * @returns Object with focusUrl and action, or null if invalid format
 */
export function parseButtonValue(value: string): { focusUrl: string; action: string } | null {
  // Handle url: prefix format
  if (value.startsWith('url:')) {
    const pipeIndex = value.lastIndexOf('|');
    if (pipeIndex === -1) return null;

    const focusUrl = value.substring(4, pipeIndex); // Remove "url:" prefix
    const action = value.substring(pipeIndex + 1);

    if (!focusUrl || !action) return null;

    return { focusUrl, action };
  }

  // Handle legacy session_id|action format (for backward compatibility)
  const pipeIndex = value.lastIndexOf('|');
  if (pipeIndex === -1) return null;

  const sessionId = value.substring(0, pipeIndex);
  const action = value.substring(pipeIndex + 1);

  if (!sessionId || !action) return null;

  // Return null for session ID format - caller must look up the focus URL
  return null;
}

/**
 * Check if a button value uses the direct URL format.
 *
 * @param value - The button value string
 * @returns true if the value contains a direct focus URL
 */
export function hasDirectUrl(value: string): boolean {
  return value.startsWith('url:');
}

/**
 * Extract the session ID from a legacy button value.
 *
 * @param value - The button value string
 * @returns The session ID, or null if using URL format
 */
export function extractSessionId(value: string): string | null {
  if (value.startsWith('url:')) return null;

  const pipeIndex = value.lastIndexOf('|');
  if (pipeIndex === -1) return null;

  return value.substring(0, pipeIndex) || null;
}

/**
 * Extract just the action from a button value.
 *
 * @param value - The button value string
 * @returns The action string, or null if invalid format
 */
export function extractAction(value: string): string | null {
  const pipeIndex = value.lastIndexOf('|');
  if (pipeIndex === -1) return null;

  return value.substring(pipeIndex + 1) || null;
}

/**
 * Valid button actions.
 */
export type ButtonAction = 'focus' | '1' | '2' | 'continue' | 'push';

/**
 * Check if an action string is a valid button action.
 */
export function isValidAction(action: string): action is ButtonAction {
  return ['focus', '1', '2', 'continue', 'push'].includes(action);
}

/**
 * Get the input text to send for a button action.
 */
export function getActionInput(action: ButtonAction): string {
  switch (action) {
    case '1':
      return '1';
    case '2':
      return '2';
    case 'continue':
      return 'Continue';
    case 'push':
      return '/push';
    case 'focus':
    default:
      return '';
  }
}
