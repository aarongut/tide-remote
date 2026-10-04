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
test("numeric firmware channel counts have readable labels", () => {
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
    "No signal",
  );
});
