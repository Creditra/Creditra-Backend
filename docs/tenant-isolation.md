# Tenant / Multi-wallet Isolation

Creditra supports **tenant-scoped data** so that credit lines and related data are isolated per tenant (e.g., organization, wallet group, environment).

## Tenant identification

Requests that access tenant-scoped data **must include** the header:

- `x-tenant-id: <tenant-id>`

The backend rejects missing tenant context with `400`.

## Current scope

Tenant context is currently enforced on:

- `/api/credit/*` (credit line reads and state transitions)

`/api/risk/evaluate` is not tenant-scoped yet because it does not persist or read tenant data in the current skeleton implementation.

## Guarantees

- Credit lines created/read/updated under one tenant id are **not visible** under another tenant id.
- Lookups by id are scoped by tenant; a valid id in tenant `A` returns `404` in tenant `B`.

