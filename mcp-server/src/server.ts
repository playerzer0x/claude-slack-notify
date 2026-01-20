import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';

import slackRouter from './routes/slack.js';
import { registerTools } from './tools/index.js';

const PORT = 8463;
const CLAUDE_DIR = join(homedir(), '.claude');
const PID_FILE = join(CLAUDE_DIR, '.mcp-server.pid');
const PORT_FILE = join(CLAUDE_DIR, '.mcp-server.port');

// JSON-RPC error response helper
function jsonRpcError(code: number, message: string): object {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

// Create Express app
const app = express();

// Capture raw body for Slack signature verification AND parse body for /slack routes
// This must consume the stream and parse manually since we need both raw and parsed body
app.use('/slack', (req, _res, next) => {
  let data = '';
  req.on('data', (chunk: Buffer) => {
    data += chunk.toString();
  });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;
    // Parse URL-encoded body manually (Slack sends application/x-www-form-urlencoded)
    const params = new URLSearchParams(data);
    req.body = Object.fromEntries(params.entries());
    next();
  });
});

// Body parsers for non-slack routes (skip /slack since we handle it above)
app.use((req, res, next) => {
  if (req.path.startsWith('/slack')) {
    next();
  } else {
    express.urlencoded({ extended: true })(req, res, next);
  }
});
app.use((req, res, next) => {
  if (req.path.startsWith('/slack')) {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Create and configure MCP server
const mcpServer = new McpServer({
  name: 'claude-slack-notify',
  version: '1.0.0',
});
registerTools(mcpServer);

// Transport registry by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

function getTransport(sessionId: string | undefined): StreamableHTTPServerTransport | null {
  return sessionId && transports[sessionId] ? transports[sessionId] : null;
}

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Slack routes
app.use('/slack', slackRouter);

// MCP POST endpoint
app.post('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    // Check for existing session
    const existingTransport = getTransport(sessionId);
    if (existingTransport) {
      await existingTransport.handleRequest(req, res, req.body);
      return;
    }

    // New initialization request
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          console.log(`Session initialized: ${newSessionId}`);
          transports[newSessionId] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete transports[sid];
        }
      };

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Invalid request
    res.status(400).json(jsonRpcError(-32000, 'Bad Request: No valid session ID provided'));
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
    }
  }
});

// MCP GET endpoint for SSE streams
app.get('/mcp', async (req: Request, res: Response) => {
  const transport = getTransport(req.headers['mcp-session-id'] as string | undefined);
  if (!transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transport.handleRequest(req, res);
});

// MCP DELETE endpoint for session termination
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = getTransport(sessionId);
  if (!transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  console.log(`Session termination request for session ${sessionId}`);
  await transport.handleRequest(req, res);
});

function writeRuntimeFiles(): void {
  try {
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true });
    }
    writeFileSync(PID_FILE, process.pid.toString());
    writeFileSync(PORT_FILE, PORT.toString());
    console.log(`PID file written: ${PID_FILE}`);
    console.log(`Port file written: ${PORT_FILE}`);
  } catch (error) {
    console.error('Error writing runtime files:', error);
  }
}

export function startServer(): void {
  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    writeRuntimeFiles();
  });
}

process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  for (const sessionId of Object.keys(transports)) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  console.log('Server shutdown complete');
  process.exit(0);
});

export { app, mcpServer };
