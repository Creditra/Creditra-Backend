import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setMaintenanceMode } from '../src/middleware/maintenanceMode.js';

const ADMIN_KEY = 'test-admin-key';

function makeApp() {
    process.env['ADMIN_API_KEY'] = ADMIN_KEY;
    return createApp();
}

describe('Maintenance Mode', () => {
    beforeEach(() => {
        // Reset maintenance mode to off before each test.
        setMaintenanceMode(false, 'test-setup');
    });

    it('health check is always available even when maintenance mode is on', async () => {
        setMaintenanceMode(true, 'test');
        const app = makeApp();
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ok' });
    });

    it('GET requests are allowed during maintenance mode', async () => {
        setMaintenanceMode(true, 'test');
        const app = makeApp();
        // /api/credit is a real route; any 4xx that is NOT 503 means the guard passed.
        const res = await request(app).get('/api/credit');
        expect(res.status).not.toBe(503);
    });

    it('POST requests are blocked during maintenance mode with 503', async () => {
        setMaintenanceMode(true, 'test');
        const app = makeApp();
        const res = await request(app)
            .post('/api/credit')
            .send({ some: 'data' });
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ maintenanceMode: true });
    });

    it('admin can enable and disable maintenance mode via API', async () => {
        const app = makeApp();

        // Enable maintenance mode.
        const enableRes = await request(app)
            .post('/api/admin/maintenance')
            .set('x-admin-api-key', ADMIN_KEY)
            .send({ enabled: true });
        expect(enableRes.status).toBe(200);
        expect(enableRes.body.maintenanceMode).toBe(true);

        // Disable maintenance mode.
        const disableRes = await request(app)
            .post('/api/admin/maintenance')
            .set('x-admin-api-key', ADMIN_KEY)
            .send({ enabled: false });
        expect(disableRes.status).toBe(200);
        expect(disableRes.body.maintenanceMode).toBe(false);
    });

    it('rejects toggle request without admin key', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/admin/maintenance')
            .send({ enabled: true });
        expect(res.status).toBe(401);
    });

    it('rejects toggle request with invalid body', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/admin/maintenance')
            .set('x-admin-api-key', ADMIN_KEY)
            .send({ enabled: 'yes' });
        expect(res.status).toBe(400);
    });

    it('GET /api/admin/maintenance returns status and audit log', async () => {
        const app = makeApp();
        const res = await request(app)
            .get('/api/admin/maintenance')
            .set('x-admin-api-key', ADMIN_KEY);
        expect(res.status).toBe(200);
        expect(typeof res.body.maintenanceMode).toBe('boolean');
        expect(Array.isArray(res.body.auditLog)).toBe(true);
    });
});
