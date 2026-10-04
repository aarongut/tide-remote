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

// Source metadata only: the selected upmixer and installed speaker layout
// must never cause a stereo source to be labelled Atmos or 7.1.
export function streamLabel(stream = {}) {
  const source = [stream.decoder_stream_src_format, stream.decoder_stream_type]
    .filter((value) => value && String(value).trim() !== "0")
    .join(" ");
  if (/atmos|(?:^|\W)mat(?:\W|$)/i.test(source) && /atmos/i.test(source))
    return "Dolby Atmos";
  if (/dts[\s:_-]*x(?:\W|$)/i.test(source)) return "DTS:X";
  const config = String(stream.channel_config || "").trim();
  if (config === "0") return "No signal";
  if (/^(2|2\.0|2\/0(?:\.0)?|stereo|2ch|2 channels)$/i.test(config))
    return "Stereo";
  const layout = config.match(/(?:^|\s)([1-9]\.\d(?:\.\d)?)(?:$|\s)/);
  if (layout) return layout[1] === "2.0" ? "Stereo" : layout[1];
  if (config) return config;
  if (source.trim()) return source.trim();
  if (Number(stream.sample_rate) > 0 || Number(stream.dec_sample_rate) > 0)
    return "Unknown format";
  return "No signal";
}
