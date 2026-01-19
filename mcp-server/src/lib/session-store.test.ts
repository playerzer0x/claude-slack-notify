import { describe, expect, it, beforeAll, afterAll, mock } from "bun:test";
import { listSessions, getSession, type Session } from "./session-store.js";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

describe("session-store", () => {
  describe("listSessions", () => {
    it("returns sessions from real instances directory", async () => {
      const sessions = await listSessions();

      // Should return an array (possibly empty if no sessions exist)
      expect(Array.isArray(sessions)).toBe(true);

      // If sessions exist, verify structure
      if (sessions.length > 0) {
        const session = sessions[0];
        expect(typeof session.id).toBe("string");
        expect(typeof session.name).toBe("string");
        expect(typeof session.hostname).toBe("string");
        expect(typeof session.term_type).toBe("string");
        expect(typeof session.registered_at).toBe("string");
      }
    });

    it("sorts sessions by registered_at (newest first)", async () => {
      const sessions = await listSessions();

      if (sessions.length > 1) {
        for (let i = 0; i < sessions.length - 1; i++) {
          const dateA = new Date(sessions[i].registered_at).getTime();
          const dateB = new Date(sessions[i + 1].registered_at).getTime();
          expect(dateA).toBeGreaterThanOrEqual(dateB);
        }
      }
    });

    it("filters by hostname when provided", async () => {
      const allSessions = await listSessions();

      if (allSessions.length > 0) {
        const hostname = allSessions[0].hostname;
        const filteredSessions = await listSessions({ hostname });

        // All filtered sessions should have the specified hostname
        filteredSessions.forEach((session: Session) => {
          expect(session.hostname).toBe(hostname);
        });
      }
    });

    it("returns empty array for non-existent hostname", async () => {
      const sessions = await listSessions({ hostname: "non-existent-host-12345" });
      expect(sessions).toEqual([]);
    });
  });

  describe("getSession", () => {
    it("returns null when neither id nor name provided", async () => {
      const session = await getSession({});
      expect(session).toBeNull();
    });

    it("finds session by id", async () => {
      const sessions = await listSessions();

      if (sessions.length > 0) {
        const targetSession = sessions[0];
        const found = await getSession({ id: targetSession.id });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(targetSession.id);
        expect(found?.name).toBe(targetSession.name);
      }
    });

    it("finds session by name", async () => {
      const sessions = await listSessions();

      if (sessions.length > 0) {
        const targetSession = sessions[0];
        const found = await getSession({ name: targetSession.name });

        expect(found).not.toBeNull();
        expect(found?.name).toBe(targetSession.name);
        expect(found?.id).toBe(targetSession.id);
      }
    });

    it("returns null for non-existent id", async () => {
      const session = await getSession({ id: "non-existent-id-12345" });
      expect(session).toBeNull();
    });

    it("returns null for non-existent name", async () => {
      const session = await getSession({ name: "non-existent-name-12345" });
      expect(session).toBeNull();
    });
  });
});
