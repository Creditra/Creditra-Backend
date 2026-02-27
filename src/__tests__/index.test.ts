import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// We need to test the actual index.ts file, so let's create a separate test
describe('Main Application', () => {
  let server: any;

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  it('should start server and respond to health check', async () => {
    // Mock process.env.PORT
    const originalPort = process.env.PORT;
    process.env.PORT = '0'; // Use random available port

    // Import and start the app
    const { default: app } = await import('../index.js');
    
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      service: 'creditra-backend'
    });

    // Restore original PORT
    if (originalPort) {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
  });

  it('should handle credit routes', async () => {
    const { default: app } = await import('../index.js');
    
    const response = await request(app)
      .get('/api/credit/lines')
      .expect(200);

    expect(response.body.creditLines).toBeDefined();
  });

  it('should handle risk routes', async () => {
    const { default: app } = await import('../index.js');
    
    const response = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: 'test-wallet' })
      .expect(200);

    expect(response.body.walletAddress).toBe('test-wallet');
  });
});