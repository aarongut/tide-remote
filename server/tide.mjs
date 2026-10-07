import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { assignedOutputs, streamLabel, validateCommand } from "./protocol.mjs";

const READS = [
  "get_volume_db",
  "get_mute",
  "get_source",
  "get_source_names",
  "get_hidden_sources",
  "get_all_presets",
  "get_current_preset_index",
  "get_dirac_state",
  "get_output_speakers",
  "get_stream_properties",
  "get_current_preset",
];
export class Tide extends EventEmitter {
  constructor(url, { timeout = 7000, reconnect = 1500 } = {}) {
    super();
    this.url = url;
    this.timeout = timeout;
    this.reconnectDelay = reconnect;
    this.state = {
      connected: false,
      ready: false,
      volume: null,
      mute: null,
      source: null,
      sourceNames: {},
      hiddenSources: {},
      presets: [],
      preset: null,
      dirac: null,
      upmixer: null,
      outputs: [],
      stream: {},
      format: "No signal",
      levels: [],
    };
    this.queue = [];
    this.active = null;
    this.stopped = false;
    this.visibleClients = 0;
  }
  start() {
    this.connect();
    this.meterTimer = setInterval(() => this.pollMeters(), 100);
    this.streamTimer = setInterval(() => {
      if (
        this.state.ready &&
        this.visibleClients &&
        !this.active &&
        !this.queue.length
      )
        this.refresh(["get_stream_properties", "get_output_speakers"]);
    }, 2500);
  }
  connect() {
    if (this.stopped) return;
    const socket = (this.socket = new WebSocket(this.url, {
      handshakeTimeout: 5000,
      maxPayload: 2 * 1024 * 1024,
    }));
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 20000);
    socket.on("open", async () => {
      this.state.connected = true;
      this.publish();
      try {
        for (const endpoint of READS) await this.request({ endpoint });
        if (socket !== this.socket || socket.readyState !== WebSocket.OPEN)
          return;
        this.state.ready = true;
        this.publish();
      } catch {
        socket.terminate();
      }
    });
    socket.on("message", (raw) => {
      try {
        this.message(JSON.parse(raw.toString()));
      } catch (error) {
        this.emit("diagnostic", error.message);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearInterval(ping);
      if (socket !== this.socket) return;
      this.state.connected = false;
      this.state.ready = false;
      this.state.busy = false;
      this.state.levels = [];
      this.publish();
      this.failAll(new Error("Processor disconnected"));
      if (!this.stopped)
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          this.reconnectDelay,
        );
    });
  }
  publish() {
    this.emit("state", structuredClone(this.state));
  }
  failAll(error) {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(error);
      this.active = null;
    }
    for (const task of this.queue) task.reject(error);
    this.queue = [];
  }
  request(command) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN)
        return reject(new Error("Processor disconnected"));
      if (this.queue.length > 30) return reject(new Error("Processor busy"));
      this.queue.push({ command, resolve, reject });
      this.pump();
    });
  }
  pump() {
    if (
      this.active ||
      !this.queue.length ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    const task = (this.active = this.queue.shift());
    task.timer = setTimeout(() => {
      task.reject(new Error("Processor did not confirm the command"));
      this.active = null;
      this.socket.terminate();
    }, this.timeout);
    this.socket.send(JSON.stringify(task.command), (error) => {
      if (error) this.socket.terminate();
    });
  }
  message(m) {
    if (m.notification) {
      this.notification(m);
      return;
    }
    if (!m.req || !this.active || m.req !== this.active.command.endpoint)
      return;
    const task = this.active;
    clearTimeout(task.timer);
    this.active = null;
    if (m.status !== "OK")
      task.reject(
        new Error(
          typeof m.data === "string"
            ? m.data
            : "Processor rejected the command",
        ),
      );
    else {
      this.read(m.req, m.data);
      task.resolve(m.data);
    }
    this.pump();
  }
  read(endpoint, data) {
    switch (endpoint) {
      case "get_volume_db":
        if (Number.isFinite(data)) this.state.volume = data;
        break;
      case "get_mute":
        this.state.mute = data;
        break;
      case "get_source":
        this.state.source = data;
        break;
      case "get_source_names":
        this.state.sourceNames = data || {};
        break;
      case "get_hidden_sources":
        this.state.hiddenSources = data || {};
        break;
      case "get_all_presets":
        this.state.presets = Array.isArray(data) ? data : [];
        break;
      case "get_current_preset_index":
        this.state.preset = Number(data);
        break;
      case "get_dirac_state":
        this.state.dirac = data;
        break;
      case "get_output_speakers":
        this.state.outputs = assignedOutputs(data);
        break;
      case "get_stream_properties":
        this.state.stream = data || {};
        this.state.format = streamLabel(data);
        break;
      case "get_current_preset": {
        const p = data?.data ?? data;
        if (p?.upmixer) this.state.upmixer = p.upmixer;
        if (p?.dirac) this.state.dirac = p.dirac;
        break;
      }
      case "get_rms_block_db":
        this.state.levels = Array.isArray(data?.out) ? data.out : [];
        this.emit("levels", this.state.levels);
        return;
    }
    this.publish();
  }
  notification(m) {
    const value = m.value ?? m.data;
    switch (m.notification) {
      case "volume_change_db":
        if (Number.isFinite(value)) this.state.volume = value;
        break;
      case "volume_change":
        if (Number.isFinite(value))
          this.state.volume = value > 0 ? 20 * Math.log10(value) : -127.5;
        break;
      case "mute_change":
        this.state.mute = value;
        break;
      case "source_change":
        this.state.source = value;
        this.refresh(["get_stream_properties"]);
        break;
      case "upmixer_change":
        this.state.upmixer = value;
        break;
      case "dirac_state":
        this.state.dirac = value;
        break;
      case "preset_change":
        this.state.preset = Number(value);
        this.refresh([
          "get_current_preset",
          "get_dirac_state",
          "get_output_speakers",
        ]);
        break;
      case "stream_changes":
        this.refresh(["get_stream_properties"]);
        break;
      case "speaker_config_number_change":
        this.refresh(["get_output_speakers"]);
        break;
      case "coordinator_status":
        this.state.busy = value !== "ready";
        if (!this.state.busy) this.refresh(["get_output_speakers"]);
        break;
      default:
        return;
    }
    this.publish();
  }
  refresh(endpoints) {
    for (const endpoint of endpoints) {
      if (
        this.active?.command.endpoint === endpoint ||
        this.queue.some((t) => t.command.endpoint === endpoint)
      )
        continue;
      this.request({ endpoint }).catch(() => {});
    }
  }
  pollMeters() {
    if (
      !this.state.ready ||
      !this.visibleClients ||
      this.state.busy ||
      this.active ||
      this.queue.length
    )
      return;
    this.request({ endpoint: "get_rms_block_db" }).catch(() => {});
  }
  async command(input) {
    if (!this.state.ready || this.state.busy)
      throw new Error("Processor is not ready");
    const command = validateCommand(input);
    if (
      command.endpoint === "set_preset" &&
      !this.state.presets.some((p) => Number(p.id) === command.id)
    )
      throw new Error("Preset is not available");
    const result = await this.request(command);
    const reads = {
      set_volume_db: ["get_volume_db"],
      set_mute: ["get_mute"],
      set_source: ["get_source", "get_stream_properties"],
      set_forced_upmixer: ["get_current_preset", "get_stream_properties"],
      set_dirac_state: ["get_dirac_state"],
      set_preset: [
        "get_current_preset_index",
        "get_current_preset",
        "get_dirac_state",
        "get_output_speakers",
      ],
    };
    this.refresh(reads[command.endpoint]);
    return result;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.meterTimer);
    clearInterval(this.streamTimer);
    this.failAll(new Error("Bridge stopped"));
    this.socket?.terminate();
  }
}
