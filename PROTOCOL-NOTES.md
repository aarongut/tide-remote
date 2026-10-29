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

## Captured format mapping (2026-10-29)

Read from the running bridge at `10.0.0.54:3000/diagnostics`:
19 distinct raw records, 2,707 polls, first observed October 21–28.
The raw capture is retained locally and excluded from version control.
Counts measure polls while clients are visible, not playback duration.

| Reported fields                            | Display label | Interpretation                                                                     |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------- |
| `DOLBY_PCM` or `UNKNOWN`, channel count 2  | Stereo        | PCM stereo; Dolby Surround processing does not imply incoming Atmos                |
| `DOLBY_PCM`, channel count 8               | 7.1           | Conventional eight-channel layout assumed with user approval                       |
| `DOLBY_PCM`, channel count 0               | PCM           | Layout unavailable                                                                 |
| `DOLBY_DTHD` + processing `Dolby Atmos`    | Dolby Atmos   | Observed with TrueHD / MLP and HBR bitstream, also during zero-channel transitions |
| `DOLBY_DTHD` + processing `Dolby Surround` | Dolby TrueHD  | No incoming Atmos evidence                                                         |
| `DTSX_DTS_MA`                              | DTS-HD MA     | User confirmed standard DTS-HD MA playback; the enum alone does not imply DTS:X    |

All captured records report 48 kHz. HDMI1 has stereo PCM, eight-channel
PCM, TrueHD (with and without Atmos), and the DTS MA/X family. Toslink1
has stereo PCM observations. Device names and playback titles were not
captured, so these records cannot identify the originating app or movie.

The DTS bitstream record retains `decoder_stream_src_format: "Dolby TrueHD / MLP"`
while reporting a DTS decoder and `DTSX_DTS_MA`. Treat that source text as
stale when the recognized stream type contradicts it. Several transition
records likewise retain codec metadata with channel count zero and
`is_bitstream: false`; neither field alone establishes no signal.

Historical observations were keyed only by raw stream properties and retain
the first input seen. Identical data on another input increments that same
record, so historical per-input counts and last-seen attribution are unreliable.
New observations include the input in the key. The live cache holds at most
100 records and resets on restart; stdout logs only the first occurrence.

Numeric channel counts 6 and 8 display as 5.1 and 7.1 respectively, per the user’s preferred conventional-layout assumption. Other counts remain explicit channel counts.

### Transition diagnostics

New format observations include input ID/name, selected upmixer and preset.
Deduplication includes input ID and upmixer. Source, stream and upmixer change
notifications start a bounded sequence of read-only stream requests at 0, 1,
3 and 5 seconds. `stream_format_sample` events include the raw response,
rendered label, sequence ID, trigger, requested offset and actual elapsed time.
The existing queue pauses reads during switching; elapsed time may exceed the
requested offset. A new transition, disconnect or shutdown cancels the previous
sequence and suppresses its pending results. Samples are retained in the bounded
200-event diagnostics history and emitted to stdout, including repeated formats.
These captures do not require a visible client. Firmware version is not included:
a supported read-only version endpoint has not yet been verified.
