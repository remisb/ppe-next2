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

.PHONY: help build run vet test test-db e2e e2e-caddy new-app db-up db-down db-test-create migrate migrate-down migrate-status seed-admin seed-demo import-sims \
	prod-build prod-up prod-ready prod-down prod-ps prod-logs prod-seed-admin prod-seed-demo prod-import-sims prod-reseal-sim-codes \
	prod-backup prod-backups prod-restore prod-drill backup-once publish-app prod-publish

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

# As CI runs it: the production build behind deploy/Caddyfile, published apps
# included, with Caddy from its official image at CI's pinned version, so no
# local Caddy is needed. Docker removes the container when the run ends.
e2e-caddy: ## Playwright end-to-end behind deploy/Caddyfile, Caddy in Docker (as CI does)
	cd web && pnpm build
	cd web/e2e && E2E_WEB_SERVER=caddy E2E_CADDY=docker pnpm e2e; status=$$?; docker rm -f ppe-e2e-caddy >/dev/null 2>&1; exit $$status

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
	@# ppe_app signs in once .env gives it a password, as deploy/migrate.sh does.
	@# The password goes to psql on stdin, never on a command line.
	@if [ "$$API_DB_USER" = ppe_app ] && [ -n "$$API_DB_PASSWORD" ]; then \
		printf '\\set pw %s\nALTER ROLE ppe_app WITH LOGIN PASSWORD :'"'"'pw'"'"';\n' "$$API_DB_PASSWORD" | $(PSQL) -f - || exit 1; \
		echo "migrate: ppe_app can sign in"; \
	fi

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

# Without COMMIT=yes it only checks the file and prints what it would import.
import-sims: ## Import SIM cards from a CSV list as the seed admin: FILE=<csv> COMMIT=yes
	@test -n "$(FILE)" || { echo "FILE=<the SIM card list, CSV> is required" >&2; exit 2; }
	go run ./cmd/api -import-sims - $(if $(filter yes,$(COMMIT)),-commit) < "$(FILE)"

# A published app's version (ADR 0006, phase 3): its commit's date and short
# hash, YYYY.MM.DD-<hash>, for the ref $(1).
app_version = $(shell git log -1 --format=%cd-%h --date=format:%Y.%m.%d --abbrev=12 $(1) 2>/dev/null)
# The apps published under /apps/<slug>/ rather than baked into the web image:
# every web/apps/<slug> with a public/ppe-app.json (@ppe/launcher's
# published-apps.ts finds the same ones for the dev proxy and e2e).
PUBLISHED_APPS := $(patsubst web/apps/%/public/ppe-app.json,%,$(wildcard web/apps/*/public/ppe-app.json))

# A build reaches -publish-app through a pipe; without pipefail a failed or
# cut-off tar would look like success, and a version's files never change once
# published. bash, as sh (dash on the droplet) may lack pipefail.
publish-app prod-up prod-publish: SHELL := /bin/bash

publish-app: ## Build an app and publish it to API_APPS_DIR (for Caddy locally): APP=<slug> [CHANNEL=<name>]
	@test -n "$(APP)" || { echo "APP=<slug> is required, one of: $(PUBLISHED_APPS)" >&2; exit 2; }
	@test -n "$$API_APPS_DIR" || { echo "set API_APPS_DIR in .env (an existing folder) first" >&2; exit 2; }
	cd web && pnpm --filter "./apps/$(APP)" build
	set -o pipefail; tar -C "web/apps/$(APP)/dist" -cf - . | go run ./cmd/api -publish-app "$(APP)" -version "$(call app_version,HEAD)" \
		-channel "$(CHANNEL)" -from-commit "$$(git rev-parse --short=12 HEAD)"

# A new published app from web/templates/published-app (@ppe/launcher's
# new-app.ts): web/apps/<slug> with the next free dev port, and its tile in
# internal/domain/launcher/defaults.go in POC, which lets a deploy publish it.
NEW_APP := node --experimental-strip-types --no-warnings=ExperimentalWarning packages/launcher/src/new-app.ts
new-app: ## Start a published app, its tile in POC (Testers only): SLUG=<slug> NAME='<name in English>' [NAME_LT='…'] [NAME_RU='…']
	@cd web && $(NEW_APP) --slug "$(SLUG)" --name "$(NAME)" $(if $(NAME_LT),--name-lt "$(NAME_LT)") $(if $(NAME_RU),--name-ru "$(NAME_RU)")
	cd web && pnpm install

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

# `up` runs migrate before the API starts and recreates what changed. Compose
# has kept api or caddy on the previous image after a rebuild, so each built
# service whose container still runs another image than its tag names is then
# recreated, once; one already on its image is left running (each restart is
# about a second of downtime). db is recreated only when its config changes.
# It ends when GET /ready answers (the database is reachable and migrated), or
# fails with the API's last log lines.
prod-up: ## Start or update the deployment stack; migrations run before the API starts
	$(PROD) up -d
	@for svc in api caddy backup; do \
		set -- $$(docker inspect -f '{{.Config.Image}} {{.Image}}' "$$($(PROD) ps -aq $$svc)") && \
		want=$$(docker image inspect -f '{{.Id}}' "$$1") || exit 1; \
		if [ "$$want" != "$$2" ]; then \
			echo "$$svc still runs the previous image: recreating it"; \
			$(PROD) up -d --force-recreate --no-deps $$svc || exit 1; \
		fi; \
	done
	@# The Caddyfile is mounted from the checkout, so a change to it alone
	@# (a security policy, say) changes no image: compare what Caddy runs with.
	@# A single-file mount keeps the file it started with, so recreate, not reload.
	@want=$$(sha256sum deploy/Caddyfile | cut -d' ' -f1); \
	have=$$($(PROD) exec -T caddy sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1); \
	if [ "$$want" != "$$have" ]; then \
		echo "caddy runs an older Caddyfile: recreating it"; \
		$(PROD) up -d --force-recreate --no-deps caddy || exit 1; \
	fi
	@for i in $$(seq 1 60); do \
		if out=$$($(PROD) exec -T api /api -healthcheck 2>/dev/null); then echo "api ready: $$out"; exit 0; fi; \
		sleep 1; \
	done; \
	echo "the API is not ready after 60s" >&2; $(PROD) logs --tail=30 api >&2; exit 1
	@# The deployed commit's published apps go to Preview (and Stable, for an
	@# app with none yet or one whose Stable follows deploys); Stable and Beta
	@# otherwise move on Manage apps. A version is named by its commit, so a
	@# checkout with local changes publishes nothing; then old versions no
	@# channel opens are pruned.
	@case "$(PROD_COMMIT)" in *-dirty) \
		echo "the checkout has local changes: the apps are deployed but not published (commit or discard them, then make prod-up)" >&2; exit 1;; esac
	@built=$$($(PROD) exec -T caddy cat /srv/build/.commit 2>/dev/null); \
	if [ "$$built" != "$(PROD_COMMIT)" ]; then \
		echo "the web image was built from $${built:-an unknown commit}, not $(PROD_COMMIT): nothing published (make prod-build, then make prod-up)" >&2; exit 1; \
	fi
	@set -o pipefail; for app in $(PUBLISHED_APPS); do \
		$(PROD) exec -T caddy tar -C "/srv/build/$$app" -cf - . | \
		$(PROD) run --rm --no-deps -T api -publish-app "$$app" -version "$(call app_version,HEAD)" \
			-channel preview -from-commit "$(PROD_COMMIT)" || exit 1; \
	done
	@$(PROD) run --rm --no-deps -T api -prune-apps

# Builds the app at REF with that commit's web/Dockerfile (deploy/build-app.sh)
# and publishes it; fetch the ref first. An app's new version reaches no one
# until a channel points at it: CHANNEL, or Manage apps later.
prod-publish: ## Publish an app built at a git ref: APP=<slug> REF=<commit, tag or branch> [CHANNEL=<stable|beta|preview>]
	@test -n "$(APP)" -a -n "$(REF)" || { echo "usage: make prod-publish APP=<slug> REF=<git ref> [CHANNEL=<name>]" >&2; exit 2; }
	@git rev-parse --verify --quiet "$(REF)^{commit}" >/dev/null || { echo "$(REF) is not a commit here: git fetch first" >&2; exit 2; }
	set -o pipefail; deploy/build-app.sh "$(APP)" "$(REF)" | $(PROD) run --rm --no-deps -T api -publish-app "$(APP)" \
		-version "$(call app_version,$(REF))" -channel "$(CHANNEL)" -from-commit "$$(git rev-parse --short=12 '$(REF)^{commit}')"

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

# The list goes in on standard input, so the API's image (scratch, a non-root
# user) needs no mount. Without COMMIT=yes it only checks the file.
prod-import-sims: ## Import SIM cards from a CSV list as the API_SEED_USER_EMAIL user: FILE=<csv> COMMIT=yes
	@test -n "$(FILE)" || { echo "FILE=<the SIM card list, CSV> is required" >&2; exit 2; }
	$(PROD) run --rm --no-deps -T api -import-sims - $(if $(filter yes,$(COMMIT)),-commit) < "$(FILE)"

prod-reseal-sim-codes: ## Seal every SIM card's PIN and PUK under API_SIM_CODES_KEY again, after a key change (docs/backups.md)
	$(PROD) run --rm --no-deps -T api -reseal-sim-codes

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
