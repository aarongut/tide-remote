# Tide 16 remote

A single-screen iPhone PWA for the miniDSP Tide16. The Node bridge runs on
your LAN and connects to the processor on port 5555. The phone connects to
the bridge, so the laptop's Device Console does not need to stay open.

## Run locally

Requires Node 22 or newer.

```sh
npm ci
npm run build
HOST=0.0.0.0 TIDE_HOST=10.0.0.130 npm start
```

Open `http://<server-ip>:3000` on your phone while on the same network.
Safari → Share → Add to Home Screen → Open as Web App. HTTP works for local
testing and a home-screen shortcut; HTTPS enables the service worker and
offline app shell. Offline controls remain disabled.

For an env file, copy `.env.example` to `.env` and start with:

```sh
node --env-file=.env server/index.mjs
```

The default listening address is `127.0.0.1`; set `HOST=0.0.0.0` for LAN
access. The default processor address is `10.0.0.130`.

## Docker

Copy `.env.example` to `.env`. For the bastion proxy setup, set `BIND_IP`
to the **Docker host's LAN IP** and `APP_ORIGIN` to the exact HTTPS origin
you will use on the phone. The example is now configured for
`BIND_IP=10.0.0.54` and
`APP_ORIGIN=https://tide-control.local.frat.tech`. Without an env file,
Compose defaults to loopback, which a separate bastion cannot reach.

```sh
docker compose up -d --build
```

The container must be able to reach your Tide16's LAN IP. Set `TIDE_HOST`
in `.env` if its address changes. Docker Desktop on macOS usually routes
outbound LAN traffic; Linux Docker networks must also have that route.

## HTTPS through the bastion's nginx

Topology: iPhone → bastion nginx (HTTPS) → Docker host (HTTP port 3000)
→ Tide16 (WebSocket port 5555). TLS and certificate renewal remain on the
bastion. The app and bridge run together in a separate Compose project on
the Frigate Docker host.

Configured addresses:

- App: `https://tide-control.local.frat.tech`
- Bastion nginx: `10.0.0.5:443`
- Docker upstream: `http://10.0.0.54:3000`
- Processor: `ws://10.0.0.130:5555`
- Pi-hole local DNS record: `tide-control.local.frat.tech` → `10.0.0.5`

Use `deploy/nginx.conf.example` as the pre-TLS virtual host. Its hostname,
LAN listener, and upstream are filled in. Add your shared local-only nginx
snippet at server scope **before enabling it**; access restrictions are
owned by that snippet rather than duplicated in this app's config.
Let Certbot manage certificate paths and HTTPS through your existing
issuance workflow. Retain the local-only snippet and LAN listener binding
in the HTTPS server block Certbot configures. The app's final origin stays
`https://tide-control.local.frat.tech`.

Ensure any existing public/default nginx virtual host does not also route
requests for this app to its upstream. If a trusted proxy sits in front
of nginx, use your snippet's established real-client-IP handling.

In Pi-hole's local DNS, point the chosen hostname to the **bastion's LAN
address**, not the Docker host. Use a hostname covered by a certificate
your iPhone trusts. This DNS entry does not itself enforce private access;
the nginx listener, shared local-only snippet, and network rules do that.

Permit the bastion to reach the Docker host's selected published port;
prefer restricting that port to the bastion at your network firewall.
Docker-published ports can bypass ordinary host firewall rules, so use
Docker-aware rules if enforcing this on the host. Permit the container
to reach `10.0.0.130:5555`. No router port forwarding for the app or Tide16
is required.

Validate and reload nginx through your normal deployment process:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Optional Basic authentication: set **both** `REMOTE_USER` and
`REMOTE_PASSWORD`. Use it behind HTTPS. If your proxy rewrites Host, set
`APP_ORIGIN` to the exact public origin, for example
`https://tide.your-domain.example`. The bridge checks browser Origin on
WebSocket upgrades and exposes only the six supported control commands.

## Behavior

- Reads real input names and honors hidden inputs (the active input stays visible).
- Recalls processor presets, which also select their corresponding Dirac
  filters and DSP configuration. The selector uses actual processor preset
  names; unnamed presets show their slot number.
- Changes Native / Dolby / DTS upmix directly, without recalling scenes.
- Dirac on/off changes only `enabled`, preserving gain/delay flags.
- Displays only assigned outputs; your current configuration has 13.
- Polls output RMS levels at 10 Hz only while at least one remote is visible.
- Shows incoming stream format separately from the selected upmixer. Format
  parsing handles named codecs and dotted channel layouts; unrecognized
  firmware values stay visible. Empty stream metadata displays “No signal.”
  Confirm Atmos/DTS:X naming with real playback on your firmware.
- Meter range spans 60 dB below current master volume. Color indicates
  position in that display window, not a calibrated clipping detector.
- Slider sends on release; volume buttons change by 0.5 dB. Commands are
  serialized and are never replayed after a disconnect.
- A mode change can briefly mute the Tide16. The UI waits while the
  processor reports it is switching.
- Supports system light/dark appearance, safe areas, offline shell, and
  locally bundled Lucide icons. No CDN or cloud service is required.

## Verification

```sh
npm test
npm run build
```

Tests cover control validation, assigned outputs, stream format semantics,
the bridge against a simulated Tide16, disconnects, and UI interactions.
Original design explorations remain in `design/`; protocol observations
are in `PROTOCOL-NOTES.md`.
