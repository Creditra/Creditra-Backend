#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_EXAMPLE=".env.example"
ENV_FILE=".env"
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
  - creates .env from .env.example when .env is missing
  - installs npm dependencies
  - starts the local Postgres service with Docker Compose
  - runs database migrations and schema validation
  - loads deterministic local seed data

Options:
  --skip-install    Do not run npm ci
  --skip-compose    Do not start Docker Compose
  --skip-migrate    Do not run migrations or schema validation
  --skip-seed       Do not load local seed data
  -h, --help        Show this help
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
  exit 1
}

wait_for_database() {
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
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
NODE
}

load_seed_data() {
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
  console.log("Seed data loaded.");
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

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "Installing dependencies"
  npm ci
fi

if [[ "$SKIP_COMPOSE" -eq 0 ]]; then
  step "Starting local Postgres"
  read -r -a compose <<<"$(compose_cmd)"
  "${compose[@]}" up -d db
fi

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  step "Waiting for database"
  wait_for_database

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
  npm run dev
  docker compose up api
  npm test

Local DATABASE_URL used by this script:
  $DATABASE_URL
EOF
