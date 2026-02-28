import { AuditLogRepository } from '../repositories/interfaces/AuditLogRepository.js';
import { AuditEntry, AuditAction } from '../models/AuditLog.js';

export class AuditLogService {
  constructor(private auditLogRepository: AuditLogRepository) {}

  async createAuditLog(
    action: AuditAction,
    performedBy: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, string>
  ): Promise<AuditEntry> {
    return await this.auditLogRepository.create(
      action,
      performedBy,
      resourceType,
      resourceId,
      metadata
    );
  }

  async getAuditLog(id: string): Promise<AuditEntry | null> {
    return await this.auditLogRepository.findById(id);
  }

  async getAuditLogsByResource(resourceType: string, resourceId: string): Promise<AuditEntry[]> {
    return await this.auditLogRepository.findByResource(resourceType, resourceId);
  }

  async getAllAuditLogs(offset?: number, limit?: number): Promise<AuditEntry[]> {
    return await this.auditLogRepository.findAll(offset, limit);
  }
  
  async getAuditLogCount(): Promise<number> {
    return await this.auditLogRepository.count();
  }

  // Mostly used for testing
  async clearAuditLogs(): Promise<void> {
    return await this.auditLogRepository.clear();
  }
}
