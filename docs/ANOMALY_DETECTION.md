# Anomaly Detection — Rapid Draw / Repay Risk Signals

Lightweight, **rules-based** anomaly detection that watches credit lifecycle
activity for suspicious draw and repay patterns. When a rule fires, the backend
persists an explainable **risk signal** for operator review. Signals are
**advisory only** — they never block draws or repays.

Issue: [#198](https://github.com/Creditra/Creditra-Backend/issues/198)

---

## 1. Goals

| Goal | How |
|------|-----|
| Detect rapid successive draws | Sliding window count on `credit.draw_confirmed` |
| Detect draw bursts | Shorter/higher-frequency window |
| Detect unusual repay patterns | Repeated draw→repay wash cycles |
| Be explainable | Every signal stores the rule thresholds + evidence |
| Be reviewable | Admin list/get endpoints under `/api/risk/admin/signals` |
| Stay out of the money path | Event-bus subscriber; failures isolated |

---

## 2. Pipeline

```
CreditLineService.draw / .repay
        │
        ▼
EventBus  ── credit.draw_confirmed / credit.repay_confirmed
        │
        ▼
anomalySubscriber  ──►  AnomalyDetectionService.observe()
        │
        ├─ in-memory activity buffer (per credit line)
        ├─ evaluate rules against configured thresholds
        └─ RiskSignalRepository.create()  (correlationId attached)
                │
                ▼
        risk_signals table  /  InMemoryRiskSignalRepository
                │
                ▼
        GET /api/risk/admin/signals  (API key)
```

---

## 3. Rules and default thresholds

All thresholds are env-overridable (see §5). Defaults:

### 3.1 `rapid_successive_draws` (medium)

| Parameter | Default | Env |
|-----------|---------|-----|
| `minCount` | **3** draws | `ANOMALY_RAPID_DRAWS_MIN_COUNT` |
| `windowSeconds` | **300** (5 min) | `ANOMALY_RAPID_DRAWS_WINDOW_SECONDS` |

**Fires when** ≥ `minCount` confirmed draws land on the **same credit line**
inside the trailing window ending at the latest draw.

**Rationale:** Legitimate usage rarely stacks three draws inside five minutes;
automation or account-takeover probes often do.

### 3.2 `draw_burst` (high)

| Parameter | Default | Env |
|-----------|---------|-----|
| `minCount` | **5** draws | `ANOMALY_DRAW_BURST_MIN_COUNT` |
| `windowSeconds` | **60** | `ANOMALY_DRAW_BURST_WINDOW_SECONDS` |

**Fires when** ≥ `minCount` draws hit the same line inside a one-minute burst.

**Rationale:** High-frequency short bursts are a stronger abuse signal than
merely “rapid successive” activity.

### 3.3 `unusual_repay_pattern` (high)

| Parameter | Default | Env |
|-----------|---------|-----|
| `minCycles` | **2** | `ANOMALY_REPAY_PATTERN_MIN_CYCLES` |
| `pairWindowSeconds` | **120** | `ANOMALY_REPAY_PAIR_WINDOW_SECONDS` |
| `patternWindowSeconds` | **600** | `ANOMALY_REPAY_PATTERN_WINDOW_SECONDS` |
| `amountToleranceRatio` | **0.1** (10%) | `ANOMALY_REPAY_AMOUNT_TOLERANCE_RATIO` |

**Fires when** at least `minCycles` draw→repay pairs occur where:

1. Each repay arrives within `pairWindowSeconds` of its matched draw.
2. `|draw − repay| / |draw| ≤ amountToleranceRatio`.
3. The whole pattern fits inside `patternWindowSeconds`.

**Rationale:** Fast, amount-matched draw/repay loops look like wash activity or
limit probing rather than ordinary utilization.

### 3.4 Cooldown

| Parameter | Default | Env |
|-----------|---------|-----|
| `signalCooldownSeconds` | **300** | `ANOMALY_SIGNAL_COOLDOWN_SECONDS` |

Suppresses re-emitting the **same rule** for the **same credit line** while the
window is still “hot,” so operators are not flooded with duplicates.

---

## 4. Stored signal shape

Table: `risk_signals` (`migrations/006_risk_signals.sql`).

| Field | Purpose |
|-------|---------|
| `signal_type` | `rapid_successive_draws` \| `draw_burst` \| `unusual_repay_pattern` |
| `rule_id` | Stable id, e.g. `rule.draw_burst` |
| `severity` | `low` \| `medium` \| `high` |
| `wallet_address` / `credit_line_id` | Subject of the signal |
| `correlation_id` | Ties the signal to the evaluation that produced it |
| `thresholds` | JSON snapshot of the thresholds used (explainability) |
| `evidence` | Counts, amounts, timestamps that fired the rule |
| `status` | `open` (default) \| `acknowledged` \| `dismissed` |
| `created_at` | Server time |

---

## 5. Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `ANOMALY_DETECTION_ENABLED` | `true` | Master switch |
| `ANOMALY_RAPID_DRAWS_MIN_COUNT` | `3` | See §3.1 |
| `ANOMALY_RAPID_DRAWS_WINDOW_SECONDS` | `300` | See §3.1 |
| `ANOMALY_DRAW_BURST_MIN_COUNT` | `5` | See §3.2 |
| `ANOMALY_DRAW_BURST_WINDOW_SECONDS` | `60` | See §3.2 |
| `ANOMALY_REPAY_PATTERN_MIN_CYCLES` | `2` | See §3.3 |
| `ANOMALY_REPAY_PAIR_WINDOW_SECONDS` | `120` | See §3.3 |
| `ANOMALY_REPAY_PATTERN_WINDOW_SECONDS` | `600` | See §3.3 |
| `ANOMALY_REPAY_AMOUNT_TOLERANCE_RATIO` | `0.1` | See §3.3 |
| `ANOMALY_SIGNAL_COOLDOWN_SECONDS` | `300` | See §3.4 |
| `ANOMALY_MAX_ACTIVITY_EVENTS_PER_LINE` | `50` | Cap on in-memory buffer |

Loader: [`src/config/anomalyDetection.ts`](../src/config/anomalyDetection.ts).

---

## 6. Admin API

Auth: `X-API-Key` (same as other risk admin routes).

### `GET /api/risk/admin/signals`

Query (all optional, strict schema):

- `walletAddress` — valid Stellar address
- `creditLineId` — UUID
- `signalType` — enum of the three types
- `status` — `open` \| `acknowledged` \| `dismissed`
- `correlationId`
- `offset`, `limit` (max 100)

Response envelope:

```json
{
  "data": {
    "signals": [ /* RiskSignal[] newest first */ ],
    "total": 12,
    "offset": 0,
    "limit": 50
  },
  "error": null
}
```

### `GET /api/risk/admin/signals/:id`

Returns one signal or `404`.

---

## 7. Security notes

- Detection is **read-only w.r.t. credit state**; it cannot mutate utilization.
- Admin list endpoints require a valid API key; keys are never logged.
- Evidence stores amounts and timestamps only — no secrets.
- Multi-instance deployments each keep a local activity buffer; signals still
  land in shared Postgres. For cross-replica window accuracy, prefer a single
  writer or a future shared buffer (out of scope for #198).

---

## 8. Tests

| Suite | Coverage |
|-------|----------|
| `src/services/__tests__/anomalyDetectionService.test.ts` | Rule triggers / non-triggers, cooldown, config |
| `src/services/events/__tests__/anomalySubscriber.test.ts` | Event-bus hooks |
| `src/repositories/memory/__tests__/InMemoryRiskSignalRepository.test.ts` | Persistence |
| `src/routes/__tests__/risk.test.ts` | Admin list/get auth + happy path |

---

## 9. Code map

| Path | Role |
|------|------|
| `src/config/anomalyDetection.ts` | Thresholds / env loader |
| `src/models/RiskSignal.ts` | Domain model |
| `src/services/anomalyDetectionService.ts` | Rules + buffer |
| `src/services/events/anomalySubscriber.ts` | EventBus hooks |
| `src/repositories/**/RiskSignal*` | Persistence |
| `migrations/006_risk_signals.sql` | Schema |
| `src/routes/risk.ts` | Admin endpoints |
