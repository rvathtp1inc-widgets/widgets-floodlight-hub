# Phase 1 API inventory

The frontend uses these existing backend contracts:

- `GET /api/health` → `{ app, db, timerService, cloud, counts: { floodlights, groups } }`
- `GET /api/events`, `GET /api/commands`, `GET /api/timers` → diagnostic arrays
- `GET /api/cloud/status` → cloud enablement, identity, bootstrap, heartbeat, and runtime identity
- `GET /api/protect/sources` → Protect source rows with parsed `supportedObjectTypes` and `enabledObjectTypes`
- `POST /api/protect/sources/sync` → Protect inventory sync summary
- `GET /api/access/doors`, `GET /api/access/poll/status` → Access inventory and polling status
- `GET|POST /api/semantic-conditions`, `PATCH|DELETE /api/semantic-conditions/:id` → Condition CRUD
- `GET|POST /api/consumer-bindings`, `PATCH|DELETE /api/consumer-bindings/:id` → Virtual Security Panel Output CRUD; public rows include canonical `binding: { panelKey, zoneNumber }`
- `GET|POST /api/routes`, `PATCH|DELETE /api/routes/:id` → Automation CRUD for Protect sources and floodlight, group, or semantic-condition targets
- `GET|POST|PATCH|DELETE /api/floodlights` and device action endpoints → existing Floodlight workflows
- `GET|POST|PATCH|DELETE /api/groups` and group test endpoint → existing Group workflows
- `GET|PATCH /api/settings` → location, astronomical, webhook, Protect, session, and retention settings

Not currently exposed: production Virtual Security Panel listener/client/runtime status, runtime Condition state, semantic webhook management, Hub uptime/version, Protect WebSocket status, and semantic/VSP execution-result history. Phase 1 shows these as unavailable and does not fabricate them.
