#!/usr/bin/env sh
# Install git hooks for this repository.
# Called automatically by `pnpm install` via the root `prepare` script.
# Safe to run multiple times (idempotent).

HOOKS_DIR=".git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "scripts/install-hooks.sh: .git/hooks not found — skipping (not a git repo or running in CI)"
  exit 0
fi

cp scripts/pre-commit.sh "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "✓ pre-commit hook installed (.git/hooks/pre-commit)"
