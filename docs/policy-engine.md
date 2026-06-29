# Credit Policy Engine

The policy engine centralises credit eligibility and risk rules with an explicit
rule registry and machine-readable rejection reasons.

## Architecture

```
PolicyRuleRegistry
  └─ PolicyRule[]      (id, description, evaluate(ctx) → RuleOutcome)

evaluatePolicy(registry, context) → PolicyEvaluationResult
  .approved         boolean
  .rejections[]     { code: RejectionCode, reason: string }
  .evaluatedRules[] string[]
```

## Stable Rejection Codes

| Code | Trigger |
|------|---------|
| `CREDIT_SCORE_TOO_LOW` | Score below 40 |
| `AMOUNT_EXCEEDS_LIMIT` | Requested amount > $500,000 |
| `KYC_NOT_VERIFIED` | KYC level < 1 |
| `COOLDOWN_ACTIVE` | Last draw < 24 hours ago |
| `OUTSTANDING_BALANCE_TOO_HIGH` | Balance > 80% of max limit |

## Usage

```typescript
import { createDefaultRegistry, evaluatePolicy } from './services/policyEngine.js';

const registry = createDefaultRegistry();

const result = evaluatePolicy(registry, {
  walletAddress: 'GABC...',
  creditScore: 72,
  requestedAmount: 5_000_00,
  kycLevel: 1,
  lastDrawAt: null,
  outstandingBalance: 0,
});

if (!result.approved) {
  // result.rejections contains stable codes safe for API responses
  console.log(result.rejections);
}
```

## Adding Custom Rules

```typescript
registry.register({
  id: 'my-custom-rule',
  description: 'Block specific wallets.',
  evaluate(ctx) {
    if (blocklist.has(ctx.walletAddress)) {
      return { passed: false, code: 'KYC_NOT_VERIFIED', reason: 'Wallet is blocked.' };
    }
    return { passed: true };
  },
});
```

All rules in the registry are evaluated; rejections from every failing rule are
returned together so callers see the full picture in a single API call.
