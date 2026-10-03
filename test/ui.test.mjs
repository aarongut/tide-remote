import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
test("UI bundles icons, uses device output IDs, and sends control commands", async () => {
  const window = new Window({
    url: "http://localhost:3000",
    settings: { enableJavaScriptEvaluation: true },
  });
  window.document.write(await readFile("web/index.html", "utf8"));
  window.document.querySelector("script")?.remove();
  let ws;
  class FakeSocket {
    static OPEN = 1;
    static CLOSED = 3;
    constructor() {
      ws = this;
      this.readyState = 1;
      this.sent = [];
    }
    send(s) {
      this.sent.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  window.WebSocket = FakeSocket;
  const result = await build({
    entryPoints: ["web/app.js"],
    bundle: true,
    write: false,
    format: "iife",
  });
  window.eval(result.outputFiles[0].text);
  const state = {
    connected: true,
    ready: true,
    volume: -36,
    mute: false,
    source: "hdmi1",
    sourceNames: { hdmi1: "Shield" },
    hiddenSources: { toslink2: true },
    presets: [{ id: "1", name: "ART" }],
    preset: 1,
    dirac: { enabled: true },
    upmixer: "native",
    outputs: [
      { index: 1, name: "LeftFront" },
      { index: 13, name: "Sub2" },
    ],
    stream: { channel_config: "2.0" },
    format: "Stereo",
    levels: [{ index: 13, val: -50 }],
  };
  ws.onmessage({ data: JSON.stringify({ type: "state", state }) });
  assert.equal(window.document.querySelectorAll(".meter").length, 2);
  assert.equal(
    window.document.querySelector('.meter[data-index="13"] .meter-label')
      .textContent,
    "13",
  );
  assert.equal(window.document.getElementById("format").textContent, "Stereo");
  assert(window.document.querySelector(".brand svg"));
  window.document.querySelector('[data-upmix="datmos"]').click();
  assert.deepEqual(ws.sent.at(-1).command, {
    endpoint: "set_forced_upmixer",
    decoder: "datmos",
  });
  ws.onmessage({ data: JSON.stringify({ type: "result", id: "1", ok: true }) });
  window.document.getElementById("dirac").click();
  assert.deepEqual(ws.sent.at(-1).command, {
    endpoint: "set_dirac_state",
    enabled: false,
  });
  ws.onmessage({ data: JSON.stringify({ type: "result", id: "2", ok: true }) });
  ws.onmessage({
    data: JSON.stringify({
      type: "state",
      state: { ...state, connected: false, ready: false },
    }),
  });
  assert(window.document.getElementById("volume-slider").disabled);
  await window.happyDOM.abort();
  window.close();
});
