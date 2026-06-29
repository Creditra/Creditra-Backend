import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeysRouter } from '../apiKeys.js';
import { ADMIN_KEY_HEADER } from '../../middleware/adminAuth.js';

const ADMIN = 'admin-secret-for-tests';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/api-keys', apiKeysRouter);
  return app;
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN;
});
afterEach(() => {
  if (original === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = original;
});

describe('admin API key routes', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(buildApp()).get('/api/admin/api-keys');
    expect(res.status).toBe(401);
  });

  it('issues, lists, and revokes a key', async () => {
    const app = buildApp();

    const created = await request(app)
      .post('/api/admin/api-keys')
      .set(ADMIN_KEY_HEADER, ADMIN)
      .send({ label: 'service-a' });
    expect(created.status).toBe(201);
    expect(created.body.data.key).toMatch(/^ck_/);
    const id = created.body.data.id;

    const listed = await request(app).get('/api/admin/api-keys').set(ADMIN_KEY_HEADER, ADMIN);
    expect(listed.status).toBe(200);
    // List exposes metadata but not the plaintext key.
    expect(JSON.stringify(listed.body)).not.toContain(created.body.data.key);
    expect(listed.body.data.some((k: { id: string }) => k.id === id)).toBe(true);

    const revoked = await request(app)
      .delete(`/api/admin/api-keys/${id}`)
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('revoked');

    const missing = await request(app)
      .delete('/api/admin/api-keys/does-not-exist')
      .set(ADMIN_KEY_HEADER, ADMIN);
    expect(missing.status).toBe(404);
  });

  it('exposes an audit log', async () => {
    const app = buildApp();
    await request(app).post('/api/admin/api-keys').set(ADMIN_KEY_HEADER, ADMIN).send({ label: 'x' });
    const audit = await request(app).get('/api/admin/api-keys/audit').set(ADMIN_KEY_HEADER, ADMIN);
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.data)).toBe(true);
  });
});
