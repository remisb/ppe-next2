# Monitoring

How the deployment tells whether the app is up, and who finds out when it is not. This is
phases 0 and 3 of [admin/audit-analytics-monitoring.md](admin/audit-analytics-monitoring.md)
(sections 5.1 and 5.2). Inside the app, Administration's **Overview** says what needs
attention and **System** shows the API, the database, the error list and the backups
([specs/system-service.md](specs/system-service.md)); backups are described in
[backups.md](backups.md).

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
| Request references | Every request has an `X-Request-ID`; every log line written for it carries it as `request_id`, and a 500 answers with it as `reference`, which the apps show as its first 8 characters. |
| Error list | 5xx answers, recovered panics and errors the apps report from the browser, folded by kind, kept 30 days: Administration → System → Errors. |
| Metrics | Prometheus `/metrics` on `API_METRICS_ADDR` (`:9090` in production, compose network only): requests and latency by route, sign-in failures, errors, the database pool, Go runtime. |

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

### DigitalOcean Monitoring is now Insights

DigitalOcean is moving its Monitoring into **Insights**:
- Insights covers metrics, alerts, uptime checks, logs and dashboards, under **Data & Learning
  → Insights** in the control panel.
- It has been in public preview since 1 Oct 2026, at no cost during the preview.
- Resource alerts and uptime checks made under Monitoring move across by themselves; nothing
  needs to be redone.

The steps below use Insights, with the older Monitoring labels where they differ. DigitalOcean
says not to rely on Insights' newer parts (logs, traces, dashboards) as production's main
monitoring during the preview. The alerts and uptime checks below are the ones carried over
from Monitoring, and the Overview and this file stay the primary view.

Sources:
- [Insights](https://docs.digitalocean.com/products/insights/)
- [Manage Metric Alerts](https://docs.digitalocean.com/products/insights/how-to/manage-metrics-alerts/)
- [Uptime quickstart](https://docs.digitalocean.com/products/uptime/getting-started/quickstart/)
- [Monitoring quickstart](https://docs.digitalocean.com/products/monitoring/getting-started/quickstart/)

### Uptime check of `/ready`

The simplest is DigitalOcean's own **Uptime**, now under Insights.
- It needs no new account.
- It checks from regions you choose, independently of the droplet.
- One check is free; more cost $1 a month each.

1. **Insights → Uptime → Create a new Uptime Check:**

   | Field | Value |
   | --- | --- |
   | Type | HTTPS |
   | URL | `https://workwear.gavort.nl/ready` |
   | Regions | the Europe region, and one more for a second opinion |
   | Name | `workwear ready` |

2. On the check's page, **Create Uptime Alert** twice, each to the administrators' email:
   - **Downtime**, with the shortest period offered.
   - **SSL Cert Expire**, at 14 days. Caddy renews certificates by itself; this catches a
     renewal that keeps failing.

   A **Latency** alert is optional. Set it to about 2000 ms if you want one.

DigitalOcean's check looks only at whether the URL answers successfully, not at the body.
That is enough here, because `/ready` answers **503** when the database or migrations are
not in order (`{"status":"not ready",…}`), and a 503 counts as down. During a planned
`make prod-down`, accept one alert.

**Alternative:** an external EU service such as Better Stack Uptime or UptimeRobot. It is
independent of DigitalOcean, and can also require the body to contain `"status":"ready"`.
- Do not match on the word `ready` alone, because `not ready` contains it.
- Alert after 2 failed checks, to ride out a deploy's restart.
- Use the same URL, the certificate warning, and email.

What any monitor sees is the public URL and the commit. It sends nothing else.

### Droplet metrics and alerts

The droplet's CPU, memory and disk are outside what the API can see. DigitalOcean measures
CPU from the outside. **Memory and disk need its metrics agent `do-agent` on the droplet.**
Without the agent, those alerts never fire.

1. **Install the agent.** For a new droplet, choose **Install the Observability agent** when
   creating it. On this existing one, run DigitalOcean's install script, from your own
   computer:

   ```bash
   ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes root@167.71.68.195 'curl -sSL https://repos.insights.digitalocean.com/install.sh | bash && systemctl is-active do-agent'
   ```

   - It ends with `active`.
   - The droplet's **Insights** tab shows memory and disk graphs within a few minutes.
   - To check it later: `systemctl is-active do-agent` on the droplet.

2. **Add three alert rules.** Use **Insights → Alerts → Alert Rules → Create rule**:
   - Resource type: Droplets.
   - Resource: this droplet.
   - Evaluation window: 5 minutes.
   - Re-notify while unresolved: every 4 hours.
   - Notification channel: the administrators' email, which you create there once.

   Under the older Monitoring, the same three are **Create Resource Alert**, using the labels
   in the right-hand column. Both kinds end up in Insights.

   | Rule | Metric (Insights) | Condition | Under Monitoring |
   | --- | --- | --- | --- |
   | CPU | `do.droplets.cpu.utilization` | `>` 80 | CPU Utilization Percent, is above 80 %, 5 min |
   | Memory | the droplet's memory utilization | `>` 85 (the droplet has 2 GB) | Memory Utilization Percent, is above 85 %, 5 min |
   | Disk | the droplet's disk utilization | `>` 80 | Disk Utilization Percent, is above 80 %, 5 min |

   DigitalOcean's docs name only the CPU metric. Pick memory and disk from the **Metric** list
   by their names. Those two appear only once the agent reports.

3. Check the result:
   - The rules are listed under **Alerts**, and the uptime check is green.
   - Insights keeps alert history for 30 days. During the preview it shows one region at a
     time, so choose **ams3**.

## When an alert fires

| Symptom | First look |
| --- | --- |
| `/ready` is 503 `database` | `make prod-ps` (is `db` healthy?), `make prod-logs`; the API reconnects by itself once Postgres is back |
| `/ready` is 503 `migrations` | a deploy skipped `migrate`: `make prod-up` runs it; `docker compose … logs migrate` shows why it failed |
| No answer at all | is the droplet up (DigitalOcean console)? `make prod-ps`: is `caddy` or `api` restarting? |
| Disk above 80 % | `df -h`, `docker system df`; old images (`docker image prune`), the `backups` volume ([backups.md](backups.md)) |
| Memory above 85 % | `docker stats --no-stream`; which container grew |
| `security events purge failed` in the API's log | the hourly purge of sign-in records older than `API_AUTH_EVENTS_RETENTION` ([security-service.md](specs/security-service.md)) could not run; the error says why. It tries again within the hour. |
| Someone reports being signed out, or many failed sign-ins | Administration → Security: Sign-ins shows each attempt with its address, and a copied sign-in with what to do |
| Someone quotes a reference ("Reference: 9f2c1a7e") | `make prod-logs \| grep 9f2c1a7e` gives the request's lines; System → Errors has the error with its stack |
| The Overview says requests are failing, or there are new errors | System → Errors: the latest message, route, count and stack of each; the reference finds its log lines |
| Requests feel slow | System → Status: the slowest routes, the pool's waits and the oldest open transaction; `/metrics` for the full histogram |
| `error list purge failed` or `database size sample failed` in the log | the hourly upkeep; the error says why, and it tries again within the hour |
| The Overview says the Audit log does not match its seals (`audit seals do not match` in the log) | someone changed the trail behind the app. Audit log → Seals names the day and the problem. Keep the backups from before that day (they hold the seals and events as they were), and find who had the database owner's password |
| The Overview says the API connects as the database owner | production has not switched to `ppe_app` yet: see below |
| `audit sealing failed` or `audit purge failed` in the log | the upkeep's sealing or purge; it tries again within the hour |
| The Overview says seals are not being timestamped (`audit timestamping failed` in the log) | the timestamp service (`API_AUDIT_TSA_URL`) does not answer. From the droplet, `curl -sI http://timestamp.digicert.com` should answer. The upkeep retries hourly. Put it right within 7 days: a seal stamped later than that shows as a mismatch on the Audit log |

## The API's least-privilege database role

Production connects as `ppe_app` (ADR 0003): a role that cannot change, delete or truncate
the audit trail. To switch it on:

1. Add both lines to `.env.prod` on the droplet, generating the password without showing it:

   ```bash
   printf 'API_DB_USER=ppe_app\nAPI_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> /opt/ppe-next2/.env.prod
   ```

2. Run `make prod-up`. `migrate` gives `ppe_app` the password and its grants, and the API
   connects as it.
3. Check System → Status, under Database: "The API connects as `ppe_app`". The Overview's
   warning goes away.

To go back, remove the two lines and run `make prod-up`.

## Later phases

These come later and are described in [the proposal](admin/audit-analytics-monitoring.md):
- alert delivery by email or Telegram once the outbox and worker exist (until then the
  Overview and the uptime monitor's email are the alerts)
- a monitoring stack that scrapes `/metrics` and keeps history, when a second API instance
  or longer history is needed (section 5.3)
