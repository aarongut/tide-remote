export const SOURCES = [
  "hdmi1",
  "hdmi2",
  "hdmi3",
  "arc_earc",
  "usb",
  "spdif1",
  "spdif2",
  "toslink1",
  "toslink2",
  "xlr",
  "rca",
  "bluetooth",
];
export function validateCommand(command) {
  if (!command || typeof command !== "object")
    throw new Error("Invalid command");
  switch (command.endpoint) {
    case "set_volume_db":
      if (
        !Number.isFinite(command.value) ||
        command.value < -127.5 ||
        command.value > 0
      )
        throw new Error("Volume must be between −127.5 and 0 dB");
      return { endpoint: command.endpoint, value: command.value };
    case "set_mute":
      if (typeof command.value !== "boolean")
        throw new Error("Invalid mute state");
      return { endpoint: command.endpoint, value: command.value };
    case "set_source":
      if (!SOURCES.includes(command.value)) throw new Error("Invalid input");
      return { endpoint: command.endpoint, value: command.value };
    case "set_forced_upmixer":
      if (!["native", "datmos", "dts"].includes(command.decoder))
        throw new Error("Invalid upmix mode");
      return { endpoint: command.endpoint, decoder: command.decoder };
    case "set_dirac_state":
      if (typeof command.enabled !== "boolean")
        throw new Error("Invalid Dirac state");
      return { endpoint: command.endpoint, enabled: command.enabled };
    case "set_preset":
      if (!Number.isInteger(command.id) || command.id < 1 || command.id > 99)
        throw new Error("Invalid preset");
      return { endpoint: command.endpoint, id: command.id };
    default:
      throw new Error("Unsupported control");
  }
}

export function assignedOutputs(speakers = {}) {
  return Object.entries(speakers)
    .filter(
      ([id, name]) =>
        Number(id) >= 1 &&
        Number(id) <= 16 &&
        typeof name === "string" &&
        name.trim() &&
        !/^(none|unassigned|unused|disabled|null)$/i.test(name.trim()),
    )
    .map(([id, name]) => ({ index: Number(id), name }))
    .sort((a, b) => a.index - b.index);
}

function channelLabel(stream) {
  const config = String(stream.channel_config ?? "").trim();
  const layout = config.match(/(?:^|\s)([1-9]\.\d(?:\.\d)?)(?:$|\s)/);
  if (layout) {
    if (layout[1] === "1.0") return "Mono";
    if (layout[1] === "2.0") return "Stereo";
    return layout[1];
  }
  if (/^(mono)$/i.test(config)) return "Mono";
  if (/^(2\/0(?:\.0)?|stereo|2ch|2 channels)$/i.test(config)) return "Stereo";
  let count = /^[1-9]\d*$/.test(config) ? Number(config) : 0;
  if (!count) {
    // Observed stereo=3 and Plex 3.0=7 support a speaker bitmask.
    const map = String(stream.speakers_stream_map ?? "").trim();
    if (
      /^\d+$/.test(map) &&
      Number.isSafeInteger(Number(map)) &&
      Number(map) > 0
    )
      count = Number(map).toString(2).replaceAll("0", "").length;
  }
  if (count === 1) return "Mono";
  if (count === 2) return "Stereo";
  // Conventional layouts, consistent with the existing 6/8-channel assumption.
  if (count === 6) return "5.1";
  if (count === 8) return "7.1";
  return count ? `${count}.0` : "";
}

// The selected upmixer and installed speaker layout never determine input channels.
export function streamLabel(stream = {}) {
  const type = String(stream.decoder_stream_type || "")
    .trim()
    .toUpperCase();
  const processing = String(stream.decoder_stream_proc_type || "").trim();
  const channels = channelLabel(stream);
  const withChannels = (codec) => (channels ? `${codec} · ${channels}` : codec);
  // Recognized stream types take precedence over stale source text.
  if (type === "DTSX_DTS_MA") return withChannels("DTS-HD MA");
  if (type === "DOLBY_DD") return withChannels("Dolby Digital");
  if (type === "DOLBY_DTHD")
    return /^Dolby Atmos$/i.test(processing)
      ? "Dolby Atmos"
      : withChannels("Dolby TrueHD");
  if (type === "DOLBY_DDP")
    return /^Dolby Atmos$/i.test(processing)
      ? "Dolby Atmos"
      : withChannels("Dolby Digital Plus");
  const source = [stream.decoder_stream_src_format, stream.decoder_stream_type]
    .filter((value) => value && String(value).trim() !== "0")
    .join(" ");
  if (/atmos/i.test(source)) return "Dolby Atmos";
  if (/dts[\s:_-]*x(?:\W|$)/i.test(source)) return withChannels("DTS:X");
  if (channels) return channels;
  const config = String(stream.channel_config ?? "").trim();
  if (config && config !== "0") return config;
  if (type === "DOLBY_PCM") return "PCM";
  if (source.trim()) return source.trim();
  if (Number(stream.sample_rate) > 0 || Number(stream.dec_sample_rate) > 0)
    return "Unknown format";
  return "No signal";
}
