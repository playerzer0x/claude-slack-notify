import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools/index.js';
import slackRouter from './routes/slack.js';

const PORT = 8463;
const PID_FILE = join(dirname(process.cwd()), '.mcp-server.pid');
const PORT_FILE = join(dirname(process.cwd()), '.mcp-server.port');

// Create Express app
const app = express();

// Capture raw body for Slack signature verification (must be before body parsers)
app.use('/slack', (req, res, next) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
  });
  req.on('end', () => {
    (req as Request & { rawBody: string }).rawBody = data;
    next();
  });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Create MCP server
const mcpServer = new McpServer({
  name: 'claude-slack-notify',
  version: '1.0.0',
});

// Register MCP tools
registerTools(mcpServer);

// Map to store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

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
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          console.log(`Session initialized: ${newSessionId}`);
          transports[newSessionId] = transport;
        },
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete transports[sid];
        }
      };

      // Connect the transport to the MCP server
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// MCP GET endpoint for SSE streams
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// MCP DELETE endpoint for session termination
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  console.log(`Session termination request for session ${sessionId}`);
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// Write runtime files (PID and port)
function writeRuntimeFiles(): void {
  try {
    const runtimeDir = dirname(PID_FILE);
    if (!existsSync(runtimeDir)) {
      mkdirSync(runtimeDir, { recursive: true });
    }
    writeFileSync(PID_FILE, process.pid.toString());
    writeFileSync(PORT_FILE, PORT.toString());
    console.log(`PID file written: ${PID_FILE}`);
    console.log(`Port file written: ${PORT_FILE}`);
  } catch (error) {
    console.error('Error writing runtime files:', error);
  }
}

// Start server
export function startServer(): void {
  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    writeRuntimeFiles();
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all active transports
  for (const sessionId in transports) {
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

export { mcpServer, app };
