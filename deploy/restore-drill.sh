#!/usr/bin/env bash
# The restore drill (docs/backups.md): restores a stored backup into a
# throwaway Postgres beside the deployment, sets it up as a deploy would, and
# checks that it works, without touching the deployment's database.
#
#   1. a Postgres on a Docker network of its own (the deployment's database is
#      not on it, so nothing here can reach it);
#   2. dbbackup restores the newest backup (or KEY) into it, decrypting with
#      IDENTITY: an age key file, or - to read the key from standard input, so
#      it can come from another computer over ssh and is never stored here;
#   3. migrate.sh, as on every deploy: migrations (none should be pending) and
#      ppe_app's grants, which a restore drops;
#   4. the API's -verify-audit, connected as ppe_app: the Audit log against
#      its seals;
#   5. the API itself, as ppe_app, until GET /ready answers;
#   6. every table's row count beside the deployment's (changes made since the
#      backup explain any difference).
# Everything it started is removed when it ends, whether it passed or not.
#
# Run by `make prod-drill` in the checkout, beside the env file. The bucket's
# keys are read from that file and passed to the restore only.
set -euo pipefail

ENV_FILE=${PROD_ENV_FILE:-.env.prod}
KEY=${KEY:-}
IDENTITY=${IDENTITY:-}
NET=ppe-drill
DB=ppe-drill-db
API=ppe-drill-api

# envval KEY DEFAULT: KEY's value in the env file, without sourcing it (values
# such as an s3:// target hold characters a shell would act on).
envval() {
	local v
	v=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-) || true
	printf '%s' "${v:-$2}"
}

say() { printf 'drill: %s\n' "$*"; }
fail() { printf 'drill: FAILED: %s\n' "$*" >&2; exit 1; }

[ -r "$ENV_FILE" ] || fail "$ENV_FILE not found: run it in the deployment's checkout"
if docker network inspect "$NET" >/dev/null 2>&1 || docker container inspect "$DB" >/dev/null 2>&1; then
	fail "a drill is already running or was left behind: docker rm -f -v $API $DB; docker network rm $NET"
fi

cleanup() {
	docker rm -f -v "$API" "$DB" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	say "removed the drill's database, API and network"
}
trap cleanup EXIT

POSTGRES_IMAGE=$(envval POSTGRES_IMAGE postgres:18-alpine)
IMAGE_TAG=$(envval IMAGE_TAG latest)
DB_PASSWORD=$(openssl rand -hex 16)
APP_PASSWORD=$(openssl rand -hex 16)
PG_ENV=(-e PGHOST="$DB" -e PGUSER=ppe2 -e PGPASSWORD="$DB_PASSWORD" -e PGDATABASE=ppe2 -e PGSSLMODE=disable)
APP_DSN="postgres://ppe_app:$APP_PASSWORD@$DB:5432/ppe2?sslmode=disable"

say "starting a throwaway $POSTGRES_IMAGE on network $NET"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" \
	-e POSTGRES_USER=ppe2 -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB=ppe2 \
	"$POSTGRES_IMAGE" >/dev/null
# pg_isready already answers while the image's init still runs, so wait for a query.
for i in $(seq 1 60); do
	docker exec "$DB" psql -U ppe2 -d ppe2 -Atc 'SELECT 1' >/dev/null 2>&1 && break
	[ "$i" -eq 60 ] && fail "the drill's database did not start"
	sleep 1
done

say "restoring ${KEY:-the newest backup}"
# The bucket's settings reach the container by name (-e NAME), from this
# command's environment only, so the keys are in no command line.
restore=(docker run --rm --network "$NET" "${PG_ENV[@]}" -e DBBACKUP_RECORD=false
	-v ppe-next2-prod_backups:/backups:ro
	-e DBBACKUP_TARGET -e DBBACKUP_S3_ACCESS_KEY -e DBBACKUP_S3_SECRET_KEY)
case "$IDENTITY" in
'') ;;
-) restore+=(-i -e DBBACKUP_AGE_IDENTITY_FILE=/dev/stdin) ;;
*)
	[ -r "$IDENTITY" ] || fail "IDENTITY $IDENTITY is not a readable file"
	restore+=(-v "$(realpath "$IDENTITY")":/run/backup.key:ro -e DBBACKUP_AGE_IDENTITY_FILE=/run/backup.key)
	;;
esac
restore+=("ppe-next2-backup:$IMAGE_TAG" restore --yes)
if [ -n "$KEY" ]; then restore+=("$KEY"); else restore+=(--latest); fi
DBBACKUP_TARGET=$(envval DBBACKUP_TARGET file:///backups) \
	DBBACKUP_S3_ACCESS_KEY=$(envval DBBACKUP_S3_ACCESS_KEY '') \
	DBBACKUP_S3_SECRET_KEY=$(envval DBBACKUP_S3_SECRET_KEY '') \
	"${restore[@]}" || fail "the restore did not complete (an encrypted backup needs IDENTITY)"

say "setting it up as a deploy does (migrate.sh: migrations and ppe_app's grants)"
docker run --rm --network "$NET" "${PG_ENV[@]}" -e API_DB_USER=ppe_app -e API_DB_PASSWORD="$APP_PASSWORD" \
	-v "$PWD/internal/db/migrations:/migrations:ro" -v "$PWD/internal/db/grants.sql:/grants.sql:ro" \
	-v "$PWD/deploy/migrate.sh:/migrate.sh:ro" --entrypoint /bin/sh "$POSTGRES_IMAGE" /migrate.sh </dev/null 2>&1 |
	grep -vE 'migrate: skipping|NOTICE:' || fail "migrate.sh failed on the restored database"

say "verifying the Audit log against its seals, as ppe_app"
docker run --rm --network "$NET" -e API_DB_DSN="$APP_DSN" -e API_ORG_TIMEZONE="$(envval API_ORG_TIMEZONE Europe/Vilnius)" \
	"ppe-next2-api:$IMAGE_TAG" -verify-audit </dev/null ||
	fail "the restored Audit log does not match its seals"

say "starting the API on it, as ppe_app"
docker run -d --name "$API" --network "$NET" -e API_DB_DSN="$APP_DSN" -e API_JWT_SECRET="$(openssl rand -hex 32)" \
	-e API_ORG_TIMEZONE="$(envval API_ORG_TIMEZONE Europe/Vilnius)" -e API_PUBLIC_BASE_URL=https://drill.invalid \
	-e API_ALLOWED_ORIGINS= "ppe-next2-api:$IMAGE_TAG" >/dev/null
for i in $(seq 1 60); do
	if out=$(docker exec "$API" /api -healthcheck 2>/dev/null); then say "the API is ready: $out"; break; fi
	if [ "$i" -eq 60 ]; then docker logs --tail 20 "$API" >&2; fail "the API on the restored database is not ready after 60s"; fi
	sleep 1
done

say "row counts, restored beside live (changes made since the backup explain a difference)"
counts="SELECT table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text
	FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
restored=$(docker exec "$DB" psql -U ppe2 -d ppe2 -At -F ' ' -c "$counts")
live=$(env -i PATH="$PATH" HOME="$HOME" DOCKER_HOST="${DOCKER_HOST:-}" docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" \
	exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " " -c "$1"' _ "$counts" </dev/null)
join -a 1 -a 2 -e - -o 0,1.2,2.2 <(sort <<<"$restored") <(sort <<<"$live") |
	awk '{ printf "  %-28s %8s %8s%s\n", $1, $2, $3, ($2 == $3 ? "" : "   differs") }' |
	{ printf '  %-28s %8s %8s\n' table restored live; cat; }

say "PASSED"
