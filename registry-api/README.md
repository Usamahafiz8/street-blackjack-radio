# Station Registry API

A small, read-only service that returns **one combined list of stations**:
- **AzuraCast stations:** read from AzuraCast's *public* Now Playing API (`/api/nowplaying`). No API key is used or stored.
- **External stations** (e.g. OnTop FM): listed in `config/stations.config.json`, health-checked server-side every 60 s.

It has no npm dependencies. It needs Node 20+ (runs in `node:22-alpine` in production).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/v1/stations` | All visible stations, sorted |
| GET | `/v1/stations/{id}` | One station |
| GET | `/health` | Service status, AzuraCast reachability, external check results |
| GET | `/art/{file}` | Station artwork from `art/` |

The full API documentation, with example JSON, is written in Stage 4 (`/docs/api.md`).

## Configuration (environment variables)

| Variable | Example | Purpose |
|---|---|---|
| `AZURACAST_INTERNAL_URL` | `http://host.docker.internal:8080` | How the registry reaches AzuraCast on the server |
| `AZURACAST_PUBLIC_URL` | `https://radio.example.com` | Public HTTPS origin; stream and art URLs are rewritten to this |
| `PUBLIC_BASE_URL` | `https://api.radio.example.com` | Public origin of this API (for artwork URLs) |
| `CORS_ORIGINS` | `https://game.example.com,https://*.example.com` | Allowed browser origins (`*` for anything) |
| `POLL_INTERVAL_MS` | `10000` | AzuraCast poll interval |
| `EXTERNAL_CHECK_INTERVAL_MS` | `60000` | External station health-check interval |
| `STATE_DIR` | `/data` | Saves the last AzuraCast snapshot, so stations stay listed after a restart during an outage |
| `ALLOW_INSECURE_STREAMS` | `false` | Dev only. Production rejects `http://` external streams (mixed content) |

## Adding stations

- **AzuraCast station:** create it in AzuraCast with its public page/API enabled. It appears automatically. Optionally add an entry under `azuracast.overrides` (keyed by the AzuraCast short name) to set the display name, genre, order and artwork.
- **External station:** add an object to `external` in `config/stations.config.json`. Set `"enabled": false` to hide it. The file is re-read automatically, with no restart needed.

## Development

```bash
npm test
AZURACAST_PUBLIC_URL=https://radio.example.com CORS_ORIGINS=* npm start
```
