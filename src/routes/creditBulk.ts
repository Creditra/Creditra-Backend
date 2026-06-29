/**
 * POST /api/credit/lines/bulk
 * POST /api/credit/lines/bulk?dry_run=true   — validation only
 *
 * Bulk ingestion of credit lines with per-row validation and optional dry-run.
 */

import { Router, type Request, type Response } from 'express';
import { createCreditLineSchema } from '../schemas/index.js';
import type { CreateCreditLineBody } from '../schemas/index.js';
import { ok } from '../utils/response.js';
import { Container } from '../container/Container.js';

export const creditBulkRouter = Router();
const container = Container.getInstance();

const MAX_ROWS = 200;

interface BulkRowResult {
  index: number;
  status: 'created' | 'error' | 'dry_run_valid';
  id?: string;
  error?: string;
}

creditBulkRouter.post('/lines/bulk', async (req: Request, res: Response, next) => {
  try {
    const isDryRun = req.query['dry_run'] === 'true';
    const rows: unknown[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (rows.length === 0) {
      return res.status(400).json({ error: { code: 'MISSING_ROWS', message: 'rows array is required and must not be empty' } });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: { code: 'TOO_MANY_ROWS', message: `Maximum ${MAX_ROWS} rows per request` } });
    }

    const results: BulkRowResult[] = [];
    let created = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const parsed = createCreditLineSchema.safeParse(rows[i]);
      if (!parsed.success) {
        results.push({ index: i + 1, status: 'error', error: parsed.error.issues.map(e => e.message).join('; ') });
        failed++;
        continue;
      }

      if (isDryRun) {
        results.push({ index: i + 1, status: 'dry_run_valid' });
        created++;
        continue;
      }

      try {
        const creditService = container.getCreditService();
        const line = await creditService.createCreditLine(parsed.data as CreateCreditLineBody);
        results.push({ index: i + 1, status: 'created', id: line.id });
        created++;
      } catch (err) {
        results.push({ index: i + 1, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
        failed++;
      }
    }

    return res.status(207).json(ok({ summary: { total: rows.length, created, failed, dry_run: isDryRun }, results }));
  } catch (err) {
    next(err);
  }
});

export default creditBulkRouter;
