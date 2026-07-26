/**
 * Admin-only compliance export routes.
 *
 * Surface (all require `X-Admin-Api-Key`):
 *  - GET `/credit-lines`  — export credit lines (CSV/JSON stream)
 *  - GET `/transactions`  — export transactions (CSV/JSON stream)
 *  - GET `/audit`         — export lifecycle audit records (CSV/JSON stream)
 *
 * Anti-exfiltration controls:
 *  - Admin auth (fail-closed when `ADMIN_API_KEY` unset)
 *  - Required date range with max span (see export.schema)
 *  - Hard row ceiling per request
 *  - Dedicated rate-limit namespace applied by the mount site
 *
 * See `docs/COMPLIANCE_EXPORTS.md`.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { validateQuery } from '../middleware/validate.js';
import {
  auditExportQuerySchema,
  creditLineExportQuerySchema,
  transactionExportQuerySchema,
  type AuditExportQuery,
  type CreditLineExportQuery,
  type TransactionExportQuery,
} from '../schemas/export.schema.js';
import { Container } from '../container/Container.js';
import { defaultAuditLogStore } from '../services/auditLogStore.js';
import {
  AUDIT_CSV_COLUMNS,
  ComplianceExportService,
  CREDIT_LINE_CSV_COLUMNS,
  TRANSACTION_CSV_COLUMNS,
} from '../services/complianceExportService.js';
import {
  streamCsv,
  streamJson,
  type ExportFormat,
  type StreamMeta,
} from '../utils/exportStream.js';
import { nowUtcIso } from '../utils/time.js';
import { fail } from '../utils/response.js';

export const exportsRouter = Router();

function getExportService(): ComplianceExportService {
  const container = Container.getInstance();
  return new ComplianceExportService(
    container.creditLineRepository,
    container.transactionRepository,
    defaultAuditLogStore,
  );
}

function writeExport(
  res: Response,
  resource: string,
  format: ExportFormat,
  rows: ReadonlyArray<Record<string, unknown>>,
  page: { limit: number; offset: number; truncated: boolean; from: string; to: string },
  columns: readonly string[],
): void {
  const meta: StreamMeta = {
    resource,
    format,
    count: rows.length,
    limit: page.limit,
    offset: page.offset,
    truncated: page.truncated,
    from: page.from,
    to: page.to,
    generatedAt: nowUtcIso(),
  };

  // Surface truncation / pagination as headers for both formats.
  res.setHeader('X-Export-Count', String(meta.count));
  res.setHeader('X-Export-Limit', String(meta.limit));
  res.setHeader('X-Export-Offset', String(meta.offset));
  res.setHeader('X-Export-Truncated', meta.truncated ? 'true' : 'false');

  if (format === 'csv') {
    const stamp = meta.generatedAt.replace(/[:.]/g, '-');
    streamCsv(res, columns, rows, `creditra-${resource}-${stamp}.csv`);
    return;
  }

  streamJson(res, rows, meta);
}

/**
 * GET /api/admin/exports/credit-lines
 */
exportsRouter.get(
  '/credit-lines',
  adminAuth,
  validateQuery(creditLineExportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as CreditLineExportQuery;
      const page = await getExportService().exportCreditLines(query);
      writeExport(
        res,
        'credit-lines',
        query.format,
        page.rows,
        page,
        CREDIT_LINE_CSV_COLUMNS,
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/admin/exports/transactions
 */
exportsRouter.get(
  '/transactions',
  adminAuth,
  validateQuery(transactionExportQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as TransactionExportQuery;
      const page = await getExportService().exportTransactions(query);
      writeExport(
        res,
        'transactions',
        query.format,
        page.rows,
        page,
        TRANSACTION_CSV_COLUMNS,
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/admin/exports/audit
 */
exportsRouter.get(
  '/audit',
  adminAuth,
  validateQuery(auditExportQuerySchema),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as AuditExportQuery;
      const page = getExportService().exportAudit(query);
      writeExport(res, 'audit', query.format, page.rows, page, AUDIT_CSV_COLUMNS);
    } catch (error) {
      // Synchronous path still uses next for consistency with errorHandler.
      if (!res.headersSent) {
        fail(res, error instanceof Error ? error.message : 'Export failed', 500);
        return;
      }
      next(error);
    }
  },
);
