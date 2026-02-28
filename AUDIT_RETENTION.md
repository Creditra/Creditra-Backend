# Audit Log Retention and Privacy Considerations

## Retention Policy
Audit logs in the current implementation are stored in-memory using the `InMemoryAuditLogRepository`. 
- **Volatile Storage**: Since the storage is in-memory, logs are cleared whenever the server restarts.
- **Production Recommendation**: When moving to production, a persistent database (e.g., PostgreSQL) should be used. 
- **Cleanup**: Periodic cleanup of logs older than 90 days is recommended to maintain performance.

## Privacy Considerations
- **Non-Sensitive Logging**: The system is designed to log *actions* (who, what, when) without storing sensitive payload data.
- **Personally Identifiable Information (PII)**: 
  - `performedBy`: Stores the user identifier (e.g., from `x-user` header).
  - `resourceId`: Stores the identifier of the modified resource (e.g., wallet address or credit line ID).
- **Metadata**: Only includes high-level request information (`method`, `path`). Avoid logging full request bodies or headers to prevent accidental exposure of credentials or private data.
- **Access Control**: The `GET /api/audit/logs` endpoint should be protected by admin-level authentication in a production environment. Currently, it is publicly accessible for demonstration and development purposes.

## Security
- Audit logs are immutable via the service once created.
- The `clearAuditLogs` method is intended for test environments and system maintenance only.
