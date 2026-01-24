/**
 * Mock Slack Server for E2E Testing
 *
 * Simulates Slack webhook endpoints to capture and verify notification payloads.
 *
 * Usage:
 *   bun run tests/e2e/lib/mock-slack-server.ts
 *
 * Endpoints:
 *   POST /webhook          - Capture incoming notification payloads
 *   GET  /notifications    - Retrieve all captured payloads
 *   POST /simulate-button  - Simulate a button click (forwards to MCP server)
 *   GET  /health           - Healthcheck endpoint
 *   POST /reset            - Clear captured notifications
 */

const PORT = 9999;

interface SlackPayload {
  timestamp: string;
  payload: unknown;
  headers: Record<string, string>;
}

interface ButtonSimulation {
  action_id: string;
  value: string;
  response_url?: string;
}

// Store captured notifications
const notifications: SlackPayload[] = [];

// MCP server URL for button simulation
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:8463";

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    const method = req.method;

    // CORS headers for local testing
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // Health check
      if (url.pathname === "/health" && method === "GET") {
        return Response.json(
          {
            status: "ok",
            service: "mock-slack-server",
            notifications_count: notifications.length,
            uptime: process.uptime(),
          },
          { headers: corsHeaders }
        );
      }

      // Capture webhook (incoming notifications from claude-slack-notify)
      if (url.pathname === "/webhook" && method === "POST") {
        const body = await req.text();
        let payload: unknown;

        // Try to parse as JSON, fall back to form data
        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          payload = JSON.parse(body);
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body);
          const payloadStr = params.get("payload");
          payload = payloadStr ? JSON.parse(payloadStr) : Object.fromEntries(params);
        } else {
          payload = body;
        }

        // Extract headers of interest
        const headers: Record<string, string> = {};
        for (const [key, value] of req.headers.entries()) {
          if (
            key.startsWith("x-") ||
            key === "content-type" ||
            key === "authorization"
          ) {
            headers[key] = value;
          }
        }

        const notification: SlackPayload = {
          timestamp: new Date().toISOString(),
          payload,
          headers,
        };

        notifications.push(notification);

        console.log(
          `[${notification.timestamp}] Captured notification:`,
          JSON.stringify(payload, null, 2)
        );

        // Simulate Slack's response
        return Response.json(
          { ok: true, notification_id: notifications.length },
          { headers: corsHeaders }
        );
      }

      // Get captured notifications
      if (url.pathname === "/notifications" && method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const since = url.searchParams.get("since");

        let results = notifications;

        // Filter by timestamp if provided
        if (since) {
          results = results.filter((n) => n.timestamp > since);
        }

        // Apply limit
        results = results.slice(-limit);

        return Response.json(
          {
            count: results.length,
            total: notifications.length,
            notifications: results,
          },
          { headers: corsHeaders }
        );
      }

      // Simulate button click
      if (url.pathname === "/simulate-button" && method === "POST") {
        const body = (await req.json()) as ButtonSimulation;
        const { action_id, value, response_url } = body;

        if (!action_id || !value) {
          return Response.json(
            { error: "Missing action_id or value" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Build Slack-like action payload
        const slackActionPayload = {
          type: "block_actions",
          user: {
            id: "TEST_USER",
            username: "test_user",
            name: "Test User",
          },
          actions: [
            {
              action_id,
              block_id: "test_block",
              type: "button",
              value,
              action_ts: Date.now().toString(),
            },
          ],
          response_url: response_url || `http://localhost:${PORT}/webhook`,
          trigger_id: `test-trigger-${Date.now()}`,
        };

        // Forward to MCP server
        try {
          const mcpResponse = await fetch(`${MCP_SERVER_URL}/slack/actions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              payload: JSON.stringify(slackActionPayload),
            }),
          });

          const mcpResult = await mcpResponse.text();

          return Response.json(
            {
              ok: true,
              mcp_status: mcpResponse.status,
              mcp_response: mcpResult,
              forwarded_payload: slackActionPayload,
            },
            { headers: corsHeaders }
          );
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error: `Failed to forward to MCP server: ${error}`,
              attempted_url: `${MCP_SERVER_URL}/slack/actions`,
            },
            { status: 502, headers: corsHeaders }
          );
        }
      }

      // Reset notifications
      if (url.pathname === "/reset" && method === "POST") {
        const count = notifications.length;
        notifications.length = 0;
        return Response.json(
          { ok: true, cleared_count: count },
          { headers: corsHeaders }
        );
      }

      // Get latest notification (convenience endpoint)
      if (url.pathname === "/notifications/latest" && method === "GET") {
        if (notifications.length === 0) {
          return Response.json(
            { error: "No notifications captured" },
            { status: 404, headers: corsHeaders }
          );
        }
        return Response.json(notifications[notifications.length - 1], {
          headers: corsHeaders,
        });
      }

      // Wait for notification (polling endpoint)
      if (url.pathname === "/notifications/wait" && method === "GET") {
        const timeout = parseInt(url.searchParams.get("timeout") || "5000");
        const minCount = parseInt(url.searchParams.get("count") || "1");
        const startCount = notifications.length;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
          if (notifications.length >= startCount + minCount) {
            return Response.json(
              {
                ok: true,
                waited_ms: Date.now() - startTime,
                new_notifications: notifications.slice(startCount),
              },
              { headers: corsHeaders }
            );
          }
          await Bun.sleep(100);
        }

        return Response.json(
          {
            ok: false,
            error: "Timeout waiting for notifications",
            waited_ms: timeout,
            expected_count: minCount,
            actual_count: notifications.length - startCount,
          },
          { status: 408, headers: corsHeaders }
        );
      }

      // 404 for unknown routes
      return Response.json(
        {
          error: "Not found",
          available_endpoints: [
            "GET  /health",
            "POST /webhook",
            "GET  /notifications",
            "GET  /notifications/latest",
            "GET  /notifications/wait",
            "POST /simulate-button",
            "POST /reset",
          ],
        },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error handling request:", error);
      return Response.json(
        { error: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  },
});

console.log(`Mock Slack server running on http://localhost:${PORT}`);
console.log("Endpoints:");
console.log("  POST /webhook          - Capture notification payloads");
console.log("  GET  /notifications    - Retrieve captured payloads");
console.log("  POST /simulate-button  - Simulate button click");
console.log("  GET  /health           - Health check");
console.log("  POST /reset            - Clear notifications");

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down mock server...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down mock server...");
  server.stop();
  process.exit(0);
});
