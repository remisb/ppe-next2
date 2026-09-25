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
	prod-build prod-up prod-down prod-ps prod-logs prod-seed-admin prod-seed-demo

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
PROD := env -i PATH="$$PATH" HOME="$$HOME" DOCKER_HOST="$$DOCKER_HOST" docker compose -f docker-compose.prod.yml --env-file $(PROD_ENV_FILE)

prod-build: ## Build the API and web images (separate from prod-up, so building is not downtime)
	$(PROD) build

prod-up: ## Start or update the deployment stack; migrations run before the API starts
	$(PROD) up -d

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
