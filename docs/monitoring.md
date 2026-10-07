# Monitoring

How the deployment tells whether the app is up, and who finds out when it is not. This is
phase 0 of [admin/audit-analytics-monitoring.md](admin/audit-analytics-monitoring.md)
(section 5.1). Backups are watched separately, on the Backups screen
([backups.md](backups.md)).

## What the app provides

| Piece | What it does |
| --- | --- |
| `GET /health` | Liveness: 200 `{"status":"ok"}` while the API process answers. It does not touch the database. |
| `GET /ready` | Readiness: 200 `{"status":"ready","commit":"…"}` when the database answers and has applied every migration this build embeds (`internal/db`). Otherwise 503 `{"status":"not ready","problem":"database"\|"migrations"}`. The detail, such as which migration is missing or the driver's error, is logged as `not ready` and never returned, because the route is public. A database newer than the build is still ready. |
| `/api -healthcheck` | The binary asks itself for `/ready` on `API_ADDR`, prints the answer, and exits 0 only on 200. The image is `scratch`, so there is no curl. |
| Image `HEALTHCHECK` | Runs `/api -healthcheck` every 30 s, after a 1 min start period, failing after 3 misses. `make prod-ps` shows `healthy` or `unhealthy`. **Docker does not restart an unhealthy container** (`restart: unless-stopped` acts only when the process exits). The status is for people and for `make prod-up`. |
| Commit | `make prod-build` passes `git describe --always --dirty` as `API_COMMIT`, and the Dockerfile stamps it with `-ldflags -X main.commit`. `/ready` and the `listening` log line name it. A local `go build` falls back to Go's VCS stamp. |
| Log rotation | Every service in `docker-compose.prod.yml` keeps at most 5 × 10 MB of output (`x-logging`). Without this, Docker's `json-file` logs grow until the disk is full. |
| Caddy | Proxies `/health` and `/ready` to the API, so both are reachable at the site's address. |

On the droplet:

```bash
make prod-ready      # the API's /ready answer and commit
make prod-ps         # health of every service
make prod-logs       # follow the kept logs
```

`make prod-up` now ends only when `/ready` answers 200 within 60 s. Otherwise it fails and
prints the API's last 30 log lines, so a deploy against an unmigrated or unreachable
database is noticed at once.

The first `make prod-up` after this change also recreates `db` and `migrate`, because their
logging settings changed. That is a few seconds of database restart in the same window as
the API restart.

## Set up once: outside the droplet

A monitor on the droplet cannot report that the droplet is down, so these two run
elsewhere. Both are account settings that a person makes. The app needs nothing more.

### Uptime check of `/ready`

Use an EU-hosted uptime service with a free tier and email alerts, such as Better Stack
Uptime or UptimeRobot. Check the provider's current limits.

| Setting | Value |
| --- | --- |
| URL | `https://workwear.gavort.nl/ready` |
| Method / expectation | GET; alert unless the status is **200** and the body contains **`"status":"ready"`**. Do not match on the word `ready` alone, because `not ready` contains it. |
| Interval | the shortest the plan allows (1–5 min) |
| Confirmation | alert after 2 failed checks, to ride out a deploy's restart |
| TLS | enable the certificate expiry warning if the plan has it (14 days). Caddy renews certificates by itself; this catches a renewal that keeps failing. |
| Alert to | the administrators' email |
| Maintenance | pause it, or accept one alert, during a planned `make prod-down` |

What the monitor sees is the public URL and the commit. It sends nothing else.

### DigitalOcean metrics and alerts

The droplet's CPU, memory and disk are outside what the API can see.

1. Install the metrics agent on the droplet, if it was not chosen when the droplet was
   created. DigitalOcean's control panel shows the install command under the droplet's
   **Monitoring** tab (`curl -sSL https://repos.insights.digitalocean.com/install.sh | sudo bash`).
2. In **Monitoring → Create alert policy**, add three policies for the droplet, each
   alerting the administrators' email:

   | Metric | Condition |
   | --- | --- |
   | CPU | above 80 % for 5 min |
   | Memory | above 85 % for 5 min (the droplet has 2 GB) |
   | Disk utilization | above 80 % for 5 min |

## When an alert fires

| Symptom | First look |
| --- | --- |
| `/ready` is 503 `database` | `make prod-ps` (is `db` healthy?), `make prod-logs`; the API reconnects by itself once Postgres is back |
| `/ready` is 503 `migrations` | a deploy skipped `migrate`: `make prod-up` runs it; `docker compose … logs migrate` shows why it failed |
| No answer at all | is the droplet up (DigitalOcean console)? `make prod-ps`: is `caddy` or `api` restarting? |
| Disk above 80 % | `df -h`, `docker system df`; old images (`docker image prune`), the `backups` volume ([backups.md](backups.md)) |
| Memory above 85 % | `docker stats --no-stream`; which container grew |

## Later phases

These come later and are described in [the proposal](admin/audit-analytics-monitoring.md):
- request IDs and error references
- an error list and Prometheus `/metrics` on an internal port
- the System and Overview screens in Administration
- alert delivery by email or Telegram once the outbox and worker exist
