# -include: a missing .env is not fatal; targets that need a variable fail on their own.
# It also adds .env to MAKEFILE_LIST, so help reads only the first entry (this file).
-include .env
export

.DEFAULT_GOAL := help

MIGRATIONS := internal/db/migrations

# DB names the database the psql targets act on: `make migrate DB=$(TEST_DB)`.
# CI, which has no compose service, overrides PSQL entirely:
#   make migrate PSQL='psql -d <dsn> -v ON_ERROR_STOP=1 -q'
DB ?= $(POSTGRES_DB)
TEST_DB ?= $(POSTGRES_DB)_test
PSQL := docker compose exec -T -e PGOPTIONS='-c client_min_messages=warning' db psql -v ON_ERROR_STOP=1 -q -U $(POSTGRES_USER) -d $(DB)

.PHONY: help build run vet test test-db e2e db-up db-down db-test-create migrate migrate-down migrate-status seed-admin seed-demo \
	prod-build prod-up prod-ready prod-down prod-ps prod-logs prod-seed-admin prod-seed-demo \
	prod-backup prod-backups prod-restore prod-drill backup-once

help: ## List targets
	@awk -F':.*## ' '/^[a-z0-9-]+:.*## /{printf "  %-16s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

build: ## Build the API binary
	go build -o api ./cmd/api

run: ## Run the API (needs db-up + migrate)
	go run ./cmd/api

vet: ## go vet
	go vet ./...

test: ## Unit tests; Postgres tests skip unless API_TEST_DB_DSN is set
	go test -p 1 ./...

test-db: ## All tests including Postgres ones against API_TEST_DB_DSN
	@test -n "$(API_TEST_DB_DSN)" || { echo "API_TEST_DB_DSN is not set"; exit 1; }
	@test "$(API_TEST_DB_DSN)" != "$(API_DB_DSN)" || { echo "API_TEST_DB_DSN must differ from API_DB_DSN (tests truncate)"; exit 1; }
	go test -p 1 -count=1 ./...

e2e: ## Playwright end-to-end tests (empties the _test database; needs db-test-create first)
	cd web/e2e && pnpm e2e

db-up: ## Start Postgres 18 and wait until it is healthy
	docker compose up -d --wait db

db-down: ## Stop Postgres (data volume is kept)
	docker compose down

db-test-create: ## Create and migrate the test database
	@docker compose exec -T db psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) -tAc \
		"SELECT 1 FROM pg_database WHERE datname = '$(TEST_DB)'" | grep -q 1 || \
		docker compose exec -T db createdb -U $(POSTGRES_USER) $(TEST_DB)
	$(MAKE) migrate DB=$(TEST_DB)

migrate: ## Apply pending *.up.sql migrations, each in its own transaction
	@$(PSQL) -f - < $(MIGRATIONS)/0000_schema_migrations.up.sql
	@for f in $$(ls $(MIGRATIONS)/*.up.sql | sort); do \
		name=$$(basename $$f); \
		[ "$$name" = 0000_schema_migrations.up.sql ] && continue; \
		applied=$$($(PSQL) -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$$name'"); \
		[ "$$applied" = 1 ] && continue; \
		echo "apply $$name"; \
		{ echo "BEGIN;"; cat $$f; echo; echo "INSERT INTO schema_migrations (filename) VALUES ('$$name');"; echo "COMMIT;"; } | $(PSQL) -f - || exit 1; \
	done
	@# The API role's grants, every run: idempotent, and lost by a restore.
	@$(PSQL) -f - < internal/db/grants.sql

migrate-down: ## Revert every applied migration, newest first
	@for f in $$(ls $(MIGRATIONS)/*.down.sql | sort -r); do \
		up=$$(basename $$f .down.sql).up.sql; \
		applied=$$($(PSQL) -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$$up'" 2>/dev/null); \
		[ "$$applied" = 1 ] || continue; \
		echo "revert $$up"; \
		{ echo "BEGIN;"; cat $$f; echo; echo "DELETE FROM schema_migrations WHERE filename = '$$up';"; echo "COMMIT;"; } | $(PSQL) -f - || exit 1; \
	done

migrate-status: ## List applied migrations
	@$(PSQL) -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename"

seed-admin: ## Create the first admin from API_SEED_USER_* and exit
	go run ./cmd/api -seed-admin

seed-demo: ## Fill an empty database with demo data as the seed admin (run seed-admin first)
	go run ./cmd/api -seed-demo

# The deployment stack (docker-compose.prod.yml, .env.prod). `env -i` because
# compose reads ${VAR} from the environment before --env-file, and this Makefile
# exports every development value from .env.
PROD_ENV_FILE ?= .env.prod
PROD_ENV := env -i PATH="$$PATH" HOME="$$HOME" DOCKER_HOST="$$DOCKER_HOST"
PROD_COMPOSE := docker compose -f docker-compose.prod.yml --env-file $(PROD_ENV_FILE)
PROD := $(PROD_ENV) $(PROD_COMPOSE)
# The commit the API image is built from, shown by GET /ready; -dirty when
# tracked files differ from it.
PROD_COMMIT = $(shell git describe --always --dirty --abbrev=12 2>/dev/null)

prod-build: ## Build the API and web images (separate from prod-up, so building is not downtime)
	$(PROD_ENV) API_COMMIT="$(PROD_COMMIT)" $(PROD_COMPOSE) build

# Compose has kept api or caddy on the previous image after a rebuild, so both
# are always recreated (about a second of downtime). db is recreated only when
# its config changes; the first `up` runs migrate before the API starts. It
# ends when GET /ready answers (the database is reachable and migrated), or
# fails with the API's last log lines.
prod-up: ## Start or update the deployment stack; migrations run before the API starts
	$(PROD) up -d
	$(PROD) up -d --force-recreate --no-deps api caddy backup
	@for i in $$(seq 1 60); do \
		if out=$$($(PROD) exec -T api /api -healthcheck 2>/dev/null); then echo "api ready: $$out"; exit 0; fi; \
		sleep 1; \
	done; \
	echo "the API is not ready after 60s" >&2; $(PROD) logs --tail=30 api >&2; exit 1

prod-ready: ## Ask the running API whether it is ready (GET /ready) and which commit it runs
	$(PROD) exec -T api /api -healthcheck

prod-down: ## Stop the deployment stack (volumes are kept)
	$(PROD) down

prod-ps: ## Deployment stack status
	$(PROD) ps -a

prod-logs: ## Follow the deployment stack's logs
	$(PROD) logs -f --tail=100

prod-seed-admin: ## Create the first admin from API_SEED_USER_* in .env.prod and exit
	$(PROD) run --rm --no-deps api -seed-admin

prod-seed-demo: ## Fill an empty deployment database with demo data as that admin
	$(PROD) run --rm --no-deps api -seed-demo

prod-backup: ## Back up the deployment database now (it also backs up on DBBACKUP_SCHEDULE)
	$(PROD) run --rm --no-deps backup once

prod-backups: ## List the stored backups, newest first
	$(PROD) run --rm --no-deps backup list

# Replaces the database's contents. Without CONFIRM=yes it only names the backup
# it would restore. KEY= picks one from prod-backups (default: the newest);
# IDENTITY= is the age private key file for an encrypted backup.
prod-restore: ## Restore a backup: KEY=<key> (default newest) IDENTITY=<age key file> CONFIRM=yes
	$(PROD) run --rm --no-deps $(if $(IDENTITY),-v $(abspath $(IDENTITY)):/run/backup.key:ro -e DBBACKUP_AGE_IDENTITY_FILE=/run/backup.key) \
		backup restore $(if $(filter yes,$(CONFIRM)),--yes) $(if $(KEY),$(KEY),--latest)

# The monthly restore drill (deploy/restore-drill.sh, docs/backups.md): restores
# into a throwaway database beside the deployment, never into it. IDENTITY=- reads
# the age key from standard input, so it can come over ssh and is never stored here.
prod-drill: ## Rehearse a restore apart from the deployment: KEY=<key> (default newest) IDENTITY=<age key file, or - for stdin>
	$(PROD_ENV) PROD_ENV_FILE="$(PROD_ENV_FILE)" KEY="$(KEY)" IDENTITY="$(IDENTITY)" deploy/restore-drill.sh

backup-once: ## Back up the development database now (docker-compose.yml backup profile)
	docker compose --profile backup run --rm backup once
