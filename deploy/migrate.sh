#!/bin/sh
# Applies pending migrations against the database psql's environment points at.
#
# The deployment counterpart to `make migrate`, and it must stay
# behaviourally identical to it: same schema_migrations table, same
# transaction-per-file, same unconditional 0000. The Makefile target cannot be
# reused because it runs `docker compose exec db psql`, which assumes a
# container named db on the same host -- true on a developer's machine, false
# for a managed database and false inside a container.
#
# Connection comes from PGHOST/PGUSER/PGDATABASE/PGPASSWORD, set by the compose
# service. Nothing is passed on the command line, so no credential appears in
# `ps`.
set -eu

MIGRATIONS=/migrations
PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc"

# ON_ERROR_STOP is what makes a failed statement a non-zero exit rather than a
# warning psql shrugs off. Without it this script would report success on a
# broken migration and the API would start against a half-applied schema.

echo "migrate: waiting for the database"
# depends_on healthy already gates this, but a healthy Postgres can still refuse
# the first connection while it finishes recovery after an unclean shutdown.
i=0
until pg_isready -q; do
	i=$((i + 1))
	if [ "$i" -ge 30 ]; then
		echo "migrate: database not ready after 30s" >&2
		exit 1
	fi
	sleep 1
done

# 0000 creates schema_migrations and is applied unconditionally: it sorts first,
# so the table exists before the loop queries it, and every statement in it is
# idempotent.
$PSQL -q -f "$MIGRATIONS/0000_schema_migrations.up.sql"

for f in "$MIGRATIONS"/*.up.sql; do
	name=$(basename "$f")
	case $name in
	0000_*) continue ;;
	esac

	applied=$($PSQL -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")
	if [ -n "$applied" ]; then
		echo "migrate: skipping  $name (already applied)"
		continue
	fi

	echo "migrate: applying  $name"
	# One transaction spanning the migration and the INSERT that records it, so
	# the two cannot disagree: a failure rolls back both and the file is retried
	# next run rather than being marked done. This matters because ADD
	# CONSTRAINT has no IF NOT EXISTS form in Postgres -- replaying an applied
	# migration is a hard error, not a notice.
	{
		echo 'BEGIN;'
		cat "$f"
		echo
		echo "INSERT INTO schema_migrations (filename) VALUES ('$name');"
		echo 'COMMIT;'
	} | $PSQL -q
done

echo "migrate: up to date"
