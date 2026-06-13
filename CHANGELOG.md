# Changelog

All notable changes to the Creditra Backend project will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Shared utility modules under `src/utils/` for constants, strings,
  numbers, time, and HTTP status codes.
- `LICENSE` and metadata fields in `package.json`.
- Comprehensive documentation set under `docs/`:
  - `ARCHITECTURE.md` — system design, request lifecycle, ER, worker map.
  - `API.md` — endpoint inventory, error envelope, pagination conventions.
  - `SIGNALS_INGEST.md` — behavioral-signal pipeline and on-chain handoff.
  - `SECURITY.md` — threat model and in-tree mitigations.
  - `INDEXER.md` — cursor model, gap recovery, reconciliation runbook.
  - `OBSERVABILITY.md` — logs, metrics, health probes, tracing strategy.
  - `TESTING.md` — test pyramid, coverage gate, run commands.
- Inline TSDoc on routes, services, middleware, and the DI container.

### Changed

- Deduplicated entries in `.gitignore` and expanded patterns for editor
  and OS artefacts.
- `README.md` rewritten as a high-signal landing with mermaid topology
  diagram, feature inventory, and engineering principles.
- `CONTRIBUTING.md` extended with conventional-commit catalogue, PR
  checklist, review checklist, and migration discipline.
