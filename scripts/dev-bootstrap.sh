#!/usr/bin/env bash
# Reproducible local-dev bootstrap for Creditra Backend.
# Brings up Postgres (Docker Compose), prepares .env, installs deps,
# runs migrations + schema validation, and loads deterministic seed data.
#
# Usage: npm run dev:bootstrap
#    or: bash scripts/dev-bootstrap.sh [options]
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_EXAMPLE=".env.example"
ENV_FILE=".env"
SEED_SQL="scripts/dev-seed.sql"
DEFAULT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/creditra_db"
DEFAULT_API_KEYS="dev-api-key"

SKIP_INSTALL=0
SKIP_COMPOSE=0
SKIP_MIGRATE=0
SKIP_SEED=0

usage() {
  cat <<'USAGE'
Usage: scripts/dev-bootstrap.sh [options]

Bootstraps a local Creditra backend development environment:
  - validates required keys are present in .env.example
  - creates .env from .env.example when .env is missing (never overwrites)
  - installs npm dependencies (npm ci)
  - starts the local Postgres service with Docker Compose (db only)
  - waits for database readiness
  - runs database migrations and schema validation
  - loads deterministic local seed data (idempotent)

Secrets are never committed: only .env.example (placeholders) is tracked.
Existing .env files are left unchanged.

Options:
  --skip-install    Do not run npm ci
  --skip-compose    Do not start Docker Compose (use an existing Postgres)
  --skip-migrate    Do not run migrations or schema validation
  --skip-seed       Do not load local seed data
  -h, --help        Show this help

Examples:
  npm run dev:bootstrap
  npm run dev:bootstrap -- --skip-install
  bash scripts/dev-bootstrap.sh --skip-compose --skip-seed
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-compose) SKIP_COMPOSE=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --skip-seed) SKIP_SEED=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

step() {
  printf '\n==> %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    case "$1" in
      docker)
        echo "Install Docker Desktop (or Engine) and ensure 'docker' is on PATH," >&2
        echo "or re-run with --skip-compose if Postgres is already available." >&2
        ;;
      node|npm)
        echo "Install Node.js >= 20 (includes npm) from https://nodejs.org/" >&2
        ;;
    esac
    exit 1
  fi
}

env_value() {
  local key="$1"
  local file="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "", $0)
      print $0
      exit
    }
  ' "$file"
}

validate_env_example() {
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "Missing $ENV_EXAMPLE in repo root. Cannot bootstrap without the env template." >&2
    exit 1
  fi

  local missing=()
  local required=(DATABASE_URL API_KEYS)

  for key in "${required[@]}"; do
    if ! grep -Eq "^[[:space:]]*${key}=" "$ENV_EXAMPLE"; then
      missing+=("$key")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "$ENV_EXAMPLE is missing required entries: ${missing[*]}" >&2
    exit 1
  fi
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return
  fi

  echo "Docker Compose is required unless --skip-compose is used." >&2
  echo "Install Docker Compose v2 (docker compose) or docker-compose v1." >&2
  exit 1
}

ensure_pg_module() {
  if [[ ! -d "node_modules/pg" ]]; then
    echo "node_modules/pg is missing. Run without --skip-install, or run 'npm ci' first." >&2
    exit 1
  fi
}

wait_for_database() {
  ensure_pg_module
  node --input-type=module <<'NODE'
import { Client } from "pg";

const url = process.env.DATABASE_URL;
const maxAttempts = 30;
const delayMs = 1000;

if (!url) {
  console.error("DATABASE_URL is required before checking database readiness.");
  process.exit(1);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    console.log("Database is reachable.");
    process.exit(0);
  } catch (error) {
    try {
      await client.end();
    } catch {
      // Ignore close errors while waiting for Postgres to accept connections.
    }

    if (attempt === maxAttempts) {
      console.error("Database did not become reachable:", error instanceof Error ? error.message : error);
      console.error("Hints:");
      console.error("  - Is Docker running? Try: docker compose up -d db");
      console.error("  - Is port 5432 free / pointed at the right host?");
      console.error("  - Does DATABASE_URL match compose credentials?");
      console.error("    expected: postgresql://postgres:postgres@localhost:5432/creditra_db");
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
NODE
}

load_seed_data() {
  ensure_pg_module

  if [[ ! -f "$SEED_SQL" ]]; then
    echo "Missing seed file: $SEED_SQL" >&2
    exit 1
  fi

  node --input-type=module <<'NODE'
import fs from "node:fs";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required before loading seed data.");
  process.exit(1);
}

const sql = fs.readFileSync("scripts/dev-seed.sql", "utf8");
const client = new Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  console.log("Seed data loaded (idempotent).");
} catch (error) {
  console.error("Failed to load seed data:", error instanceof Error ? error.message : error);
  console.error("Ensure migrations have been applied (omit --skip-migrate) and schema is valid.");
  process.exit(1);
} finally {
  await client.end();
}
NODE
}

step "Checking prerequisites"
require_cmd node
require_cmd npm
if [[ "$SKIP_COMPOSE" -eq 0 ]]; then
  require_cmd docker
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "Node.js >= 20 is required (found $(node -v))." >&2
  exit 1
fi

step "Validating environment template"
validate_env_example

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from $ENV_EXAMPLE. Review it before using non-local services."
else
  echo "$ENV_FILE already exists; leaving it unchanged."
fi

DATABASE_URL="${DATABASE_URL:-$(env_value DATABASE_URL "$ENV_FILE")}"
API_KEYS="${API_KEYS:-$(env_value API_KEYS "$ENV_FILE")}"
DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
API_KEYS="${API_KEYS:-$DEFAULT_API_KEYS}"
export DATABASE_URL API_KEYS NODE_ENV="${NODE_ENV:-development}"

if [[ -z "$DATABASE_URL" || -z "$API_KEYS" ]]; then
  echo "DATABASE_URL and API_KEYS must be set in the environment or $ENV_FILE." >&2
  exit 1
fi

if [[ "$API_KEYS" == "change-me-before-any-real-traffic" ]]; then
  echo "Warning: API_KEYS still uses a non-local placeholder. Prefer the local 'dev-api-key' value for bootstrap." >&2
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "Installing dependencies"
  npm ci
else
  ensure_pg_module
fi

if [[ "$SKIP_COMPOSE" -eq 0 ]]; then
  step "Starting local Postgres"
  read -r -a compose <<<"$(compose_cmd)"
  if ! "${compose[@]}" up -d db; then
    echo "Failed to start the 'db' service via Docker Compose." >&2
    echo "Check that Docker is running and port 5432 is available." >&2
    exit 1
  fi
fi

NEED_DB=0
if [[ "$SKIP_MIGRATE" -eq 0 || "$SKIP_SEED" -eq 0 ]]; then
  NEED_DB=1
fi

if [[ "$NEED_DB" -eq 1 ]]; then
  step "Waiting for database"
  wait_for_database
fi

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  step "Running migrations"
  npm run db:migrate

  step "Validating schema"
  npm run db:validate
fi

if [[ "$SKIP_SEED" -eq 0 ]]; then
  step "Loading local seed data"
  load_seed_data
fi

cat <<EOF

Local development bootstrap complete.

Useful commands:
  npm run dev              # API with hot reload on http://localhost:3000
  docker compose up api    # API + DB via Compose
  npm test                 # unit/integration tests
  npm run db:migrate       # re-run migrations
  npm run db:validate      # re-check schema

Local DATABASE_URL used by this script:
  $DATABASE_URL

Seeded demo wallet (local only):
  GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA
EOF
