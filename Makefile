SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

# Swift is optional in constrained environments; every Swift step degrades to
# a loud SKIP so `make check` stays meaningful without it (see README matrix).
SWIFT := $(shell command -v swift 2>/dev/null)

.PHONY: help setup dev composer-dev lint format format-check typecheck test e2e check transcripts clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Install JS + Python deps (Gradle fetches on first build)
	pnpm install
	cd services/agent && uv sync

dev: ## Run executor + graphql + agent + web locally (Ctrl-C stops all)
	./scripts/dev.sh

composer-dev: ## Run catalog + composer dev servers (Ctrl-C stops both)
	./scripts/composer-dev.sh

lint: ## Lint all packages
	pnpm lint
	cd services/agent && uv run ruff check .
	cd packages/chat-core-kotlin && ./gradlew -q spotlessCheck
ifdef SWIFT
	@echo "note: no Swift linter configured beyond the compiler (swift build -Xswiftc -warnings-as-errors is the strict option)"
endif

format: ## Auto-format all packages
	pnpm format
	cd services/agent && uv run ruff format . && uv run ruff check --fix .
	cd packages/chat-core-kotlin && ./gradlew -q spotlessApply

format-check: ## Verify formatting without writing
	pnpm format:check
	cd services/agent && uv run ruff format --check .
	cd packages/chat-core-kotlin && ./gradlew -q spotlessCheck

typecheck: ## TypeScript + mypy
	pnpm typecheck
	cd services/agent && uv run mypy src

test: ## Unit/component tests for every package
	pnpm -r --if-present test
	cd services/agent && uv run pytest -q
	cd packages/chat-core-kotlin && ./gradlew -q test
ifdef SWIFT
	cd packages/chat-core-swift && swift test
else
	@echo "SKIPPED: swift not found — run 'swift test' in packages/chat-core-swift locally (see README verification matrix)"
endif

e2e: ## Scripted-conversation scenarios against the live stack
	pnpm --filter @mwe/e2e e2e

check: lint format-check typecheck test e2e ## The pre-push gate: everything above, green
	@echo "check: all green"

transcripts: ## Re-record the SSE transcript fixtures from the live agent
	node scripts/record-transcripts.mjs

clean: ## Remove build artifacts
	rm -rf node_modules **/node_modules apps/web/dist apps/composer/dist apps/catalog/dist services/executor/data
	cd packages/chat-core-kotlin && ./gradlew -q clean || true
