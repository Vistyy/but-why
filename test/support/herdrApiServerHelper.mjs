import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

const [socketPath, capturePath, readyPath] = process.argv.slice(2);
if (!socketPath || !capturePath || !readyPath) process.exit(2);

const server = createServer((socket) => {
  let source = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    source += chunk;
    const newline = source.indexOf("\n");
    if (newline < 0) return;
    const request = JSON.parse(source.slice(0, newline));
    if (request.method === "ping") {
      socket.end(
        `${JSON.stringify({
          id: request.id,
          result: { type: "pong", version: "0.8.0", protocol: 19 },
        })}\n`,
      );
      return;
    }
    if (request.method === "agent.prompt") {
      writeFileSync(capturePath, request.params.text);
      socket.end(
        `${JSON.stringify({
          id: request.id,
          result: {
            type: "agent_prompted",
            agent: {
              terminal_id: "terminal",
              agent_status: "working",
              workspace_id: "workspace",
              tab_id: "tab",
              pane_id: "pane",
              focused: false,
              revision: 1,
            },
          },
        })}\n`,
      );
      return;
    }
    socket.end(
      `${JSON.stringify({
        id: request.id,
        error: { code: "method_not_found", message: "method not found" },
      })}\n`,
    );
  });
});

server.listen(socketPath, () => writeFileSync(readyPath, "ready\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
