import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { auditRouter } from '../routes/audit.js';
import { creditRouter } from '../routes/credit.js';
import { riskRouter } from '../routes/risk.js';
import { AuditAction, AuditEntry } from '../models/AuditLog.js';
import { Container } from '../container/Container.js';

const app = express();
app.use(express.json());

app.use('/api/credit', async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method !== 'GET') {
    const user = String(req.headers['x-user'] || 'anonymous');
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_UPDATED', user, 'credit_line', 'unknown', { method: req.method, path: req.path });
  }
  next();
});

app.use('/api/risk', async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method === 'POST') {
    const user = String(req.headers['x-user'] || 'anonymous');
    const wallet = String((req.body && req.body.walletAddress) || 'unknown');
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('RISK_EVALUATED', user, 'risk', wallet, { method: req.method, path: req.path });
  }
  next();
});

app.use('/api/credit', creditRouter);
app.use('/api/risk', riskRouter);
app.use('/api/audit', auditRouter);

beforeEach(async () => {
  const container = Container.getInstance();
  await container.auditLogService.clearAuditLogs();
});

describe('AuditLogService', () => {
  it('creates an audit entry with correct fields', async () => {
    const container = Container.getInstance();
    const entry = await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user_1', 'credit_line', '123');
    expect(entry.action).toBe('CREDIT_LINE_CREATED');
    expect(entry.performedBy).toBe('user_1');
    expect(entry.resourceType).toBe('credit_line');
    expect(entry.resourceId).toBe('123');
    expect(entry.timestamp).toBeDefined();
    expect(entry.id).toBe('1');
  });

  it('increments id with each entry', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user_1', 'credit_line', '1');
    const second = await container.auditLogService.createAuditLog('CREDIT_LINE_UPDATED', 'user_2', 'credit_line', '2');
    expect(second.id).toBe('2');
  });

  it('stores metadata when provided', async () => {
    const container = Container.getInstance();
    const entry = await container.auditLogService.createAuditLog('ADMIN_ACTION', 'admin', 'system', 'sys', { reason: 'test' });
    expect(entry.metadata?.reason).toBe('test');
  });

  it('stores entry without metadata when not provided', async () => {
    const container = Container.getInstance();
    const entry = await container.auditLogService.createAuditLog('CREDIT_LINE_DELETED', 'user_1', 'credit_line', '1');
    expect(entry.metadata).toBeUndefined();
  });

  it('records all audit action types', async () => {
    const container = Container.getInstance();
    const actions: AuditAction[] = [
      'CREDIT_LINE_CREATED',
      'CREDIT_LINE_UPDATED',
      'CREDIT_LINE_DELETED',
      'RISK_EVALUATED',
      'ADMIN_ACTION',
    ];
    for (const action of actions) {
        await container.auditLogService.createAuditLog(action, 'user', 'resource', '1');
    }
    const logs = await container.auditLogService.getAllAuditLogs();
    expect(logs).toHaveLength(5);
  });
});

describe('getAllAuditLogs', () => {
  it('returns empty array initially', async () => {
    const container = Container.getInstance();
    const logs = await container.auditLogService.getAllAuditLogs();
    expect(logs).toHaveLength(0);
  });

  it('returns all recorded entries', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user_1', 'credit_line', '1');
    await container.auditLogService.createAuditLog('RISK_EVALUATED', 'user_2', 'risk', '2');
    const logs = await container.auditLogService.getAllAuditLogs();
    expect(logs).toHaveLength(2);
  });
});

describe('clearAuditLogs', () => {
  it('clears all audit entries', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('ADMIN_ACTION', 'admin', 'system', '1');
    await container.auditLogService.clearAuditLogs();
    const logs = await container.auditLogService.getAllAuditLogs();
    expect(logs).toHaveLength(0);
  });
});

describe('Additional AuditLogService Methods', () => {
  it('getAuditLog returns an entry by id', async () => {
    const container = Container.getInstance();
    const entry = await container.auditLogService.createAuditLog('ADMIN_ACTION', 'admin', 'system', '1');
    const returned = await container.auditLogService.getAuditLog(entry.id);
    expect(returned).toBeDefined();
    expect(returned?.action).toBe('ADMIN_ACTION');
  });

  it('getAuditLog returns null for non-existent id', async () => {
    const container = Container.getInstance();
    const returned = await container.auditLogService.getAuditLog('999');
    expect(returned).toBeNull();
  });

  it('getAuditLogsByResource returns matching entries', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user', 'credit_line', 'res_1');
    await container.auditLogService.createAuditLog('CREDIT_LINE_UPDATED', 'user', 'credit_line', 'res_1');
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user', 'credit_line', 'res_2');
    const logs = await container.auditLogService.getAuditLogsByResource('credit_line', 'res_1');
    expect(logs).toHaveLength(2);
  });

  it('getAuditLogCount returns total count', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('RISK_EVALUATED', 'user', 'risk', 'res_x');
    await container.auditLogService.createAuditLog('RISK_EVALUATED', 'user', 'risk', 'res_y');
    const count = await container.auditLogService.getAuditLogCount();
    expect(count).toBe(2);
  });
});

describe('GET /api/audit/logs', () => {
  it('returns empty logs initially', async () => {
    const res = await request(app).get('/api/audit/logs');
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns logs after audit entries recorded', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user_1', 'credit_line', '1');
    const res = await request(app).get('/api/audit/logs');
    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].action).toBe('CREDIT_LINE_CREATED');
  });
  
  it('paginates logs properly via GET /api/audit/logs?pageSize=1', async () => {
    const container = Container.getInstance();
    await container.auditLogService.createAuditLog('CREDIT_LINE_CREATED', 'user_1', 'credit_line', '1');
    await container.auditLogService.createAuditLog('RISK_EVALUATED', 'user_2', 'risk', '2');
    const res = await request(app).get('/api/audit/logs?pageSize=1');
    expect(res.body.total).toBe(2);
    expect(res.body.pageSize).toBe(1);
    expect(res.body.logs).toHaveLength(1);
  });
});

describe('Audit hooks', () => {
  it('records audit on POST /api/risk/evaluate', async () => {
    await request(app)
      .post('/api/risk/evaluate')
      .set('x-user', 'user_123')
      .send({ walletAddress: 'wallet_abc' });
      
    const container = Container.getInstance();
    const logs = await container.auditLogService.getAllAuditLogs();
    
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('RISK_EVALUATED');
    expect(logs[0].performedBy).toBe('user_123');
    expect(logs[0].resourceId).toBe('wallet_abc');
  });

  it('uses anonymous when x-user header is missing', async () => {
    await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: 'wallet_xyz' });
      
    const container = Container.getInstance();
    const logs = await container.auditLogService.getAllAuditLogs();
    expect(logs[0].performedBy).toBe('anonymous');
  });

  it('does not record audit on GET /api/credit/lines', async () => {
    await request(app).get('/api/credit/lines');
    
    const container = Container.getInstance();
    const logs = await container.auditLogService.getAllAuditLogs();
    
    expect(logs).toHaveLength(0);
  });
});
