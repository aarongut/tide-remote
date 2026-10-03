import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Tide } from "./tide.mjs";

export function createServer({
  tide,
  user = "",
  password = "",
  allowedOrigin = "",
} = {}) {
  if (Boolean(user) !== Boolean(password))
    throw new Error("Set both REMOTE_USER and REMOTE_PASSWORD");
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    "/sw.js": ["sw.js", "text/javascript"],
    "/manifest.webmanifest": [
      "manifest.webmanifest",
      "application/manifest+json",
    ],
    "/icon.svg": ["icon.svg", "image/svg+xml"],
    "/icon-192.png": ["icon-192.png", "image/png"],
    "/icon-512.png": ["icon-512.png", "image/png"],
    "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
  };
  const expected = Buffer.from(
    "Basic " + Buffer.from(`${user}:${password}`).toString("base64"),
  );
  const authenticated = (req) => {
    if (!user) return true;
    const actual = Buffer.from(req.headers.authorization || "");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  };
  const server = http.createServer(async (req, res) => {
    if (!authenticated(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Tide 16"' });
      res.end("Authentication required");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    );
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          bridge: true,
          processor: tide.state.connected,
          ready: tide.state.ready,
        }),
      );
      return;
    }
    const file = files[path];
    if (!file) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const data = await readFile(
        fileURLToPath(new URL(`../dist/${file[0]}`, import.meta.url)),
      );
      res.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(503);
      res.end("Build the app with npm run build first");
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      socket.destroy();
      return;
    }
    const sameOrigin = allowedOrigin
      ? origin.origin === allowedOrigin
      : origin.host === req.headers.host;
    if (req.url !== "/ws" || !authenticated(req) || !sameOrigin) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) =>
      wss.emit("connection", client, req),
    );
  });
  const send = (client, m) => {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 256000)
      client.send(JSON.stringify(m));
  };
  const count = () => {
    tide.visibleClients = [...wss.clients].filter((c) => c.visible).length;
  };
  wss.on("connection", (client) => {
    client.alive = true;
    client.on("pong", () => {
      client.alive = true;
    });
    client.visible = true;
    count();
    send(client, { type: "state", state: tide.state });
    let pending = false;
    client.on("message", async (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        send(client, { type: "error", message: "Invalid request" });
        return;
      }
      if (m.type === "visibility") {
        client.visible = m.visible === true;
        count();
        return;
      }
      if (m.type !== "command" || typeof m.id !== "string") return;
      if (pending) {
        send(client, {
          type: "result",
          id: m.id,
          ok: false,
          message: "Wait for the previous control to finish",
        });
        return;
      }
      pending = true;
      try {
        await tide.command(m.command);
        send(client, { type: "result", id: m.id, ok: true });
      } catch (error) {
        send(client, {
          type: "result",
          id: m.id,
          ok: false,
          message: error.message,
        });
      } finally {
        pending = false;
      }
    });
    client.on("close", count);
  });
  const stateListener = (state) => {
    for (const c of wss.clients) send(c, { type: "state", state });
  };
  const levelsListener = (levels) => {
    for (const c of wss.clients)
      if (c.visible) send(c, { type: "levels", levels });
  };
  tide.on("state", stateListener);
  tide.on("levels", levelsListener);
  const ping = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.alive) {
        client.terminate();
        continue;
      }
      client.alive = false;
      client.ping();
    }
  }, 20000);
  const close = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(ping);
    tide.off("state", stateListener);
    tide.off("levels", levelsListener);
    for (const c of wss.clients) c.terminate();
    wss.close();
    return close(callback);
  };
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  const tide = new Tide(
    `ws://${process.env.TIDE_HOST || "10.0.0.130"}:${process.env.TIDE_PORT || 5555}`,
  );
  const server = createServer({
    tide,
    user: process.env.REMOTE_USER,
    password: process.env.REMOTE_PASSWORD,
    allowedOrigin: process.env.APP_ORIGIN,
  });
  tide.start();
  server.listen(port, host, () =>
    console.log(`Tide 16 remote: http://${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      tide.stop();
      server.close();
    });
}
