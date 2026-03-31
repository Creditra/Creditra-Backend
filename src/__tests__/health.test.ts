import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import * as dbClient from '../db/client.js';

beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = 'health-test-key';
});

describe('GET /health (public)', () => {
    let getConnectionSpy: ReturnType<typeof vi.spyOn> | null = null;

    afterAll(() => {
        if (getConnectionSpy) {
            getConnectionSpy.mockRestore();
        }
        // restore global fetch if stubbed
        if ((global as any).fetch && (global as any).fetch.mockRestore) {
            (global as any).fetch.mockRestore();
        }
    });

    it('returns 200 with service and dependency details', async () => {
        // Ensure dependencies are mocked to pass
        const fakeClient = {
            connect: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockResolvedValue({ rows: [] }),
            end: vi.fn().mockResolvedValue(undefined),
        };

        getConnectionSpy = vi.spyOn(dbClient, 'getConnection').mockReturnValue(fakeClient as any);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        (global as any).fetch = fetchMock;

        process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';

        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            data: {
                status: 'ok',
                service: 'creditra-backend',
                ready: true,
                dependencies: {
                    database: { status: 'ok' },
                    horizon: { status: 'ok' },
                },
            },
            error: null,
        });
    });
});
