import { Router } from 'express';
import { Container } from '../container/Container.js';
import { paginateAndFilter } from '../utils/paginate.js';

export const auditRouter = Router();

auditRouter.get('/logs', async (req, res) => {
  const container = Container.getInstance();
  const logs = await container.auditLogService.getAllAuditLogs();
  
  const q = req.query;
  const result = paginateAndFilter(logs, q as any);
  
  res.json({
      items: result.items,
      logs: result.items, // backwards compatibility
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
  });
});
