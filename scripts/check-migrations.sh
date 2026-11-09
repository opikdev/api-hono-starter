#!/usr/bin/env bash
set -euo pipefail

output=$(pnpm exec drizzle-kit generate 2>&1)
if [[ $output != *'No schema changes'* ]]; then
  echo 'src/db/schema.ts has changes with no migration. Run pnpm db:generate and commit the result.' >&2
  echo "$output" >&2
  exit 1
fi

if [[ -n ${GITHUB_BASE_REF:-} ]]; then
  base="origin/$GITHUB_BASE_REF"
else
  base=''
  for ref in origin/main main; do
    if git rev-parse --verify --quiet "$ref^{commit}" >/dev/null 2>&1; then
      base=$ref
      break
    fi
  done
fi

if [[ -z $base ]]; then
  echo 'Skipping the append-only migration check, because there is no origin/main or main to compare with.'
  exit 0
fi

edited=$(git diff --name-status "$(git merge-base "$base" HEAD)" -- 'migrations/*.sql' | grep -v '^A' || true)
if [[ -n $edited ]]; then
  echo "Migrations are append-only. Add a new one instead of changing these:" >&2
  echo "$edited" >&2
  exit 1
fi
