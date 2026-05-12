# beautybay-ota-server

Standalone Expo Updates v1 OTA server for the BeautyBay mobile app.
Runs on a Windows Server via [NSSM](https://nssm.cc/), is fronted by a
Cloudflare Tunnel (HTTPS), and serves JS bundles + assets directly from
the local filesystem (no database).

Reference protocol: <https://docs.expo.dev/technical-specs/expo-updates-1/>
Reference implementation: <https://github.com/expo/custom-expo-updates-server>

---

## Endpoints

| Method | Path             | Auth                | Purpose                                              |
|--------|------------------|---------------------|------------------------------------------------------|
| GET    | `/health`        | —                   | Liveness probe                                       |
| GET    | `/api/manifest`  | —                   | Expo Updates v1 manifest (multipart/mixed)           |
| POST   | `/api/publish`   | `X-OTA-Publish-Key` | CI/CD upload of a new bundle + assets                |
| GET    | `/assets/:hash`  | —                   | Content-addressable asset download                   |

### `GET /api/manifest`

Request headers (sent by the Expo client):

- `expo-channel-name` — `development` | `staging` | `production`
- `expo-runtime-version` — e.g. `19.37.0`
- `expo-platform` — `ios` | `android`
- `expo-protocol-version` — `1`

Response:

- `200 multipart/mixed; boundary=...` with a `manifest` part (JSON) on success.
- `204 No Content` if no update is currently published for that triplet.
- `400` for malformed/missing headers.

Response headers:

- `expo-protocol-version: 1`
- `expo-sfv-version: 0`
- `cache-control: private, max-age=0`

### `POST /api/publish`

Headers:

- `X-OTA-Publish-Key: <secret>` — must match `OTA_PUBLISH_KEY`.

`multipart/form-data` body:

| Field            | Type            | Required | Notes                                |
|------------------|-----------------|----------|--------------------------------------|
| `channel`        | text            | yes      | `development` / `staging` / `production` |
| `runtimeVersion` | text            | yes      | e.g. `19.37.0`                       |
| `platform`       | text            | yes      | `ios` / `android`                    |
| `commit`         | text            | no       | Git SHA                              |
| `message`        | text            | no       | Free-form release note               |
| `bundle`         | file            | yes      | The JS bundle (`main.jsbundle`)      |
| `assets[]`       | files (repeats) | no       | Images, fonts, etc.                  |

Response: `200 { id, url, hash }` where `hash` is the hex SHA-256 of the bundle.

### `GET /assets/:hash`

`:hash` is the hex SHA-256 of the file content. Served with
`cache-control: public, max-age=31536000, immutable`.

---

## On-disk layout

```
C:\OTA\bundles\
  _assets\                                  ← content-addressable store
    <hex-sha256>                            ← raw bytes
    <hex-sha256>.meta.json                  ← { contentType, fileExtension }
  <channel>\
    <runtimeVersion>\
      <platform>\
        latest.json                         ← { "id": "<uuid>" }   ← pointer
        <uuid>\
          update.json                       ← full StoredUpdate record
```

Switching the active update is a single atomic write to `latest.json`. The
previous update directory is left in place — rollbacks are just a matter of
pointing `latest.json` back at an earlier `<uuid>`.

---

## Local development

```bash
# Requires Node.js 20+
cp .env.example .env
# edit .env: set OTA_PUBLISH_KEY, OTA_PUBLIC_BASE_URL
npm install
npm run dev      # tsx watch, listens on $PORT (default 3000)
```

Smoke test:

```bash
curl -i http://localhost:3000/health
```

Run the unit tests (manifest builder):

```bash
npm test
```

---

## Publishing an update (CI/CD)

Example with curl:

```bash
curl -X POST "$OTA_BASE_URL/api/publish" \
  -H "X-OTA-Publish-Key: $OTA_PUBLISH_KEY" \
  -F "channel=staging" \
  -F "runtimeVersion=19.37.0" \
  -F "platform=ios" \
  -F "commit=$(git rev-parse HEAD)" \
  -F "message=fix: clipping bug" \
  -F "bundle=@./dist/main.jsbundle;type=application/javascript" \
  -F "assets[]=@./dist/assets/logo.png;type=image/png" \
  -F "assets[]=@./dist/assets/Inter.ttf;type=font/ttf"
```

Response:

```json
{ "id": "<uuid>", "url": "https://ota.example.com/assets/<hex>", "hash": "<hex>" }
```

---

## Rollback

Updates are immutable on disk; rolling back is a pointer flip.

```powershell
# Pick the previous update id (any subdir under <channel>\<runtimeVersion>\<platform>)
cd C:\OTA\bundles\production\19.37.0\ios
ls    # list available update ids, pick the previous one
'{ "id": "<previous-uuid>" }' | Set-Content -Encoding UTF8 .\latest.json
```

The next `/api/manifest` request will serve the rolled-back update. No
service restart needed — `latest.json` is read on every request.

If you keep CI history, you can also script this with a curl call against a
future `/api/rollback` endpoint (out of scope for this phase).

---

## Windows Server install (NSSM)

Prereqs: Node.js 20+ installed, [NSSM](https://nssm.cc/download) on `PATH`,
the repository cloned somewhere readable by `LocalSystem` (e.g.
`C:\Apps\beautybay-ota-server`).

```powershell
# From an elevated PowerShell prompt
cd C:\Apps\beautybay-ota-server
Copy-Item .env.example .env
notepad .env     # set OTA_PUBLISH_KEY and OTA_PUBLIC_BASE_URL
.\scripts\install-service.ps1
```

The script will:

1. `npm ci` (or `npm install`) and `npm run build`.
2. Register a Windows service named `BeautyBayOTA` that runs
   `node dist\index.js` from the install dir.
3. Set it to start automatically at boot.
4. Configure stdout/stderr rotation under `C:\OTA\logs\`.
5. Start the service.

Management:

```powershell
nssm restart BeautyBayOTA
nssm stop    BeautyBayOTA
nssm remove  BeautyBayOTA confirm
Get-Content -Wait C:\OTA\logs\service-stdout.log
```

Application logs (structured JSON via Pino) are written to
`C:\OTA\logs\ota-YYYY-MM-DD.log` and rolled daily.

---

## Cloudflare Tunnel

The service listens on plain HTTP on `127.0.0.1:$PORT`. The recommended
deployment fronts it with `cloudflared` (installed as a separate Windows
service) so that:

- TLS termination happens at the Cloudflare edge.
- The Windows Server has no inbound public ports open.
- The hostname (e.g. `ota.beautybay.example.com`) is what the mobile app's
  `expo.updates.url` points at, and what `OTA_PUBLIC_BASE_URL` must match.

Set `OTA_CORS_ORIGINS` to the tunnel hostname(s) you want to allow.

---

## Configuration (`.env`)

See [`.env.example`](.env.example). Required:

- `OTA_PUBLISH_KEY` — 32+ random chars. Generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  or `openssl rand -hex 32`.
- `OTA_PUBLIC_BASE_URL` — public HTTPS URL (must match what the mobile
  client uses to fetch manifests). The manifest's `launchAsset.url` and
  each `assets[].url` are built from this.

---

## Out of scope (intentionally)

- UI / dashboard (Phase 3).
- Cryptographic signing of bundles (Expo Updates code signing).
- A/B testing or partial rollouts.
- Persistent database — the filesystem is the source of truth.
