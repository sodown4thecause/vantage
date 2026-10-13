#!/bin/bash
# Installs dependencies in Claude Code cloud sessions so agents can run
# `pnpm lint && pnpm typecheck && pnpm test` (AGENTS.md "The standard loop") immediately.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
fi

# Matches CI; reuses the pnpm store cached with the container.
pnpm install --frozen-lockfile --prefer-offline
