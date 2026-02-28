import { AuditEntry, AuditAction } from '../../models/AuditLog.js';
import { AuditLogRepository } from '../interfaces/AuditLogRepository.js';

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private auditLogs: AuditEntry[] = [];

  async create(
    action: AuditAction,
    performedBy: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, string>
  ): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: String(this.auditLogs.length + 1),
      action,
      performedBy,
      resourceType,
      resourceId,
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.auditLogs.push(entry);
    return entry;
  }

  async findById(id: string): Promise<AuditEntry | null> {
    return this.auditLogs.find(log => log.id === id) || null;
  }

  async findByResource(resourceType: string, resourceId: string): Promise<AuditEntry[]> {
    return this.auditLogs.filter(
      log => log.resourceType === resourceType && log.resourceId === resourceId
    );
  }

  async findAll(offset = 0, limit = 100): Promise<AuditEntry[]> {
    return this.auditLogs.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.auditLogs.length;
  }

  async clear(): Promise<void> {
    this.auditLogs = [];
  }
}
