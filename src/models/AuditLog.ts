export type AuditAction =
  | 'CREDIT_LINE_CREATED'
  | 'CREDIT_LINE_UPDATED'
  | 'CREDIT_LINE_DELETED'
  | 'RISK_EVALUATED'
  | 'ADMIN_ACTION';

export interface AuditEntry {
  id: string;
  action: AuditAction;
  performedBy: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  metadata?: Record<string, string>;
}
