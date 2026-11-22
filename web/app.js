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
  pending = null,
  volumeTarget = null,
  muteTarget = null,
  volumeTimer,
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
function controlsUnavailable() {
  return !state.ready || state.busy || socket?.readyState !== WebSocket.OPEN;
}
function enableControls() {
  const unavailable = controlsUnavailable();
  const disabled = unavailable || pending !== null;
  controls.forEach((c) => (c.disabled = disabled));
  $("preset").disabled = disabled || !state.presets?.length;
  const audioDisabled =
    unavailable || (pending !== null && !isAudioCommand(pending));
  $("mute").disabled = audioDisabled;
  const volumeDisabled =
    audioDisabled || !Number.isFinite(volumeTarget ?? state.volume);
  for (const id of ["volume-slider", "decrease", "increase"])
    $(id).disabled = volumeDisabled;
}
function isAudioCommand({ endpoint }) {
  return endpoint === "set_volume_db" || endpoint === "set_mute";
}
function sendAudioTarget() {
  if (pending || controlsUnavailable()) return;
  if (muteTarget === state.mute) muteTarget = null;
  if (muteTarget !== null) command({ endpoint: "set_mute", value: muteTarget });
  else if (volumeTarget !== null)
    command({ endpoint: "set_volume_db", value: volumeTarget });
}
function clearVolumeTarget() {
  volumeTarget = null;
  clearTimeout(volumeTimer);
}
function queueVolume(value) {
  if ($("volume-slider").disabled || value === (volumeTarget ?? state.volume)) {
    render();
    return;
  }
  if (volumeTarget === null) {
    message("");
    volumeTimer = setTimeout(() => message("Updating volume…"), 3000);
  }
  volumeTarget = value;
  sendAudioTarget();
  render();
}
function options(select, items, key, otherInputs = []) {
  const signature = JSON.stringify([items, otherInputs]);
  if (key === "sources" && signature === sourcesKey) return;
  if (key === "presets" && signature === presetsKey) return;
  if (key === "sources") sourcesKey = signature;
  else presetsKey = signature;
  const createOption = ([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  };
  const children = items.map(createOption);
  if (otherInputs.length) {
    const group = document.createElement("optgroup");
    group.label = "Other inputs";
    group.append(...otherInputs.map(createOption));
    children.push(group);
  }
  select.replaceChildren(...children);
}
function showVolume(value = state.volume) {
  const muted = muteTarget ?? state.mute === true;
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
  const aliases = [];
  const defaults = [];
  for (const [id, label] of Object.entries(sourceDefaults)) {
    if (state.hiddenSources?.[id] && id !== state.source) continue;
    const name = names[id]?.trim();
    if (name && name !== label) aliases.push([id, name]);
    else defaults.push([id, label]);
  }
  options(
    $("source"),
    aliases.length ? aliases : defaults,
    "sources",
    aliases.length ? defaults : [],
  );
  $("source").value = state.source || "";
  const presets = (state.presets || []).map((p) => [
    String(p.id),
    p.name?.trim() || `Preset ${p.id}`,
  ]);
  if (!presets.some(([id]) => id === String(state.preset ?? "")))
    presets.unshift([
      String(state.preset ?? ""),
      state.preset != null
        ? `Preset ${state.preset} (unavailable)`
        : state.ready
          ? "No presets available"
          : "Loading presets…",
    ]);
  options($("preset"), presets, "presets");
  $("preset").options[0].disabled = !state.presets?.some(
    (p) => String(p.id) === $("preset").options[0].value,
  );
  $("preset").value = String(state.preset ?? "");
  $("dirac").checked = state.dirac?.enabled === true;
  document
    .querySelectorAll("[data-upmix]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.upmix === state.upmixer)),
    );
  if (!dragging) {
    $("volume-slider").min = String(
      Math.min(-80, state.volume ?? -80, volumeTarget ?? -80),
    );
    $("volume-slider").value = volumeTarget ?? state.volume ?? -80;
  }
  showVolume(
    dragging
      ? Number($("volume-slider").value)
      : (volumeTarget ?? state.volume),
  );
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
  if (pending || controlsUnavailable()) {
    render();
    return;
  }
  pending = command;
  enableControls();
  if (!isAudioCommand(command)) message("");
  socket.send(
    JSON.stringify({ type: "command", id: String(++requestId), command }),
  );
  commandTimer = setTimeout(() => {
    pending = null;
    clearVolumeTarget();
    muteTarget = null;
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
      if (controlsUnavailable()) {
        dragging = false;
        if (volumeTarget !== null || muteTarget !== null) {
          clearVolumeTarget();
          muteTarget = null;
          message("Could not finish updating the audio controls", true);
        }
      }
      render();
    }
    if (m.type === "levels") {
      state.levels = m.levels;
      levels(m.levels);
    }
    if (m.type === "result" && pending && m.id === String(requestId)) {
      clearTimeout(commandTimer);
      const completed = pending;
      pending = null;
      if (
        completed.endpoint === "set_volume_db" &&
        volumeTarget !== null &&
        (!m.ok ||
          volumeTarget === completed.value ||
          volumeTarget === state.volume)
      ) {
        clearVolumeTarget();
        message("");
      }
      if (
        completed.endpoint === "set_mute" &&
        (!m.ok || muteTarget === completed.value || muteTarget === state.mute)
      )
        muteTarget = null;
      if (!m.ok) message(m.message || "Could not change the setting", true);
      sendAudioTarget();
      render();
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    clearTimeout(commandTimer);
    pending = null;
    if (volumeTarget !== null || muteTarget !== null) {
      clearVolumeTarget();
      muteTarget = null;
      message("Disconnected before the audio changes could be confirmed", true);
    }
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
  queueVolume(Number(e.target.value));
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
    const current = volumeTarget ?? state.volume;
    if (Number.isFinite(current))
      queueVolume(Math.max(-127.5, Math.min(0, current + delta)));
  });
$("mute").addEventListener("click", () => {
  if ($("mute").disabled) return;
  if (!pending) message("");
  muteTarget = !(muteTarget ?? state.mute);
  sendAudioTarget();
  render();
});
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
