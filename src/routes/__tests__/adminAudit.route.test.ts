import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiKeysRouter } from '../apiKeys.js';
import { adminAuditRouter } from '../adminAudit.js';
import { creditRouter } from '../credit.js';
import { ADMIN_KEY_HEADER } from '../../middleware/adminAuth.js';
import { defaultAdminAuditLog, actorFingerprint } from '../../services/adminAuditLog.js';
import { _resetStore, createCreditLine } from '../../services/creditService.js';

const ADMIN = 'admin-secret-for-tests';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/api-keys', apiKeysRouter);
  app.use('/api/admin/audit-logs', adminAuditRouter);
  app.use('/api/credit', creditRouter);
  return app;
}

describe('admin audit log routes', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN;
    defaultAdminAuditLog.resetForTests();
    _resetStore();
  });

  it('requires admin authentication', async () => {
    const res = await request(buildApp()).get('/api/admin/audit-logs');
    expect(res.status).toBe(401);
  });

  it('returns audit records written by admin handlers without exposing secrets', async () => {
    const app = buildApp();

    const created = await request(app)
      .post('/api/admin/api-keys')
      .set(ADMIN_KEY_HEADER, ADMIN)
      .send({ label: 'ops-key' });

    expect(created.status).toBe(201);

    const audit = await request(app)
      .get('/api/admin/audit-logs')
      .set(ADMIN_KEY_HEADER, ADMIN);

    expect(audit.status).toBe(200);
    expect(audit.body.data.items).toHaveLength(1);
    expect(audit.body.data.items[0]).toMatchObject({
      actor: actorFingerprint(ADMIN),
      action: 'api_key.issued',
      targetType: 'api_key',
      targetId: created.body.data.id,
    });
    expect(JSON.stringify(audit.body)).not.toContain(created.body.data.key);
  });

  it('supports action filters and limit validation', async () => {
    const app = buildApp();
    await request(app).post('/api/admin/api-keys').set(ADMIN_KEY_HEADER, ADMIN).send({ label: 'x' });

    const filtered = await request(app)
      .get('/api/admin/audit-logs?action=api_key.issued&limit=1')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.hasMore).toBe(false);

    const invalid = await request(app)
      .get('/api/admin/audit-logs?limit=101')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(invalid.status).toBe(400);
  });

  it('records credit-line admin transitions', async () => {
    const app = buildApp();
    createCreditLine('line-1');

    const suspended = await request(app)
      .post('/api/credit/lines/line-1/suspend')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(suspended.status).toBe(200);

    const audit = await request(app)
      .get('/api/admin/audit-logs?action=credit_line.suspended')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(audit.status).toBe(200);
    expect(audit.body.data.items[0]).toMatchObject({
      action: 'credit_line.suspended',
      targetType: 'credit_line',
      targetId: 'line-1',
    });
    expect(audit.body.data.items[0].before.status).toBe('active');
    expect(audit.body.data.items[0].after.status).toBe('suspended');
  });
});
