import { describe, expect, it } from "bun:test";

import type { Session } from "./session-store.js";
import { buildFocusUrl } from "./focus-executor.js";

// Mock session factory for testing
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-123",
    name: "test-session",
    hostname: "localhost",
    term_type: "iterm-tmux",
    term_target: "/dev/ttys001|main:0.0",
    focus_url: "claude-focus://iterm-tmux/dev/ttys001/main:0.0",
    registered_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildFocusUrl", () => {
  it("returns base URL when action is 'focus'", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session, "focus");
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0");
  });

  it("returns base URL when action is undefined", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session);
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0");
  });

  it("appends action parameter for action '1'", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session, "1");
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=1");
  });

  it("appends action parameter for action '2'", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session, "2");
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=2");
  });

  it("appends action parameter for action 'continue'", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session, "continue");
    expect(url).toBe(
      "claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=continue"
    );
  });

  it("appends action parameter for action 'push'", () => {
    const session = createMockSession();
    const url = buildFocusUrl(session, "push");
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=push");
  });

  it("replaces existing query string when adding action", () => {
    const session = createMockSession({
      focus_url: "claude-focus://iterm-tmux/dev/ttys001/main:0.0?existing=param",
    });
    const url = buildFocusUrl(session, "continue");
    expect(url).toBe(
      "claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=continue"
    );
  });

  it("strips existing query string when action is 'focus'", () => {
    const session = createMockSession({
      focus_url: "claude-focus://iterm-tmux/dev/ttys001/main:0.0?action=push",
    });
    const url = buildFocusUrl(session, "focus");
    expect(url).toBe("claude-focus://iterm-tmux/dev/ttys001/main:0.0");
  });

  it("throws error when session has no focus_url", () => {
    const session = createMockSession({ focus_url: "" });
    expect(() => buildFocusUrl(session, "focus")).toThrow(
      "Session test-session has no focus_url"
    );
  });

  it("uses session id in error when name is empty", () => {
    const session = createMockSession({ focus_url: "", name: "" });
    expect(() => buildFocusUrl(session, "focus")).toThrow(
      "Session test-123 has no focus_url"
    );
  });

  it("handles various term_type URLs correctly", () => {
    // iterm2
    const iterm2Session = createMockSession({
      term_type: "iterm2",
      focus_url: "claude-focus://iterm2/session-uuid-123",
    });
    expect(buildFocusUrl(iterm2Session, "1")).toBe(
      "claude-focus://iterm2/session-uuid-123?action=1"
    );

    // terminal
    const terminalSession = createMockSession({
      term_type: "terminal",
      focus_url: "claude-focus://terminal/dev/ttys002",
    });
    expect(buildFocusUrl(terminalSession, "2")).toBe(
      "claude-focus://terminal/dev/ttys002?action=2"
    );

    // tmux
    const tmuxSession = createMockSession({
      term_type: "tmux",
      focus_url: "claude-focus://tmux/main:0.0",
    });
    expect(buildFocusUrl(tmuxSession, "continue")).toBe(
      "claude-focus://tmux/main:0.0?action=continue"
    );

    // ssh-linked
    const sshLinkedSession = createMockSession({
      term_type: "ssh-linked",
      focus_url: "claude-focus://ssh-linked/link123/example.com/user/22/main:0.0",
    });
    expect(buildFocusUrl(sshLinkedSession, "push")).toBe(
      "claude-focus://ssh-linked/link123/example.com/user/22/main:0.0?action=push"
    );
  });
});
