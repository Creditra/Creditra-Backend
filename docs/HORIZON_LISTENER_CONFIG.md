# Horizon Listener Configuration

This document describes the configuration options for the resilient Horizon listener implementation.

## Environment Variables

### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Stellar Horizon server URL |
| `CONTRACT_IDS` | (empty) | Comma-separated list of Soroban contract IDs to monitor |
| `POLL_INTERVAL_MS` | `5000` | Polling interval in milliseconds |
| `HORIZON_START_LEDGER` | `latest` | Starting ledger sequence number or "latest" |

### Resilience Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HORIZON_MAX_RETRIES` | `3` | Maximum number of retry attempts for transient errors |
| `HORIZON_INITIAL_BACKOFF_MS` | `1000` | Initial backoff delay in milliseconds for retries |
| `HORIZON_MAX_BACKOFF_MS` | `30000` | Maximum backoff delay in milliseconds |
| `HORIZON_BACKOFF_MULTIPLIER` | `2.0` | Backoff multiplier for exponential backoff |
| `HORIZON_RATE_LIMIT_DELAY_MS` | `60000` | Delay in milliseconds when rate limited |
| `HORIZON_MAX_CURSOR_GAP` | `100` | Maximum gap size to attempt recovery for cursor gaps |
| `HORIZON_ENABLE_METRICS` | `false` | Enable structured logging with metrics |

## Configuration Examples

### Basic Configuration
```bash
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_IDS=CONTRACT_1,CONTRACT_2
POLL_INTERVAL_MS=5000
HORIZON_START_LEDGER=latest
```

### Production Configuration with Resilience
```bash
HORIZON_URL=https://horizon.stellar.org
CONTRACT_IDS=CONTRACT_A,CONTRACT_B,CONTRACT_C
POLL_INTERVAL_MS=3000
HORIZON_START_LEDGER=123456
HORIZON_MAX_RETRIES=5
HORIZON_INITIAL_BACKOFF_MS=2000
HORIZON_MAX_BACKOFF_MS=60000
HORIZON_BACKOFF_MULTIPLIER=2.5
HORIZON_RATE_LIMIT_DELAY_MS=120000
HORIZON_MAX_CURSOR_GAP=200
HORIZON_ENABLE_METRICS=true
```

## Resilience Features

### 1. Error Classification and Retry Logic

The listener automatically classifies errors into:
- **Rate Limit Errors** (HTTP 429): Triggers configurable delay
- **Transient Errors** (5xx, timeouts): Triggers exponential backoff with jitter
- **Cursor Gap Errors**: Attempts recovery within configurable gap limits
- **Non-Transient Errors** (4xx except 429): Logged but not retried

### 2. Exponential Backoff with Jitter

Retry delays use exponential backoff:
```
delay = min(initial_backoff * multiplier^(attempt-1), max_backoff) + jitter
```

Jitter (10% of delay) prevents thundering herd problems.

### 3. Cursor Gap Detection and Recovery

When cursor gaps are detected:
1. Attempts to recover events within the gap
2. Queries individual ledgers up to `HORIZON_MAX_CURSOR_GAP`
3. Skips ahead if recovery fails
4. Tracks gap detection and recovery metrics

### 4. Idempotent Event Processing

- Each event gets a unique ID: `{ledger}-{contractId}-{topics}-{dataHash}`
- Processed events are cached to prevent duplicates
- Cache automatically cleans up after 10,000 events
- Duplicate events are tracked in metrics

### 5. Rate Limit Handling

- Automatically detects rate limit errors
- Waits for configured delay before retrying
- Tracks rate limit hits in metrics
- Respects Horizon's rate limit headers

### 6. Structured Logging and Metrics

When `HORIZON_ENABLE_METRICS=true`, the listener provides:

```typescript
interface HorizonListenerMetrics {
    totalPolls: number;              // Total polling attempts
    successfulPolls: number;          // Successful polls
    failedPolls: number;             // Failed polls
    eventsProcessed: number;         // Events successfully processed
    eventsDuplicated: number;        // Duplicate events skipped
    retryAttempts: number;           // Total retry attempts
    rateLimitHits: number;           // Rate limit encounters
    cursorGapsDetected: number;      // Cursor gaps detected
    cursorGapsRecovered: number;     // Cursor gaps successfully recovered
    lastSuccessfulPoll?: string;     // ISO timestamp of last successful poll
    lastError?: string;              // Last error message
    averagePollTime?: number;        // Average poll time in milliseconds
}
```

## Security Considerations

### Stellar Keys and PII
- The listener does not store or log Stellar private keys
- Wallet addresses in event data are handled as PII
- Enable metrics logging only in secure environments
- Review event data before logging in production

### Network Security
- Use HTTPS for Horizon URLs in production
- Consider VPN or private networks for sensitive operations
- Monitor for unusual retry patterns that might indicate attacks

## Operational Considerations

### Monitoring
- Monitor `retryAttempts` and `rateLimitHits` for network issues
- Track `cursorGapsDetected` vs `cursorGapsRecovered` for data consistency
- Watch `averagePollTime` for performance degradation
- Alert on high `failedPolls` percentages

### Scaling
- Increase `HORIZON_MAX_CURSOR_GAP` for networks with frequent gaps
- Adjust `HORIZON_BACKOFF_MULTIPLIER` based on network stability
- Consider separate instances for different contract sets
- Use `HORIZON_ENABLE_METRICS` for performance tuning

### Memory Management
- Event ID cache automatically limits to 10,000 entries
- Monitor memory usage with high event volumes
- Consider increasing poll intervals for memory-constrained environments

## Troubleshooting

### Common Issues

1. **High Retry Rate**
   - Check network connectivity to Horizon
   - Verify Horizon URL is accessible
   - Consider increasing backoff delays

2. **Cursor Gaps Not Recovering**
   - Increase `HORIZON_MAX_CURSOR_GAP`
   - Check if ledgers in gap actually exist
   - Verify network stability

3. **Rate Limit Issues**
   - Increase `HORIZON_RATE_LIMIT_DELAY_MS`
   - Reduce polling frequency
   - Consider multiple instances with different contracts

4. **Memory Usage**
   - Monitor event ID cache size
   - Reduce `POLL_INTERVAL_MS` for fewer events
   - Implement custom cleanup if needed

### Debug Mode

Enable detailed logging:
```bash
HORIZON_ENABLE_METRICS=true
DEBUG=horizon:*
```

This provides detailed information about:
- Error classification
- Retry attempts and delays
- Cursor gap recovery attempts
- Event processing statistics
