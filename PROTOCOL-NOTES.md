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

Desired quick actions: optical + Native; HDMI + Dolby. With direct upmixer
control these can issue source and upmixer commands without recalling a
whole scene or its saved volume. Exact optical/HDMI input IDs remain to be
chosen.

## Input stream format

`get_stream_properties` was verified as a read-only request. It returns
`decoder_type`, `decoder_stream_type`, `decoder_stream_proc_type`,
`decoder_stream_src_format`, `channel_config`, `sample_rate`, and other fields.
On the 2026-10-03 follow-up read, the string fields were empty; no active
format mapping could be verified. This firmware also returned
`is_lpcm_upmixed`, `is_bitstream`, and `ca_byte`.

Use source format/channel configuration for the meter caption (Stereo,
5.1, 7.1, Dolby Atmos, DTS:X) after validating real sample payloads. Do not
infer incoming Atmos/DTS:X from the selected upmixer or output speaker layout.
Show No signal or Unknown when stream metadata is absent. The UI prototype
uses a simulated Stereo caption with additional format previews.

macOS packet capture requires administrator permissions. It was unnecessary:
only the application's string-decoding helpers were evaluated to inspect
the protocol; the full application modules were not executed.
