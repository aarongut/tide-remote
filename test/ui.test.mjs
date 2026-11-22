import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "vite-plus";
import { Window } from "happy-dom";
test("UI bundles icons, uses device output IDs, and sends control commands", async () => {
  const window = new Window({
    url: "http://localhost:3000",
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
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
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: { entry: "web/app.js", formats: ["iife"], name: "TideRemote" },
    },
  });
  window.eval(result[0].output.find((file) => file.type === "chunk").code);
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
  const preset = window.document.getElementById("preset");
  assert.equal(preset.selectedOptions[0].textContent, "ART");
  ws.onmessage({
    data: JSON.stringify({ type: "state", state: { ...state, presets: [] } }),
  });
  assert.equal(preset.selectedOptions[0].textContent, "Preset 1 (unavailable)");
  assert.equal(preset.disabled, true);
  ws.onmessage({ data: JSON.stringify({ type: "state", state }) });
  assert.equal(preset.selectedOptions[0].textContent, "ART");
  assert.equal(preset.disabled, false);
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
  const increase = window.document.getElementById("increase");
  const slider = window.document.getElementById("volume-slider");
  const volume = window.document.getElementById("volume-value");
  const readVolume = (value) =>
    ws.onmessage({
      data: JSON.stringify({
        type: "state",
        state: { ...state, volume: value },
      }),
    });
  const confirm = (id) =>
    ws.onmessage({ data: JSON.stringify({ type: "result", id, ok: true }) });

  for (let i = 0; i < 6; i++) increase.click();
  assert.equal(ws.sent.length, 3);
  assert.deepEqual(ws.sent.at(-1).command, {
    endpoint: "set_volume_db",
    value: -35.5,
  });
  assert.equal(volume.textContent, "−33.0");
  assert.equal(slider.value, "-33");
  assert.equal(preset.disabled, true);
  readVolume(-35.5);
  assert.equal(volume.textContent, "−33.0");
  confirm("3");
  assert.equal(ws.sent.at(-1).command.value, -33);

  slider.value = "-40";
  slider.dispatchEvent(new window.Event("input"));
  assert.equal(volume.textContent, "−40.0");
  slider.dispatchEvent(new window.Event("change"));
  assert.equal(ws.sent.length, 4);
  readVolume(-33);
  confirm("4");
  assert.equal(ws.sent.at(-1).command.value, -40);
  readVolume(-39.5);
  confirm("5");
  assert.equal(volume.textContent, "−39.5");
  assert.equal(preset.disabled, false);

  const mute = window.document.getElementById("mute");
  increase.click();
  assert.equal(mute.disabled, false);
  mute.click();
  assert.equal(mute.getAttribute("aria-pressed"), "true");
  assert.equal(ws.sent.at(-1).command.endpoint, "set_volume_db");
  readVolume(-39);
  confirm("6");
  assert.deepEqual(ws.sent.at(-1).command, {
    endpoint: "set_mute",
    value: true,
  });
  assert.equal(increase.disabled, false);
  mute.click();
  assert.equal(mute.getAttribute("aria-pressed"), "false");
  ws.onmessage({
    data: JSON.stringify({
      type: "state",
      state: { ...state, mute: true, volume: -39 },
    }),
  });
  confirm("7");
  assert.deepEqual(ws.sent.at(-1).command, {
    endpoint: "set_mute",
    value: false,
  });
  readVolume(-39);
  confirm("8");

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
