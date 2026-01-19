import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listSessions, getSession } from '../lib/session-store.js';
import { executeFocus } from '../lib/focus-executor.js';

export function registerTools(server: McpServer): void {
  // Tool: list_sessions
  server.tool(
    'list_sessions',
    'List all registered Claude Code sessions',
    {
      active_only: z.boolean().optional().describe('Only return active sessions'),
      hostname: z.string().optional().describe('Filter by hostname'),
    },
    async ({ active_only, hostname }) => {
      const sessions = await listSessions({ activeOnly: active_only, hostname });
      return {
        content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }],
      };
    }
  );

  // Tool: get_session
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
        return {
          content: [{ type: 'text', text: 'Session not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(session, null, 2) }],
      };
    }
  );

  // Tool: send_input
  server.tool(
    'send_input',
    'Send input to a Claude session (focus terminal and optionally type action)',
    {
      session_id: z.string().describe('The session ID to send input to'),
      action: z.enum(['1', '2', 'continue', 'push', 'focus']).describe('Action to perform'),
    },
    async ({ session_id, action }) => {
      const session = await getSession({ id: session_id });
      if (!session) {
        return {
          content: [{ type: 'text', text: `Session ${session_id} not found` }],
          isError: true,
        };
      }

      const result = await executeFocus(session, action);
      return {
        content: [{ type: 'text', text: result.message }],
        isError: !result.success,
      };
    }
  );
}
