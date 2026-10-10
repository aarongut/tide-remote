# Tide16 control findings

Verified on the user's Tide16 at `10.0.0.130:5555` on 2026-10-03.

Device Console connects to the same WebSocket port. Its installed
`websocketDevices.js` and `tideMessage.js` modules identify this command:

```json
{ "endpoint": "set_forced_upmixer", "decoder": "dts" }
```

Decoder values in Device Console: `native`, `datmos` (Dolby), `dts`.
Native -> DTS -> Native was tested directly; both writes returned
`{"req":"set_forced_upmixer","status":"OK","data":"OK"}`.
Dolby's `datmos` value was observed in the initial configuration, but a
direct write of Dolby mode has not yet been tested.

State changes broadcast:

```json
{ "notification": "upmixer_change", "value": "dts" }
```

The processor briefly mutes during a change, then restores volume and
broadcasts `coordinator_status: ready`. Wait for completion before another
mode change; do not treat temporary zero-volume notifications as user intent.

`get_decoder` returned OK without data on this unit. Read current mode using
`get_current_preset`: response path `data.data.upmixer`. This response is large.

## Input stream format

On 2026-10-09, active Shield/Tidal Atmos playback returned
`decoder_stream_type: "DOLBY_DDP"` and
`decoder_stream_proc_type: "Dolby Atmos"`, with an empty source format,
`channel_config: "0"`, 48000 Hz, `is_lpcm_upmixed: false`,
`is_bitstream: false`, and `packet_type: "LPCM"`.
The label uses that DDP + Atmos pair before the zero-channel fallback.
The same response was observed after the user paused and rewound playback.
A zero channel count alone does not establish no signal: codec metadata
still supplies a label, and a positive sample rate yields “Unknown format”
when no codec or layout is available.
Neither DDP/TrueHD alone nor Atmos processing on a PCM source establishes
an incoming Atmos label.

`get_stream_properties` was verified as a read-only request. It returns
`decoder_type`, `decoder_stream_type`, `decoder_stream_proc_type`,
`decoder_stream_src_format`, `channel_config`, `sample_rate`, and other fields.
On the 2026-10-03 follow-up read, the string fields were empty; no active
format mapping could be verified. This firmware also returned
`is_lpcm_upmixed`, `is_bitstream`, and `ca_byte`.

macOS packet capture requires administrator permissions. It was unnecessary:
only the application's string-decoding helpers were evaluated to inspect
the protocol; the full application modules were not executed.
