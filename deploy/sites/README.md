# Other sites on this host

The production Caddy (`docker-compose.prod.yml`) owns ports 80 and 443, so any
other application deployed on the same host is served through it. Each such
application puts one Caddy site file here, `<name>.caddy`, and the Caddyfile
imports them all with `import sites/*.caddy`.

The files are host-specific and belong to those applications, so they are
ignored by git. With none present, Caddy imports nothing.

A site reaches its application by the container's name on the
`ppe-next2-prod_default` network, which the application's own compose file
joins as an external network. After adding or changing a file, reload Caddy:

    docker compose -f docker-compose.prod.yml --env-file .env.prod exec caddy \
        caddy reload --config /etc/caddy/Caddyfile

Current users: data-sync-ui (`sync.caddy`), see its `deploy/` directory, and PPE
Crew (`crew.caddy`). `legacy.caddy`, which redirected the old
`admin.`/`sync.<ip>.sslip.io` addresses to the gavort.nl hosts, was retired on
2026-11-22 (a copy is in `/root` on the droplet): confirmation links sent before
29 September 2026 no longer open.
