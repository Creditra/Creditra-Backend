import { AuditEntry, AuditAction } from '../../models/AuditLog.js';

export interface AuditLogRepository {
  /**
   * Create a new audit log entry
   */
  create(
    action: AuditAction,
    performedBy: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, string>
  ): Promise<AuditEntry>;

  /**
   * Find audit log by ID
   */
  findById(id: string): Promise<AuditEntry | null>;

  /**
   * Find audit logs related to a specific resource type and id
   */
  findByResource(resourceType: string, resourceId: string): Promise<AuditEntry[]>;

  /**
   * Get all audit logs with optional pagination
   */
  findAll(offset?: number, limit?: number): Promise<AuditEntry[]>;
  
  /**
   * Clear all audit logs (primarily for testing)
   */
  clear(): Promise<void>;
  
  /**
   * Get total count of audit logs
   */
  count(): Promise<number>;
}
