# Widgets Floodlight Hub (Backend MVP)

Local-first backend for Raspberry Pi deployment. It receives UniFi Protect webhooks, evaluates hub-managed policy, controls Shelly 1 Mini Gen4 relays via local RPC, and maintains active timers in SQLite.

Webhook ingestion remains the current production path. A backend-only UniFi Protect API/WebSocket ingest POC is also available for diagnostics, but it does not route events into floodlight actions yet.

## Stack
- Node.js + TypeScript
- Fastify
- SQLite (better-sqlite3)
- Drizzle ORM


## Install / upgrade order (required)
Run these commands in this exact order for both new installs and upgrades:

1. `npm install`
2. `npm run db:migrate`
3. `npm run db:verify`
4. `npm run build`
5. `npm start`

`npm run db:verify` fails loudly if required columns are missing (especially in `floodlights`) so startup cannot continue on a partially migrated database.

## Quick start (local dev)
1. Copy env:
   ```bash
   cp .env.example .env
   ```
2. Install deps:
   ```bash
   npm install
   ```
3. Run migration + verify + seed:
   ```bash
   npm run db:migrate
   npm run db:verify
   npm run db:seed
   ```
4. Start dev server:
   ```bash
   npm run dev
   ```

Server defaults to `http://0.0.0.0:8787`.

## API overview
- Floodlights: `/api/floodlights` + `/:id/on|off|test|standardize|status`
- Groups: `/api/groups` + `/:id/trigger-test`
- Webhooks: `GET|POST /api/webhooks/unifi/:webhookKey`
- Settings: `GET|PATCH /api/settings`
- Diagnostics: `/api/events`, `/api/commands`, `/api/timers`, `/api/health`

## Environment variables
- `PORT`: API port
- `HOST`: bind host
- `DB_PATH`: SQLite DB file path
- `APP_ENCRYPTION_KEY`: used for encrypted Shelly passwords/shared webhook secret
- `TIMER_POLL_SECONDS`: timer loop poll interval
- `REQUEST_TIMEOUT_MS`: Shelly RPC timeout
- UniFi Protect API settings are configured in the Settings page and persisted in SQLite.
- `FLOODLIGHT_HUB_CONFIG_PATH`: optional override for provisioning config path. Default: `/usr/local/widgets-data/floodlighthub.json`

## Cloud provisioning config
Cloud bootstrap and heartbeat are configured with a JSON file, not SQLite. Default path:

```text
/usr/local/widgets-data/floodlighthub.json
```

Template:

```json
{
  "device": {
    "serialNumber": "",
    "deviceSecret": "",
    "model": "widgets-floodlight-hub"
  },
  "cloud": {
    "enabled": true,
    "apiBaseUrl": "https://api.widgetsinc.io",
    "heartbeatIntervalSeconds": 60
  }
}
```

Notes:
- If the file is missing or device identity is blank, the app logs the condition and continues normal local startup.
- Cloud failures do not block local floodlight, group, timer, or webhook behavior.
- A template is included at `config/floodlighthub.template.json`.
- A lightweight provisioning helper is included at `scripts/provision-floodlighthub-config.sh`.

## Raspberry Pi deployment notes
- Use a dedicated user account and static local IP.
- Keep Shelly devices on LAN-only access.
- Store `.env` with `chmod 600`.
- Run behind local firewall rules allowing trusted LAN clients only.

### Example systemd unit
Create `/etc/systemd/system/widgets-floodlight-hub.service`:

```ini
[Unit]
Description=Widgets Floodlight Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/widgets-floodlight-hub
EnvironmentFile=/home/pi/widgets-floodlight-hub/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable/start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable widgets-floodlight-hub
sudo systemctl start widgets-floodlight-hub
```

## MVP behavior highlights
- Webhook-in only (no UniFi API integration).
- Group webhook key + shared-secret auth.
- Hub-side schedule, debounce, cooldown policy checks.
- Group retriggers refresh full auto-off timer duration.
- Timer expiry turns off group members, except floodlights in `force_on` override.
- Shelly standardization disables `auto_off` and `auto_on` for relay id `0`.

## UniFi Protect API ingest POC
- Connects to `/proxy/protect/integration/v1/subscribe/events` with `X-API-KEY`.
- Disabled by default and kept separate from the working webhook path.
- Logs raw websocket payloads and emits diagnostics-only normalized events.
- Reconnects with basic exponential backoff after disconnects.

Confirmed findings from live payload observation:
- API websocket ingest is viable and returns real-time event messages.
- `item.device` maps to the Protect camera/device id.
- Observed event classes include zone, line, motion, and audio via `item.type`.
- Object and audio classifications are available via `item.smartDetectTypes`.
- Event lifecycle is visible through websocket envelope `type` values such as `add` and `update`, plus optional `item.end`.
- Named smart-zone identity was not observed in payloads.
- Named line identity and line direction were not observed in payloads.
- Webhooks remain necessary for zone-specific or line-specific routing needs.

Manual validation:
1. Configure UniFi Protect API integration in the Settings page.
2. Start the backend with `npm run dev` or rebuild with `npm run build && npm start`.
3. Trigger Protect events and watch backend logs for:
   `Protect API websocket connected.`
   `Protect API raw event received.`
   `Protect API normalized event emitted.`
4. Confirm existing webhook-triggered floodlight behavior still works through `GET|POST /api/webhooks/unifi/:webhookKey`.

## Route evaluation foundation
- Normalized ingress events from Protect API, Protect webhooks, and Access polling are published through the shared dispatcher.
- A diagnostics-only route evaluator subscriber loads `event_routes`, evaluates the current source/class/type/object filters, and logs one route evaluation summary per normalized event.
- The evaluator does not execute routes, trigger floodlights, call Shelly devices, emit downstream integrations, deduplicate events, correlate events, or enforce schedules/policy.
- Access events are handled safely, but the current `event_routes` schema is source-based. Future Access routing will likely need additional match dimensions such as `doorId`, `userId`, `credentialProvider`, and `result`; this phase intentionally does not redesign the schema.
