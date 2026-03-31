import { describe, it, expect, afterEach } from 'vitest';
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
      data: {
        status: 'ok',
        service: 'creditra-backend'
      },
      error: null
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

    expect(response.body.data.creditLines).toBeDefined();
  });

  it('should handle risk routes', async () => {
    const { default: app } = await import('../index.js');
    
    const response = await request(app)
      .post('/api/risk/evaluate')
      .send({ walletAddress: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1' })
      .expect(200);

    expect(response.body.data.walletAddress).toBe('GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1');
  });
});