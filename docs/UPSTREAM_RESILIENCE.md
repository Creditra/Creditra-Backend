# Upstream timeout and circuit policy

Creditra treats upstream requests as bounded operations. Every call receives
an `AbortSignal` and a finite deadline. Read-only RPC and risk evaluation calls
may retry transient transport failures with a small exponential budget. A
transaction submission is not retried after a transport failure because the
provider may have accepted the transaction before the response was lost.

Each upstream has a circuit breaker. Three consecutive terminal failures open
the circuit; subsequent calls fail immediately with `UPSTREAM_CIRCUIT_OPEN`.
After the reset interval a half-open probe is allowed. A successful probe
closes the circuit and clears its failure count. The in-memory policy is safe
for this process; a distributed deployment should use a shared breaker
adapter if instances need coordinated admission.

The policy never includes credentials, request payloads, or provider response
details in its stable errors. Callers can map `UpstreamTimeoutError`,
`UnsafeRetryError`, and `CircuitOpenError` to their API retryable-error
contract while keeping provider internals in server-side logs.
