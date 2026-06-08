#!/bin/bash
set -e
# Only run if pnpm-lock.yaml changed
if git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD | grep -q "pnpm-lock.yaml"; then
  echo "📦 Dependencies changed, running install..."
  pnpm install --frozen-lockfile
fi

# Only push DB if schema changed
if git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD | grep -q "schema"; then
  echo "🗄️ Schema changed, pushing to DB..."
  pnpm --filter db push
fi
