SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker/docker-compose.yml --env-file .env
PSQL_USER ?= ledgerflow

.DEFAULT_GOAL := help
.PHONY: help infra-up infra-down infra-restart infra-logs infra-ps infra-health reset \
        test test-integration verify build lint typecheck format psql redis-cli kafka-topics env

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

infra-up: env ## Start local infrastructure and wait until healthy
	$(COMPOSE) up -d --wait
	@$(MAKE) --no-print-directory infra-health

infra-down: ## Stop infrastructure, keep data volumes
	$(COMPOSE) down

infra-restart: infra-down infra-up ## Restart infrastructure

reset: env ## Destroy all local data and start clean
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d --wait
	@$(MAKE) --no-print-directory infra-health

infra-logs: ## Follow infrastructure logs (make infra-logs SERVICE=kafka)
	$(COMPOSE) logs -f $(SERVICE)

infra-ps: ## Show container status
	$(COMPOSE) ps

infra-health: ## Print endpoints and verify the critical dependencies respond
	@echo ""
	@echo "  PostgreSQL     localhost:5432   $$($(COMPOSE) exec -T postgres pg_isready -U $(PSQL_USER) -d postgres >/dev/null 2>&1 && echo OK || echo DOWN)"
	@echo "  Redis          localhost:6379   $$($(COMPOSE) exec -T redis redis-cli ping 2>/dev/null | tr -d '\r' | grep -q PONG && echo OK || echo DOWN)"
	@echo "  Kafka          localhost:29092  $$($(COMPOSE) exec -T kafka /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server kafka:9092 >/dev/null 2>&1 && echo OK || echo DOWN)"
	@echo "  Kafka UI       http://localhost:8080"
	@echo "  Prometheus     http://localhost:9090"
	@echo "  Grafana        http://localhost:3100  (anonymous viewer enabled)"
	@echo "  Jaeger         http://localhost:16686"
	@echo "  Loki           http://localhost:3101"
	@echo "  OTLP gRPC      localhost:4317"
	@echo ""

psql: ## Open psql (make psql DB=ledgerflow_ledger)
	$(COMPOSE) exec postgres psql -U $(PSQL_USER) -d $(or $(DB),postgres)

redis-cli: ## Open redis-cli
	$(COMPOSE) exec redis redis-cli

kafka-topics: ## List Kafka topics
	$(COMPOSE) exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list

build: ## Build all packages and services
	pnpm build

lint: ## Lint
	pnpm lint

typecheck: ## Typecheck
	pnpm typecheck

format: ## Check formatting
	pnpm format

test: ## Run unit tests
	pnpm test

test-integration: infra-up ## Run integration tests against real containers
	pnpm test:integration

verify: ## Everything CI runs on a pull request
	pnpm verify
