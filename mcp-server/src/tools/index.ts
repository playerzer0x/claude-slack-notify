import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { executeFocus, type FocusAction } from '../lib/focus-executor.js';
import { getSession, listSessions } from '../lib/session-store.js';

const FocusActionSchema = z.enum(['1', '2', 'continue', 'push', 'focus']);

function jsonContent(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function textContent(
  text: string,
  isError = false
): { content: [{ type: 'text'; text: string }]; isError?: boolean } {
  return isError ? { content: [{ type: 'text', text }], isError } : { content: [{ type: 'text', text }] };
}

export function registerTools(server: McpServer): void {
  server.tool(
    'list_sessions',
    'List all registered Claude Code sessions',
    {
      active_only: z.boolean().optional().describe('Only return active sessions'),
      hostname: z.string().optional().describe('Filter by hostname'),
    },
    async ({ active_only, hostname }) => {
      const sessions = await listSessions({ activeOnly: active_only, hostname });
      return jsonContent(sessions);
    }
  );

  server.tool(
    'get_session',
    'Get details for a specific session by ID or name',
    {
      id: z.string().optional().describe('Session ID'),
      name: z.string().optional().describe('Session name'),
    },
    async ({ id, name }) => {
      const session = await getSession({ id, name });
      if (!session) {
        return textContent('Session not found', true);
      }
      return jsonContent(session);
    }
  );

  server.tool(
    'send_input',
    'Send input to a Claude session (focus terminal and optionally type action)',
    {
      session_id: z.string().describe('The session ID to send input to'),
      action: FocusActionSchema.describe('Action to perform'),
    },
    async ({ session_id, action }) => {
      const session = await getSession({ id: session_id });
      if (!session) {
        return textContent(`Session ${session_id} not found`, true);
      }

      const result = await executeFocus(session, action as FocusAction);
      return textContent(result.message, !result.success);
    }
  );
}
