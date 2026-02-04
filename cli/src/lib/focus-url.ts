/**
 * Focus URL Building and Parsing
 *
 * Handles claude-focus:// URLs for terminal focus/switching.
 *
 * Supported URL types:
 * - local-tmux: Local tmux session (launched via claude-slack-notify launch)
 * - ssh-linked: SSH session with link ID for Mac callback
 * - ssh-tmux: Direct SSH tmux without link
 * - jupyter-tmux: JupyterLab SSH session
 * - linux-tmux: Linux tmux with TTY
 * - tmux: Simple tmux target only
 * - iterm2: iTerm2 session ID
 * - iterm-tmux: iTerm2 with tmux inside
 * - terminal: macOS Terminal.app
 * - wt-tmux: Windows Terminal with tmux
 * - windows-terminal: Windows Terminal
 * - wsl-tmux: WSL with tmux
 * - wsl: WSL without tmux
 * - conemu: ConEmu terminal
 * - mintty: Mintty terminal
 * - gnome-terminal: GNOME Terminal
 * - konsole: KDE Konsole
 * - vscode: VS Code integrated terminal
 */

export type FocusUrlType =
  | 'local-tmux'
  | 'ssh-linked'
  | 'ssh-tmux'
  | 'jupyter-tmux'
  | 'linux-tmux'
  | 'tmux'
  | 'iterm2'
  | 'iterm-tmux'
  | 'terminal'
  | 'ghostty'
  | 'ghostty-tmux'
  | 'wt-tmux'
  | 'windows-terminal'
  | 'wsl-tmux'
  | 'wsl'
  | 'conemu'
  | 'mintty'
  | 'gnome-terminal'
  | 'konsole'
  | 'vscode'
  | 'jupyter-link';

export interface FocusUrlParams {
  type: FocusUrlType;
  /** Tmux target (session:window.pane) */
  tmuxTarget?: string;
  /** iTerm2 session ID (UUID) */
  itermSessionId?: string;
  /** SSH link ID for Mac callback */
  linkId?: string;
  /** SSH hostname */
  host?: string;
  /** SSH username */
  user?: string;
  /** SSH port */
  port?: number;
  /** TTY device path (e.g., /dev/pts/0) */
  tty?: string;
  /** Windows Terminal session ID */
  wtSession?: string;
  /** Process ID for various terminals */
  pid?: string;
  /** Window ID for WSL */
  windowId?: string;
  /** KDE Konsole D-Bus session */
  dbusSession?: string;
  /** Optional action query param */
  action?: string;
}

const FOCUS_URL_PREFIX = 'claude-focus://';

/**
 * URL-encode a path component.
 */
function urlEncode(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Build a claude-focus:// URL from parameters.
 *
 * @param params - Focus URL parameters
 * @returns The complete claude-focus:// URL
 */
export function buildFocusUrl(params: FocusUrlParams): string {
  const { type } = params;
  let path: string;

  switch (type) {
    case 'local-tmux':
      // claude-focus://local-tmux/ITERM_SESSION_ID/TMUX_TARGET
      // or claude-focus://local-tmux/TMUX_TARGET (old format)
      if (params.itermSessionId && params.tmuxTarget) {
        path = `local-tmux/${urlEncode(params.itermSessionId)}/${urlEncode(params.tmuxTarget)}`;
      } else if (params.tmuxTarget) {
        path = `local-tmux/${urlEncode(params.tmuxTarget)}`;
      } else {
        throw new Error('local-tmux requires tmuxTarget');
      }
      break;

    case 'ssh-linked':
      // claude-focus://ssh-linked/LINK_ID/HOST/USER/PORT/TMUX_TARGET
      if (!params.linkId || !params.host || !params.user || !params.tmuxTarget) {
        throw new Error('ssh-linked requires linkId, host, user, and tmuxTarget');
      }
      path = `ssh-linked/${urlEncode(params.linkId)}/${urlEncode(params.host)}/${urlEncode(params.user)}/${params.port || 22}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'ssh-tmux':
      // claude-focus://ssh-tmux/HOST/USER/PORT/TMUX_TARGET
      if (!params.host || !params.user || !params.tmuxTarget) {
        throw new Error('ssh-tmux requires host, user, and tmuxTarget');
      }
      path = `ssh-tmux/${urlEncode(params.host)}/${urlEncode(params.user)}/${params.port || 22}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'jupyter-tmux':
      // claude-focus://jupyter-tmux/LINK_ID/HOST/USER/PORT/TMUX_TARGET
      if (!params.linkId || !params.host || !params.user || !params.tmuxTarget) {
        throw new Error('jupyter-tmux requires linkId, host, user, and tmuxTarget');
      }
      path = `jupyter-tmux/${urlEncode(params.linkId)}/${urlEncode(params.host)}/${urlEncode(params.user)}/${params.port || 22}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'linux-tmux':
      // claude-focus://linux-tmux/TTY/TMUX_TARGET
      if (!params.tty || !params.tmuxTarget) {
        throw new Error('linux-tmux requires tty and tmuxTarget');
      }
      path = `linux-tmux/${urlEncode(params.tty)}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'tmux':
      // claude-focus://tmux/TMUX_TARGET
      if (!params.tmuxTarget) {
        throw new Error('tmux requires tmuxTarget');
      }
      path = `tmux/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'iterm2':
      // claude-focus://iterm2/SESSION_ID
      if (!params.itermSessionId) {
        throw new Error('iterm2 requires itermSessionId');
      }
      path = `iterm2/${params.itermSessionId}`;
      break;

    case 'iterm-tmux':
      // claude-focus://iterm-tmux/TTY/TMUX_TARGET
      if (!params.tty || !params.tmuxTarget) {
        throw new Error('iterm-tmux requires tty and tmuxTarget');
      }
      path = `iterm-tmux/${urlEncode(params.tty)}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'terminal':
      // claude-focus://terminal/TTY or claude-focus://terminal/frontmost
      if (!params.tty) {
        throw new Error('terminal requires tty');
      }
      path = `terminal/${urlEncode(params.tty)}`;
      break;

    case 'ghostty':
      // claude-focus://ghostty (no session ID available - just activates the app)
      path = 'ghostty';
      break;

    case 'ghostty-tmux':
      // claude-focus://ghostty-tmux/TMUX_TARGET
      if (!params.tmuxTarget) {
        throw new Error('ghostty-tmux requires tmuxTarget');
      }
      path = `ghostty-tmux/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'wt-tmux':
      // claude-focus://wt-tmux/WT_SESSION/TMUX_TARGET
      if (!params.wtSession || !params.tmuxTarget) {
        throw new Error('wt-tmux requires wtSession and tmuxTarget');
      }
      path = `wt-tmux/${urlEncode(params.wtSession)}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'windows-terminal':
      // claude-focus://windows-terminal/WT_SESSION
      if (!params.wtSession) {
        throw new Error('windows-terminal requires wtSession');
      }
      path = `windows-terminal/${urlEncode(params.wtSession)}`;
      break;

    case 'wsl-tmux':
      // claude-focus://wsl-tmux/WINDOW_ID/TMUX_TARGET
      if (!params.windowId || !params.tmuxTarget) {
        throw new Error('wsl-tmux requires windowId and tmuxTarget');
      }
      path = `wsl-tmux/${urlEncode(params.windowId)}/${urlEncode(params.tmuxTarget)}`;
      break;

    case 'wsl':
      // claude-focus://wsl/WINDOW_ID
      if (!params.windowId) {
        throw new Error('wsl requires windowId');
      }
      path = `wsl/${urlEncode(params.windowId)}`;
      break;

    case 'conemu':
      // claude-focus://conemu/PID
      if (!params.pid) {
        throw new Error('conemu requires pid');
      }
      path = `conemu/${urlEncode(params.pid)}`;
      break;

    case 'mintty':
      // claude-focus://mintty/PID
      if (!params.pid) {
        throw new Error('mintty requires pid');
      }
      path = `mintty/${urlEncode(params.pid)}`;
      break;

    case 'gnome-terminal':
      // claude-focus://gnome-terminal/PID
      if (!params.pid) {
        throw new Error('gnome-terminal requires pid');
      }
      path = `gnome-terminal/${urlEncode(params.pid)}`;
      break;

    case 'konsole':
      // claude-focus://konsole/DBUS_SESSION
      if (!params.dbusSession) {
        throw new Error('konsole requires dbusSession');
      }
      path = `konsole/${urlEncode(params.dbusSession)}`;
      break;

    case 'vscode':
      // claude-focus://vscode/PID
      if (!params.pid) {
        throw new Error('vscode requires pid');
      }
      path = `vscode/${urlEncode(params.pid)}`;
      break;

    case 'jupyter-link':
      // Special case - needs different handling
      throw new Error('jupyter-link URLs should use buildJupyterLinkUrl()');

    default:
      throw new Error(`Unknown focus URL type: ${type}`);
  }

  let url = `${FOCUS_URL_PREFIX}${path}`;
  if (params.action) {
    url += `?action=${urlEncode(params.action)}`;
  }
  return url;
}

/**
 * Parse a claude-focus:// URL back into parameters.
 *
 * @param url - The focus URL to parse
 * @returns Parsed parameters, or null if invalid
 */
export function parseFocusUrl(url: string): FocusUrlParams | null {
  if (!url.startsWith(FOCUS_URL_PREFIX)) {
    return null;
  }

  try {
    // Remove prefix and split query params
    let path = url.substring(FOCUS_URL_PREFIX.length);
    let action: string | undefined;

    const queryIndex = path.indexOf('?');
    if (queryIndex !== -1) {
      const query = path.substring(queryIndex + 1);
      path = path.substring(0, queryIndex);

      // Parse query params
      const params = new URLSearchParams(query);
      action = params.get('action') || undefined;
    }

    const parts = path.split('/');
    const type = parts[0] as FocusUrlType;

    const decode = (s: string) => decodeURIComponent(s);

    switch (type) {
      case 'local-tmux':
        // New: /ITERM_SESSION_ID/TMUX_TARGET or Old: /TMUX_TARGET
        if (parts.length === 3) {
          return {
            type,
            itermSessionId: decode(parts[1]),
            tmuxTarget: decode(parts[2]),
            action,
          };
        } else if (parts.length === 2) {
          return { type, tmuxTarget: decode(parts[1]), action };
        }
        return null;

      case 'ssh-linked':
      case 'jupyter-tmux':
        // /LINK_ID/HOST/USER/PORT/TMUX_TARGET
        if (parts.length >= 6) {
          return {
            type,
            linkId: decode(parts[1]),
            host: decode(parts[2]),
            user: decode(parts[3]),
            port: parseInt(parts[4], 10),
            tmuxTarget: decode(parts[5]),
            action,
          };
        }
        return null;

      case 'ssh-tmux':
        // /HOST/USER/PORT/TMUX_TARGET
        if (parts.length >= 5) {
          return {
            type,
            host: decode(parts[1]),
            user: decode(parts[2]),
            port: parseInt(parts[3], 10),
            tmuxTarget: decode(parts[4]),
            action,
          };
        }
        return null;

      case 'linux-tmux':
        // /TTY/TMUX_TARGET (TTY is URL-encoded, so minimum 3 parts)
        // Format: linux-tmux/%2Fdev%2Fpts%2F0/session%3A0.0
        if (parts.length >= 3) {
          const tmuxTarget = decode(parts[parts.length - 1]);
          const tty = decode(parts.slice(1, -1).join('/'));
          return { type, tty, tmuxTarget, action };
        }
        return null;

      case 'tmux':
        if (parts.length >= 2) {
          return { type, tmuxTarget: decode(parts[1]), action };
        }
        return null;

      case 'iterm2':
        if (parts.length >= 2) {
          return { type, itermSessionId: parts[1], action };
        }
        return null;

      case 'iterm-tmux':
        // /TTY/TMUX_TARGET (TTY path has slashes)
        if (parts.length >= 3) {
          const tmuxTarget = decode(parts[parts.length - 1]);
          const tty = parts.slice(1, -1).map(decode).join('/');
          return { type, tty, tmuxTarget, action };
        }
        return null;

      case 'terminal':
        if (parts.length >= 2) {
          const tty = parts.slice(1).map(decode).join('/');
          return { type, tty, action };
        }
        return null;

      case 'ghostty':
        // claude-focus://ghostty (no arguments needed)
        return { type, action };

      case 'ghostty-tmux':
        // claude-focus://ghostty-tmux/TMUX_TARGET
        if (parts.length >= 2) {
          return { type, tmuxTarget: decode(parts[1]), action };
        }
        return null;

      case 'wt-tmux':
        if (parts.length >= 3) {
          return {
            type,
            wtSession: decode(parts[1]),
            tmuxTarget: decode(parts[2]),
            action,
          };
        }
        return null;

      case 'windows-terminal':
        if (parts.length >= 2) {
          return { type, wtSession: decode(parts[1]), action };
        }
        return null;

      case 'wsl-tmux':
        if (parts.length >= 3) {
          return {
            type,
            windowId: decode(parts[1]),
            tmuxTarget: decode(parts[2]),
            action,
          };
        }
        return null;

      case 'wsl':
        if (parts.length >= 2) {
          return { type, windowId: decode(parts[1]), action };
        }
        return null;

      case 'conemu':
      case 'mintty':
      case 'gnome-terminal':
      case 'vscode':
        if (parts.length >= 2) {
          return { type, pid: decode(parts[1]), action };
        }
        return null;

      case 'konsole':
        if (parts.length >= 2) {
          return { type, dbusSession: decode(parts[1]), action };
        }
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Extract tmux target from a focus URL.
 * Works for ssh-linked, ssh-tmux, jupyter-tmux, linux-tmux, and tmux types.
 *
 * @param url - The focus URL
 * @returns The tmux target, or null if not found/applicable
 */
export function extractTmuxTarget(url: string): string | null {
  const params = parseFocusUrl(url);
  return params?.tmuxTarget || null;
}

/**
 * Check if a focus URL is for a remote session (handled on Linux server)
 * vs Mac session (should be proxied to Mac).
 */
export function isRemoteSessionUrl(url: string): boolean {
  const remoteTypes: FocusUrlType[] = ['ssh-linked', 'ssh-tmux', 'jupyter-tmux', 'linux-tmux', 'tmux'];
  const params = parseFocusUrl(url);
  return params ? remoteTypes.includes(params.type) : false;
}

/**
 * Check if a focus URL is for a Mac-native session.
 */
export function isMacSessionUrl(url: string): boolean {
  const macTypes: FocusUrlType[] = ['iterm2', 'iterm-tmux', 'terminal', 'local-tmux', 'ghostty', 'ghostty-tmux'];
  const params = parseFocusUrl(url);
  return params ? macTypes.includes(params.type) : false;
}
