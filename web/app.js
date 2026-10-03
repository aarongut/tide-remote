import { createIcons, AudioLines, Volume2, VolumeX } from "lucide";

createIcons({ icons: { AudioLines, Volume2, VolumeX } });
const $ = (id) => document.getElementById(id);
const controls = [
  ...document.querySelectorAll(
    ".settings button,.settings input,.settings select,.volume button,.volume input",
  ),
];
let socket,
  state = {},
  pending = false,
  dragging = false,
  retry = 500,
  requestId = 0,
  commandTimer,
  heartbeat;
let outputsKey = "",
  sourcesKey = "",
  presetsKey = "";
const sourceDefaults = {
  hdmi1: "HDMI 1",
  hdmi2: "HDMI 2",
  hdmi3: "HDMI 3",
  arc_earc: "ARC / eARC",
  usb: "USB",
  spdif1: "Coaxial 1",
  spdif2: "Coaxial 2",
  toslink1: "Optical 1",
  toslink2: "Optical 2",
  xlr: "Analog XLR",
  rca: "Analog RCA",
  bluetooth: "Bluetooth",
};
function message(text = "", error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function enableControls() {
  const disabled =
    !state.ready ||
    state.busy ||
    pending ||
    socket?.readyState !== WebSocket.OPEN;
  controls.forEach((c) => (c.disabled = disabled));
}
function options(select, items, key) {
  const signature = JSON.stringify(items);
  if (key === "sources" && signature === sourcesKey) return;
  if (key === "presets" && signature === presetsKey) return;
  if (key === "sources") sourcesKey = signature;
  else presetsKey = signature;
  select.replaceChildren(
    ...items.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
}
function showVolume(value = state.volume) {
  const muted = state.mute === true;
  $("volume-value").textContent = muted
    ? "Muted"
    : Number.isFinite(value)
      ? value.toFixed(1).replace("-", "−")
      : "—";
  $("volume-value").parentElement.classList.toggle("muted", muted);
  $("mute").setAttribute("aria-pressed", String(muted));
  $("mute-label").textContent = muted ? "Unmute" : "Mute";
}
function render() {
  const connected = state.connected && socket?.readyState === WebSocket.OPEN;
  $("connection").classList.toggle("connected", !!connected && state.ready);
  $("connection-text").textContent = !connected
    ? "Disconnected · reconnecting…"
    : !state.ready
      ? "Connecting…"
      : state.busy
        ? "Switching…"
        : "Connected";
  $("format").textContent = state.format || "No signal";
  $("format").title = [
    state.stream?.decoder_stream_src_format,
    state.stream?.channel_config,
    state.stream?.sample_rate,
  ]
    .filter(Boolean)
    .join(" · ");
  const names = state.sourceNames || {};
  const sources = Object.keys(sourceDefaults)
    .filter((id) => !state.hiddenSources?.[id] || id === state.source)
    .map((id) => [id, names[id] || sourceDefaults[id]]);
  options($("source"), sources, "sources");
  $("source").value = state.source || "";
  options(
    $("preset"),
    (state.presets || []).map((p) => [
      String(p.id),
      p.name?.trim() || `Preset ${p.id}`,
    ]),
    "presets",
  );
  $("preset").value = String(state.preset ?? "");
  $("dirac").checked = state.dirac?.enabled === true;
  document
    .querySelectorAll("[data-upmix]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.upmix === state.upmixer)),
    );
  if (!dragging) {
    $("volume-slider").min = String(Math.min(-80, state.volume ?? -80));
    $("volume-slider").value = state.volume ?? -80;
    showVolume();
  }
  const outputs = state.outputs || [];
  const key = JSON.stringify(outputs);
  if (key !== outputsKey) {
    outputsKey = key;
    $("meter-grid").style.setProperty("--count", Math.max(1, outputs.length));
    $("meter-grid").replaceChildren(
      ...outputs.map((output) => {
        const meter = document.createElement("div");
        meter.className = "meter";
        meter.dataset.index = output.index;
        meter.title = `${output.index} · ${output.name}`;
        meter.setAttribute(
          "aria-label",
          `${output.name}, output ${output.index}`,
        );
        const track = document.createElement("div");
        track.className = "meter-track";
        const fill = document.createElement("div");
        fill.className = "meter-fill";
        track.append(fill);
        const label = document.createElement("div");
        label.className = "meter-label";
        label.textContent = output.index;
        meter.append(track, label);
        return meter;
      }),
    );
    if (!outputs.length) {
      const empty = document.createElement("p");
      empty.className = "meter-empty";
      empty.textContent = connected
        ? "No assigned outputs"
        : "Waiting for your processor";
      $("meter-grid").append(empty);
    }
  }
  levels(state.levels || []);
  enableControls();
}
function levels(values) {
  const map = new Map(values.map((v) => [Number(v.index), Number(v.val)]));
  // A 60 dB display window anchored at master volume, matching the physical
  // meter's useful listening range. Red is proximity to this reference,
  // not a claim of measured clipping.
  const ceiling = Number.isFinite(state.volume) ? state.volume : 0;
  document.querySelectorAll(".meter").forEach((m) => {
    const db = map.get(Number(m.dataset.index));
    const fraction =
      !state.connected || state.mute || !Number.isFinite(db) || db <= -120
        ? 0
        : Math.max(0, Math.min(1, (db - (ceiling - 60)) / 60));
    m.querySelector(".meter-fill").style.setProperty(
      "--level",
      `${fraction * 100}%`,
    );
  });
}
function command(command) {
  if (
    pending ||
    !state.ready ||
    state.busy ||
    socket?.readyState !== WebSocket.OPEN
  ) {
    render();
    return;
  }
  pending = true;
  enableControls();
  message("");
  socket.send(
    JSON.stringify({ type: "command", id: String(++requestId), command }),
  );
  commandTimer = setTimeout(() => {
    pending = false;
    message("Could not confirm the change. Reconnecting…", true);
    socket.close();
    render();
  }, 10000);
}
function visibility() {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify({ type: "visibility", visible: !document.hidden }),
    );
}
function connect() {
  const ws = (socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  ));
  ws.onopen = () => {
    retry = 500;
    visibility();
  };
  ws.onmessage = (event) => {
    let m;
    try {
      m = JSON.parse(event.data);
    } catch {
      return;
    }
    if (m.type === "state") {
      state = m.state;
      render();
    }
    if (m.type === "levels") {
      state.levels = m.levels;
      levels(m.levels);
    }
    if (m.type === "result" && m.id === String(requestId)) {
      clearTimeout(commandTimer);
      pending = false;
      if (!m.ok) message(m.message || "Could not change the setting", true);
      render();
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    clearTimeout(commandTimer);
    pending = false;
    dragging = false;
    state.connected = false;
    state.ready = false;
    render();
    clearTimeout(heartbeat);
    heartbeat = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  };
  ws.onerror = () => ws.close();
}
$("source").addEventListener("change", (e) =>
  command({ endpoint: "set_source", value: e.target.value }),
);
$("preset").addEventListener("change", (e) =>
  command({ endpoint: "set_preset", id: Number(e.target.value) }),
);
$("dirac").addEventListener("change", (e) =>
  command({ endpoint: "set_dirac_state", enabled: e.target.checked }),
);
document.querySelectorAll("[data-upmix]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.upmix !== state.upmixer)
      command({ endpoint: "set_forced_upmixer", decoder: b.dataset.upmix });
  }),
);
$("volume-slider").addEventListener("input", (e) => {
  dragging = true;
  showVolume(Number(e.target.value));
});
$("volume-slider").addEventListener("change", (e) => {
  dragging = false;
  command({ endpoint: "set_volume_db", value: Number(e.target.value) });
});
$("volume-slider").addEventListener("pointercancel", () => {
  dragging = false;
  render();
});
for (const [id, delta] of [
  ["decrease", -0.5],
  ["increase", 0.5],
])
  $(id).addEventListener("click", () => {
    if (Number.isFinite(state.volume))
      command({
        endpoint: "set_volume_db",
        value: Math.max(-127.5, Math.min(0, state.volume + delta)),
      });
  });
$("mute").addEventListener("click", () =>
  command({ endpoint: "set_mute", value: !state.mute }),
);
document.addEventListener("visibilitychange", visibility);
window.addEventListener("pageshow", () => {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    clearTimeout(heartbeat);
    connect();
  } else visibility();
});
render();
connect();
if ("serviceWorker" in navigator && window.isSecureContext)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
