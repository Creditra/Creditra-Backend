# Horizon Listener Integration Guide

## Quick Start

```typescript
import { start, onEvent, getMetrics } from './services/horizonListener.js';

// Register event handlers
onEvent(async (event) => {
  console.log('Payment received:', event);
  // Process payment logic here
});

// Start the listener
await start();

// Monitor metrics
setInterval(() => {
  const metrics = getMetrics();
  console.log('Listener health:', metrics);
}, 30000);
```

## Production Deployment Checklist

### ✅ Pre-deployment
- [ ] Review configuration in `docs/HORIZON_LISTENER_CONFIG.md`
- [ ] Set production environment variables
- [ ] Run `npm test` with >95% coverage
- [ ] Run `npm run build` to verify TypeScript compilation
- [ ] Test with actual Horizon endpoints

### ✅ Monitoring Setup
- [ ] Monitor `retryAttempts` and `rateLimitHits`
- [ ] Alert on high `failedPolls` percentages
- [ ] Track `cursorGapsDetected` vs `cursorGapsRecovered`
- [ ] Monitor `averagePollTime` for performance

### ✅ Security Review
- [ ] Verify no Stellar private keys in logs
- [ ] Ensure HTTPS Horizon URLs
- [ ] Review PII handling in event data
- [ ] Check network security policies

## Example Production Config

```typescript
// config/production.ts
export const horizonConfig = {
  horizonUrl: 'https://horizon.stellar.org',
  contractIds: [
    'CONTRACT_ID_1',
    'CONTRACT_ID_2'
  ],
  pollIntervalMs: 3000,
  startLedger: 'latest',
  maxRetries: 5,
  initialBackoffMs: 2000,
  maxBackoffMs: 60000,
  backoffMultiplier: 2.5,
  rateLimitDelayMs: 120000,
  maxCursorGap: 200,
  enableMetrics: true
};
```

## Health Check Endpoint

```typescript
// Add to your health check route
app.get('/health/horizon', (req, res) => {
  const metrics = getMetrics();
  const healthy = metrics.failedPolls / metrics.totalPolls < 0.1;
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    metrics,
    timestamp: new Date().toISOString()
  });
});
```

## Troubleshooting Common Issues

### High Retry Rate
```bash
# Check network connectivity
curl -I https://horizon.stellar.org

# Review logs for error patterns
grep "retry" logs/horizon.log
```

### Memory Usage
```bash
# Monitor memory
node --inspect dist/index.js

# Check event cache size
grep "processedEventIdsCount" logs/horizon.log
```

### Performance Issues
```bash
# Check average poll time
grep "averagePollTime" logs/horizon.log

# Adjust poll interval if needed
export POLL_INTERVAL_MS=5000
```
