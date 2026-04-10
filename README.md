# Widgets Floodlight Hub (Backend MVP)

Local-first backend for Raspberry Pi deployment. It receives UniFi Protect webhooks, evaluates hub-managed policy, controls Shelly 1 Mini Gen4 relays via local RPC, and maintains active timers in SQLite.

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
