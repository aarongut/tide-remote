import test from "node:test";
import assert from "node:assert/strict";
import {
  assignedOutputs,
  streamLabel,
  validateCommand,
} from "../server/protocol.mjs";
test("only supported, valid controls are forwarded", () => {
  assert.deepEqual(
    validateCommand({
      endpoint: "set_forced_upmixer",
      decoder: "datmos",
      extra: "ignored",
    }),
    { endpoint: "set_forced_upmixer", decoder: "datmos" },
  );
  assert.deepEqual(
    validateCommand({
      endpoint: "set_dirac_state",
      enabled: false,
      gain: false,
    }),
    { endpoint: "set_dirac_state", enabled: false },
  );
  for (const command of [
    { endpoint: "reboot" },
    { endpoint: "set_volume_db", value: 1 },
    { endpoint: "set_volume_db", value: NaN },
    { endpoint: "set_source", value: "alsa" },
    { endpoint: "set_preset", id: 1.2 },
    { endpoint: "set_forced_upmixer", decoder: "dolby" },
  ])
    assert.throws(() => validateCommand(command));
});
test("meters use assigned indices rather than first N values", () => {
  assert.deepEqual(
    assignedOutputs({
      1: "LeftFront",
      3: "Center",
      4: "Unused",
      5: "",
      16: "Sub2",
      17: "Invalid",
    }),
    [
      { index: 1, name: "LeftFront" },
      { index: 3, name: "Center" },
      { index: 16, name: "Sub2" },
    ],
  );
});
test("incoming format is independent of upmix and output layout", () => {
  assert.equal(
    streamLabel({
      channel_config: "2.0",
      decoder_stream_proc_type: "Atmos",
      decoder_type: "datmos",
    }),
    "Stereo",
  );
  assert.equal(streamLabel({ channel_config: "5.1" }), "5.1");
  assert.equal(streamLabel({ channel_config: "7.1" }), "7.1");
  assert.equal(
    streamLabel({
      decoder_stream_src_format: "Dolby Atmos",
      channel_config: "7.1",
    }),
    "Dolby Atmos",
  );
  assert.equal(streamLabel({ decoder_stream_src_format: "DTS:X" }), "DTS:X");
  assert.equal(
    streamLabel({
      decoder_stream_src_format: "Dolby MAT",
      channel_config: "7.1",
    }),
    "7.1",
  );
  assert.equal(streamLabel({}), "No signal");
});
test("Shield Tidal DDP Atmos uses the reported processing format", () => {
  const stream = {
    decoder_type: "Unknown decoder",
    decoder_stream_type: "DOLBY_DDP",
    decoder_stream_proc_type: "Dolby Atmos",
    decoder_stream_src_format: "",
    channel_config: "0",
    dec_sample_rate: 48000,
    sample_rate: "48000",
    is_lpcm_upmixed: false,
    is_bitstream: false,
    packet_type: "LPCM",
  };
  assert.equal(streamLabel(stream), "Dolby Atmos");
  assert.equal(
    streamLabel({
      ...stream,
      decoder_stream_proc_type: "Dolby Digital Plus",
      channel_config: "5.1",
    }),
    "Dolby Digital Plus · 5.1",
  );
  assert.equal(
    streamLabel({
      ...stream,
      decoder_stream_type: "LPCM",
      channel_config: "2.0",
      is_lpcm_upmixed: true,
    }),
    "Stereo",
  );
  assert.equal(
    streamLabel({
      decoder_stream_src_format: "Dolby TrueHD / MLP",
      decoder_stream_type: "DOLBY_DDP",
    }),
    "Dolby Digital Plus",
  );
});
test("numeric firmware channel counts have readable labels", () => {
  for (const channel_config of ["6", 6])
    assert.equal(streamLabel({ channel_config }), "5.1");
  for (const channel_config of ["8", 8])
    assert.equal(streamLabel({ channel_config }), "7.1");
  for (const channel_config of ["2", 2])
    assert.equal(streamLabel({ channel_config }), "Stereo");
  for (const zero of ["0", 0])
    assert.equal(
      streamLabel({
        channel_config: zero,
        decoder_stream_src_format: zero,
        decoder_stream_type: zero,
        sample_rate: zero,
        dec_sample_rate: zero,
      }),
      "No signal",
    );
  assert.equal(
    streamLabel({ channel_config: "0", sample_rate: 48000 }),
    "Unknown format",
  );
  assert.equal(
    streamLabel({ channel_config: 0, dec_sample_rate: 48000 }),
    "Unknown format",
  );
  assert.equal(
    streamLabel({
      channel_config: "0",
      decoder_stream_type: "DOLBY_DDP",
      sample_rate: 48000,
    }),
    "Dolby Digital Plus",
  );
});

test("DVD Dolby Digital includes available channel metadata", () => {
  for (const [channel_config, label] of [
    ["0", "Dolby Digital"],
    ["2", "Dolby Digital · Stereo"],
    ["6", "Dolby Digital · 5.1"],
    ["3.0", "Dolby Digital · 3.0"],
  ])
    assert.equal(
      streamLabel({
        decoder_stream_type: "DOLBY_DD",
        decoder_stream_proc_type: "Dolby Surround",
        channel_config,
      }),
      label,
    );
  for (const channel_config of ["", "0", undefined])
    assert.equal(
      streamLabel({
        decoder_stream_type: "DOLBY_DD",
        decoder_stream_src_format: "Dolby TrueHD / MLP",
        channel_config,
        speakers_stream_map: "7",
      }),
      "Dolby Digital · 3.0",
    );
  for (const speakers_stream_map of ["0", "", "invalid", "-1"])
    assert.equal(
      streamLabel({ decoder_stream_type: "DOLBY_DD", speakers_stream_map }),
      "Dolby Digital",
    );
  assert.equal(
    streamLabel({
      decoder_stream_type: "DOLBY_DD",
      channel_config: "2",
      speakers_stream_map: "7",
    }),
    "Dolby Digital · Stereo",
  );
});

test("captured TrueHD, DTS and PCM metadata have clear labels", () => {
  assert.equal(
    streamLabel({
      decoder_stream_type: "DOLBY_DTHD",
      decoder_stream_proc_type: "Dolby Atmos",
      channel_config: "0",
    }),
    "Dolby Atmos",
  );
  assert.equal(
    streamLabel({
      decoder_stream_type: "DOLBY_DTHD",
      decoder_stream_proc_type: "Dolby Surround",
    }),
    "Dolby TrueHD",
  );
  assert.equal(
    streamLabel({
      decoder_stream_type: "DTSX_DTS_MA",
      decoder_stream_src_format: "Dolby TrueHD / MLP",
    }),
    "DTS-HD MA",
  );
  assert.equal(
    streamLabel({ decoder_stream_type: "DOLBY_PCM", channel_config: "8" }),
    "7.1",
  );
  assert.equal(
    streamLabel({ decoder_stream_type: "DOLBY_PCM", channel_config: "0" }),
    "PCM",
  );
});

test("all recognized codecs share numeric layouts and mono/stereo labels", () => {
  for (const [type, codec] of [
    ["DTSX_DTS_MA", "DTS-HD MA"],
    ["DOLBY_DTHD", "Dolby TrueHD"],
    ["DOLBY_DDP", "Dolby Digital Plus"],
    ["DOLBY_DD", "Dolby Digital"],
  ]) {
    for (const [channel_config, label] of [
      [1, "Mono"],
      [2, "Stereo"],
      [3, "3.0"],
      [6, "5.1"],
      [8, "7.1"],
    ])
      assert.equal(
        streamLabel({ decoder_stream_type: type, channel_config }),
        `${codec} · ${label}`,
      );
    assert.equal(
      streamLabel({ decoder_stream_type: type, speakers_stream_map: "7" }),
      `${codec} · 3.0`,
    );
  }
  assert.equal(
    streamLabel({ decoder_stream_src_format: "DTS:X", channel_config: "7.1" }),
    "DTS:X · 7.1",
  );
});

test("DTS-HD MA recognizes the captured 6.1 bitstream layout", () => {
  const stream = {
    decoder_stream_type: "DTSX_DTS_MA",
    decoder_stream_src_format: "Dolby TrueHD / MLP",
    channel_config: "",
    speakers_stream_map: "201326863",
    is_bitstream: true,
    packet_type: "HBR",
  };
  assert.equal(streamLabel(stream), "DTS-HD MA · 6.1");
  assert.equal(
    streamLabel({ ...stream, channel_config: "8" }),
    "DTS-HD MA · 7.1",
  );
});
