import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { Tide } from "../server/tide.mjs";
import { createServer } from "../server/index.mjs";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error("State did not arrive");
}
test("bridge initializes, serializes upmix commands, and polls only for visible clients", async (t) => {
  const received = [];
  let mode = "native";
  const device = new WebSocketServer({ port: 0 });
  await once(device, "listening");
  t.after(() => device.close());
  device.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const m = JSON.parse(raw);
      received.push(m);
      const reads = {
        get_volume_db: -36,
        get_mute: false,
        get_source: "hdmi1",
        get_source_names: { hdmi1: "Shield" },
        get_hidden_sources: {},
        get_all_presets: [{ id: "1", name: "ART" }],
        get_current_preset_index: 1,
        get_dirac_state: { enabled: true, gain: true, delay: true },
        get_output_speakers: { 1: "LeftFront", 13: "Sub2" },
        get_stream_properties: { channel_config: "2.0" },
        get_rms_block_db: {
          out: [
            { index: 1, val: -45 },
            { index: 13, val: -51 },
          ],
        },
      };
      if (m.endpoint === "set_forced_upmixer") {
        mode = m.decoder;
        socket.send(
          JSON.stringify({ notification: "upmixer_change", value: mode }),
        );
      }
      const data =
        m.endpoint === "get_current_preset"
          ? { data: { upmixer: mode } }
          : reads[m.endpoint];
      setTimeout(
        () =>
          socket.send(JSON.stringify({ req: m.endpoint, status: "OK", data })),
        5,
      );
    }),
  );
  const tide = new Tide(`ws://127.0.0.1:${device.address().port}`, {
    timeout: 1000,
    reconnect: 100,
  });
  t.after(() => tide.stop());
  tide.start();
  await until(() => tide.state.ready);
  assert.equal(tide.state.format, "Stereo");
  assert.equal(tide.state.outputs.length, 2);
  await sleep(150);
  assert.equal(
    received.filter((r) => r.endpoint === "get_rms_block_db").length,
    0,
  );
  const server = createServer({ tide });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = new WebSocket(origin.replace("http", "ws") + "/ws", {
    origin,
  });
  t.after(() => browser.terminate());
  await once(browser, "open");
  const messages = [];
  browser.on("message", (raw) => messages.push(JSON.parse(raw)));
  await until(() => received.some((r) => r.endpoint === "get_rms_block_db"));
  browser.send(
    JSON.stringify({
      type: "command",
      id: "1",
      command: { endpoint: "set_forced_upmixer", decoder: "datmos" },
    }),
  );
  await until(() => messages.some((m) => m.type === "result" && m.id === "1"));
  assert.equal(messages.find((m) => m.id === "1").ok, true);
  assert.equal(tide.state.upmixer, "datmos");
  browser.send(JSON.stringify({ type: "visibility", visible: false }));
  await until(() => tide.visibleClients === 0);
  await sleep(50);
  const count = received.filter(
    (r) => r.endpoint === "get_rms_block_db",
  ).length;
  await sleep(200);
  assert.equal(
    received.filter((r) => r.endpoint === "get_rms_block_db").length,
    count,
  );
  browser.send(
    JSON.stringify({
      type: "command",
      id: "2",
      command: { endpoint: "reboot" },
    }),
  );
  await until(() => messages.some((m) => m.id === "2"));
  assert.equal(messages.find((m) => m.id === "2").ok, false);
  assert(!received.some((m) => m.endpoint === "reboot"));
  for (const socket of device.clients) socket.terminate();
  await until(() => !tide.state.connected);
  assert.equal(tide.state.ready, false);
});
test("cross-origin browser connection is rejected", async (t) => {
  const tide = new Tide("ws://127.0.0.1:1");
  const server = createServer({ tide });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
    origin: "https://other.example",
  });
  const [error] = await once(socket, "error");
  assert.match(error.message, /403/);
});

test("output assignments recover after an empty boot response without notifications", async (t) => {
  const device = new WebSocketServer({ port: 0 });
  await once(device, "listening");
  t.after(() => device.close());
  let outputs = {};
  device.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const { endpoint } = JSON.parse(raw);
      const data = endpoint === "get_output_speakers" ? outputs : {};
      socket.send(JSON.stringify({ req: endpoint, status: "OK", data }));
    });
  });
  const tide = new Tide(`ws://127.0.0.1:${device.address().port}`);
  t.after(() => tide.stop());
  tide.visibleClients = 1;
  tide.start();
  await until(() => tide.state.ready);
  assert.deepEqual(tide.state.outputs, []);
  outputs = { 1: "LeftFront", 13: "Sub2" };
  await sleep(2600);
  await until(() => tide.state.outputs.length === 2);
  assert.deepEqual(tide.state.outputs, [
    { index: 1, name: "LeftFront" },
    { index: 13, name: "Sub2" },
  ]);
  tide.state.busy = true;
  outputs = { 3: "Center" };
  tide.notification({ notification: "coordinator_status", value: "ready" });
  await until(() => tide.state.outputs[0]?.index === 3);
  assert.equal(tide.state.busy, false);
  tide.state.busy = true;
  for (const socket of device.clients) socket.terminate();
  await until(() => !tide.state.connected);
  assert.equal(tide.state.busy, false);
});
